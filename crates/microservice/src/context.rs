use std::sync::Arc;

use crate::{MicroserviceError, MicroserviceStopRequest};

/// Operations exposed by a microservice to its installed modules.
pub trait MicroserviceContext: Send + Sync {
    /// Requests an orderly stop and returns without waiting for lifecycle completion.
    fn request_stop(&self, request: MicroserviceStopRequest);

    /// Terminates execution immediately, bypassing the orderly shutdown lifecycle.
    fn panic(&self, error: Option<MicroserviceError>) -> !;
}

/// An independently owned module-facing context.
pub type MicroserviceContextHandle = Arc<dyn MicroserviceContext>;
