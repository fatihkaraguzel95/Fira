use std::{collections::HashMap, rc::Rc};

use crate::{
    local_onestore::{
        file_node::{FileNodeData, file_node::ObjectSpaceManifestListReferenceFND},
        file_structure::FileNodeDataIterator,
        objects::{
            object::Object, parse_context::ParseContext, revision::Revision,
            revision_manifest_list::RevisionManifestList,
        },
    },
    shared::exguid::ExGuid,
};
use parser_utils::errors::{ErrorKind, Result};

type ExportedObject = crate::onestore::object::Object;

/// A collection of objects, referenced from the root file node list.
///
/// See [\[MS-ONESTORE\] 2.1.4](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-onestore/1329433f-02a5-4e83-ab41-80d57ade38d9)
#[derive(Debug, Clone)]
pub struct ObjectSpace {
    pub id: ExGuid,
    pub revision_list: RevisionManifestList,
    // Fira: shared (Rc) so a view of an older revision is cheap to make.
    pub id_to_object: Rc<HashMap<ExGuid, Rc<Object>>>,
    pub id_to_revision: Rc<HashMap<ExGuid, Rc<Revision>>>,
    /// Fira: objects per revision, so an object is resolved as of the current
    /// revision (walking its dependency chain) instead of "whichever revision
    /// was indexed last".
    pub revision_objects: Rc<HashMap<ExGuid, HashMap<ExGuid, Rc<Object>>>>,
    /// Fira: current revision (default context) and its dependency chain, newest first.
    pub current_chain: Vec<ExGuid>,
    /// Fira: the chain's objects flattened (newest version of each id). Looking
    /// an object up along a long chain on every access made pages with hundreds
    /// of revisions take minutes to read.
    pub resolved: Rc<HashMap<ExGuid, Rc<Object>>>,
    /// Fira: a view of an older revision keeps the page-level metadata (id, level,
    /// creation time) of the current one; older revisions often carry
    /// version-history metadata instead, which does not parse as a page.
    pub metadata_root_override: Option<ExGuid>,
}

impl ObjectSpace {
    pub fn try_parse(
        iterator: &mut FileNodeDataIterator,
        context: &ParseContext,
    ) -> Result<Option<Self>> {
        let next = iterator.peek();

        match next {
            Some(FileNodeData::ObjectSpaceManifestListReferenceFND(list_reference)) => {
                iterator.next();
                Ok(Some(Self::parse(iterator, list_reference, context)?))
            }
            _ => Ok(None),
        }
    }

    fn parse(
        _iterator: &mut FileNodeDataIterator,
        list_reference: &ObjectSpaceManifestListReferenceFND,
        context: &ParseContext,
    ) -> Result<Self> {
        let id = list_reference.gosid;
        let context = &context.with_context_id(id);
        let mut list_iterator = list_reference.last_revision.list.iter_data();
        let revision_list = RevisionManifestList::try_parse(&mut list_iterator, context)?;
        let revision_list = revision_list.ok_or_else(|| {
            ErrorKind::MalformedOneStoreData(
                "ObjectSpace should point to a RevisionManifestList".into(),
            )
        })?;
        let mut result = Self {
            id,
            revision_list,
            id_to_object: Rc::new(HashMap::new()),
            id_to_revision: Rc::new(HashMap::new()),
            revision_objects: Rc::new(HashMap::new()),
            current_chain: Vec::new(),
            resolved: Rc::new(HashMap::new()),
            metadata_root_override: None,
        };
        result.index_content()?;
        Ok(result)
    }

    fn index_content(&mut self) -> Result<()> {
        let mut id_to_object = HashMap::new();
        let mut id_to_revision = HashMap::new();
        let mut revision_objects: HashMap<ExGuid, HashMap<ExGuid, Rc<Object>>> = HashMap::new();
        for revision in &self.revision_list.revisions {
            // TODO: Use global_id_tables if present. This may be required for parsing
            //      .onetoc2 files, which allow references from one ID table to another.
            let _global_id_tables = &revision.global_id_tables;

            for object_group in &revision.object_groups {
                let id_table = &object_group.id_table;
                for object_ref in &object_group.objects {
                    let id = id_table.resolve_id(&object_ref.compact_id)?;
                    id_to_object.insert(id, object_ref.clone());
                    revision_objects.entry(revision.id).or_default().insert(id, object_ref.clone());
                }
            }
            id_to_revision.insert(revision.id, revision.clone());
        }
        self.id_to_object = Rc::new(id_to_object);
        self.id_to_revision = Rc::new(id_to_revision);
        self.revision_objects = Rc::new(revision_objects);
        if let Some(current) = self.revision_list.current_default() {
            self.current_chain = self.chain_from(current);
            self.resolved = Rc::new(self.flatten(&self.current_chain));
        }
        Ok(())
    }

    /// Fira: objects of a chain (newest first) as one map, newer versions winning.
    fn flatten(&self, chain: &[ExGuid]) -> HashMap<ExGuid, Rc<Object>> {
        let mut map = HashMap::new();
        for rid in chain.iter().rev() {
            if let Some(objects) = self.revision_objects.get(rid) {
                for (id, obj) in objects {
                    map.insert(*id, obj.clone());
                }
            }
        }
        map
    }

    /// Fira: `rid` and the revisions it depends on, newest first.
    fn chain_from(&self, start: ExGuid) -> Vec<ExGuid> {
        let mut chain = Vec::new();
        let mut cur = Some(start);
        while let Some(rid) = cur {
            if rid.is_nil() || chain.contains(&rid) || !self.id_to_revision.contains_key(&rid) {
                break;
            }
            chain.push(rid);
            cur = self.id_to_revision.get(&rid).map(|r| r.parent_id);
        }
        chain
    }

    /// Fira: first match along the current revision's dependency chain.
    fn from_current<T>(&self, pick: impl Fn(&Revision) -> Option<T>) -> Option<T> {
        self.current_chain.iter().find_map(|rid| self.id_to_revision.get(rid).and_then(|r| pick(r)))
    }
}

impl crate::onestore::object_space::ObjectSpace for ObjectSpace {
    fn get_object(&self, id: ExGuid) -> Option<Rc<ExportedObject>> {
        self.resolved
            .get(&id)
            .or_else(|| self.id_to_object.get(&id))
            .map(|result| result.data.clone())
    }

    fn content_root(&self) -> Option<ExGuid> {
        if let Some(root) = self.from_current(|r| r.content_root()) {
            return Some(root);
        }
        self.revision_list
            .revisions
            .iter()
            // TODO: It would make more sense to use the **last** revision, rather than
            //       the first to get the content root. However, doing so seems to return
            //       version history information, rather than the true content root.
            //       In the future, if there are issues related to importing the wrong versions
            //       of pages, look into this.
            // .rev()
            .find_map(|revision| revision.content_root())
    }

    fn history_revisions(&self) -> Vec<ExGuid> {
        // Every other revision in the list that carries roots, newest first.
        // Revisions are usually self-contained (no dependency chain), so the
        // earlier states live in the list, not behind the current revision.
        let current = self.current_chain.first().copied();
        self.revision_list
            .revisions
            .iter()
            .rev()
            // Earlier states are revisions that build on the current one with the
            // objects as they used to be (no roots of their own), plus OneNote's
            // page versions in other contexts. Anything that does not parse as a
            // page is skipped by the caller.
            .filter(|r| Some(r.id) != current)
            .map(|r| r.id)
            .collect()
    }

    fn at_revision(&self, rid: ExGuid) -> Option<crate::onestore::object_space::ObjectSpaceRef> {
        if !self.id_to_revision.contains_key(&rid) {
            return None;
        }
        let mut view = self.clone();
        view.metadata_root_override = crate::onestore::object_space::ObjectSpace::metadata_root(self);
        view.current_chain = self.chain_from(rid);
        view.resolved = Rc::new(view.flatten(&view.current_chain));
        Some(std::rc::Rc::new(view))
    }

    fn metadata_root(&self) -> Option<ExGuid> {
        if let Some(root) = self.metadata_root_override {
            return Some(root);
        }
        if let Some(root) = self.from_current(|r| r.metadata_root()) {
            return Some(root);
        }
        self.revision_list
            .revisions
            .iter()
            // .rev() // TODO: Why does calling .rev() result in the wrong metadata being returned?
            .find_map(|revision| revision.metadata_root())
    }
}
