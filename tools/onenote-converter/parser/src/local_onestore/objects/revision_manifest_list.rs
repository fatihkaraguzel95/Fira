use std::{collections::HashMap, rc::Rc};

use crate::{
    local_onestore::{
        file_node::{FileNodeData, file_node::RevisionManifestListStartFND},
        file_structure::FileNodeDataIterator,
        objects::{parse_context::ParseContext, revision::Revision},
    },
    shared::exguid::ExGuid,
};
use parser_utils::{
    errors::{ErrorKind, Result},
    log_warn,
};

#[derive(Debug, Clone)]
pub struct RevisionManifestList {
    pub revisions: Vec<Rc<Revision>>,
    /// Fira: the current revision for each (context, role) pair — MS-ONESTORE
    /// 2.1.8: the last revision manifest or role declaration for a pair wins.
    /// Upstream read the *first* revision's roots, which yields an old version
    /// of a page (truncated text, unchecked boxes, "Untitled Page").
    pub current: HashMap<(ExGuid, u32), ExGuid>,
}

impl RevisionManifestList {
    /// The revision that holds the page as it is now (default context, role 0x1).
    pub fn current_default(&self) -> Option<ExGuid> {
        let default_context = ExGuid { guid: crate::shared::guid::Guid::nil(), value: 0 };
        self.current.get(&(default_context, 0x1)).copied()
    }
}

impl RevisionManifestList {
    pub fn try_parse(
        iterator: &mut FileNodeDataIterator,
        context: &ParseContext,
    ) -> Result<Option<Self>> {
        let next = iterator.peek();

        match next {
            Some(FileNodeData::RevisionManifestListStartFND(list_reference)) => {
                iterator.next();
                Ok(Some(Self::parse(iterator, list_reference, context)?))
            }
            _ => Ok(None),
        }
    }

    fn parse(
        iterator: &mut FileNodeDataIterator,
        _list_reference: &RevisionManifestListStartFND,
        context: &ParseContext,
    ) -> Result<Self> {
        let mut revisions = Vec::new();
        let mut by_role: HashMap<(ExGuid, u32), ExGuid> = HashMap::new();
        let default_context = ExGuid { guid: crate::shared::guid::Guid::nil(), value: 0 };
        // Also create a temporary map to simplify revision lookup while building
        let mut revisions_map: HashMap<ExGuid, _> = HashMap::new();

        let mut last_index = iterator.get_index();
        while let Some(current) = iterator.peek() {
            match current {
                FileNodeData::RevisionManifestEndFND => {
                    break;
                }
                FileNodeData::RevisionRoleDeclarationFND(data) => {
                    // Re-declares an earlier revision as current for (default context, role).
                    by_role.insert((default_context, data.revision_role), data.rid);
                    iterator.next();
                }
                FileNodeData::RevisionRoleAndContextDeclarationFND(data) => {
                    // Adds an additional (revision role, context) pair to some prior revision
                    // in the list.
                    // See [MS-ONESTORE 2.5.18](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-onestore/4863b0e8-fe14-49bb-a634-558c747bf0b8).
                    let revision = revisions_map.get(&data.base.rid);
                    if let Some(_revision) = revision {
                        by_role.insert((data.gctxid, data.base.revision_role), data.base.rid);
                        iterator.next();

                        // According to MS-ONESTORE 2.1.12, revision_role *should* always be 0x1
                        if data.base.revision_role != 0x1 {
                            // TODO: Find a test .one file that uses this and implement:
                            log_warn!(
                                "TO-DO: Apply the new role and context to the revision (role {:x})",
                                data.base.revision_role
                            );
                        }
                    } else {
                        return Err(
                            ErrorKind::MalformedOneStoreData("RevisionRoleAndContextDeclarationFND points to a non-existent revision".into()).into()
                        );
                    }
                }
                node => {
                    let revision = Revision::try_parse(iterator, context)?.ok_or_else(|| {
                        onestore_parse_error!(
                            "Unexpected node encountered in RevisionManifestList: {:?}",
                            node
                        )
                    })?;
                    let revision_ref = Rc::new(revision);
                    by_role.insert((revision_ref.context, revision_ref.role), revision_ref.id);
                    revisions.push(revision_ref.clone());
                    revisions_map.insert(revision_ref.id, revision_ref);
                }
            }

            let index = iterator.get_index();
            assert_ne!(index, last_index);
            last_index = index;
        }
        Ok(RevisionManifestList { revisions, current: by_role })
    }
}
