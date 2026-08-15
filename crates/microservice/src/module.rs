use std::future::Future;
use std::pin::Pin;

use crate::MicroserviceError;

/// The object-safe future returned by module lifecycle operations.
pub type ModuleFuture =
    Pin<Box<dyn Future<Output = Result<(), MicroserviceError>> + Send + 'static>>;

/// The lifecycle shared by every installed microservice module.
///
/// A passive module's [`Self::run`] future must eventually complete. The runtime waits for every
/// passive module before beginning the unwind phases. Long-running work that needs an explicit
/// shutdown signal should implement [`ActiveMicroserviceModule`] instead.
pub trait MicroserviceModule: Send {
    fn initialize(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }

    fn setup(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }

    fn run(&mut self) -> ModuleFuture;

    fn teardown(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }

    fn shutdown(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }

    fn cleanup(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }
}

/// A long-running module with a compile-time-required stop operation.
pub trait ActiveMicroserviceModule: MicroserviceModule {
    fn stop(&mut self) -> ModuleFuture;
}
