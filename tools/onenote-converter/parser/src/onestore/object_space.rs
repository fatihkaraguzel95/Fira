use super::object::Object;
use crate::shared::exguid::ExGuid;
use std::rc::Rc;

pub trait ObjectSpace: std::fmt::Debug {
    fn get_object(&self, id: ExGuid) -> Option<Rc<Object>>;
    fn content_root(&self) -> Option<ExGuid>;
    fn metadata_root(&self) -> Option<ExGuid>;
    /// Fira: older revisions of this space (current revision's dependency chain,
    /// newest first, the current one excluded). Empty where not supported.
    fn history_revisions(&self) -> Vec<ExGuid> {
        Vec::new()
    }
    /// Fira: this space as it was at `rid` (one of `history_revisions`).
    fn at_revision(&self, _rid: ExGuid) -> Option<ObjectSpaceRef> {
        None
    }
}

pub type ObjectSpaceRef = Rc<dyn ObjectSpace>;
