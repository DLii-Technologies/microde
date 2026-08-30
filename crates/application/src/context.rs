use std::sync::Arc;

use crate::{MicrodeError, MicrodeStopRequest};

/// Operations exposed by a application to its installed modules.
pub trait MicrodeContext: Send + Sync {
    /// Requests an orderly stop and returns without waiting for lifecycle completion.
    fn request_stop(&self, request: MicrodeStopRequest);

    /// Terminates execution immediately, bypassing the orderly shutdown lifecycle.
    fn panic(&self, error: Option<MicrodeError>) -> !;
}

/// An independently owned module-facing context.
pub type MicrodeContextHandle = Arc<dyn MicrodeContext>;
