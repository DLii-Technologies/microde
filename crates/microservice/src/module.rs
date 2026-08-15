use std::future::Future;
use std::pin::Pin;

use crate::{MicroserviceError, ModuleKind};

/// The object-safe future returned by module lifecycle operations.
pub type ModuleFuture =
    Pin<Box<dyn Future<Output = Result<(), MicroserviceError>> + Send + 'static>>;

/// The lifecycle shared by every installed microservice module.
pub trait MicroserviceModule: Send {
    /// Declares how the runtime interprets completion of [`Self::run`].
    const KIND: ModuleKind;

    fn initialize(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }

    fn setup(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }

    fn run(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }

    fn stop(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }

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

pub(crate) trait RuntimeModule: Send {
    fn initialize(&mut self) -> ModuleFuture;
    fn setup(&mut self) -> ModuleFuture;
    fn run(&mut self) -> ModuleFuture;
    fn stop(&mut self) -> ModuleFuture;
    fn teardown(&mut self) -> ModuleFuture;
    fn shutdown(&mut self) -> ModuleFuture;
    fn cleanup(&mut self) -> ModuleFuture;
}

impl<Module: MicroserviceModule> RuntimeModule for Module {
    fn initialize(&mut self) -> ModuleFuture {
        MicroserviceModule::initialize(self)
    }
    fn setup(&mut self) -> ModuleFuture {
        MicroserviceModule::setup(self)
    }
    fn run(&mut self) -> ModuleFuture {
        MicroserviceModule::run(self)
    }
    fn stop(&mut self) -> ModuleFuture {
        MicroserviceModule::stop(self)
    }
    fn teardown(&mut self) -> ModuleFuture {
        MicroserviceModule::teardown(self)
    }
    fn shutdown(&mut self) -> ModuleFuture {
        MicroserviceModule::shutdown(self)
    }
    fn cleanup(&mut self) -> ModuleFuture {
        MicroserviceModule::cleanup(self)
    }
}
