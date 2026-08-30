use std::future::Future;
use std::pin::Pin;

use crate::{MicrodeError, ModuleKind, Provider, RelationshipDescriptor, RunContext, SetupContext};

/// The object-safe future returned by module lifecycle operations.
pub type ModuleFuture = Pin<Box<dyn Future<Output = Result<(), MicrodeError>> + Send + 'static>>;

/// The lifecycle shared by every installed Microde module.
pub trait MicrodeModule: Send {
    /// Declares how the runtime interprets completion of [`Self::run`].
    const KIND: ModuleKind;

    fn relationships(&self) -> Vec<RelationshipDescriptor> {
        Vec::new()
    }

    fn providers(&self) -> Vec<Provider> {
        Vec::new()
    }

    fn initialize(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }

    fn setup(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }

    fn setup_with_context(&mut self, _context: SetupContext) -> ModuleFuture {
        self.setup()
    }

    fn run(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }

    fn run_with_context(&mut self, _context: RunContext) -> ModuleFuture {
        self.run()
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
    fn setup_with_context(&mut self, context: SetupContext) -> ModuleFuture;
    fn run_with_context(&mut self, context: RunContext) -> ModuleFuture;
    fn stop(&mut self) -> ModuleFuture;
    fn teardown(&mut self) -> ModuleFuture;
    fn shutdown(&mut self) -> ModuleFuture;
    fn cleanup(&mut self) -> ModuleFuture;
}

impl<Module: MicrodeModule> RuntimeModule for Module {
    fn initialize(&mut self) -> ModuleFuture {
        MicrodeModule::initialize(self)
    }
    fn setup_with_context(&mut self, context: SetupContext) -> ModuleFuture {
        MicrodeModule::setup_with_context(self, context)
    }
    fn run_with_context(&mut self, context: RunContext) -> ModuleFuture {
        MicrodeModule::run_with_context(self, context)
    }
    fn stop(&mut self) -> ModuleFuture {
        MicrodeModule::stop(self)
    }
    fn teardown(&mut self) -> ModuleFuture {
        MicrodeModule::teardown(self)
    }
    fn shutdown(&mut self) -> ModuleFuture {
        MicrodeModule::shutdown(self)
    }
    fn cleanup(&mut self) -> ModuleFuture {
        MicrodeModule::cleanup(self)
    }
}
