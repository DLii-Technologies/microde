use crate::{MicroserviceModule, ModuleFuture, ModuleKind, module::RuntimeModule};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum ModuleStage {
    Installed,
    Initializing,
    Initialized,
    SettingUp,
    SetUp,
    Executing,
    Executed,
    TearingDown,
    TornDown,
    ShuttingDown,
    Shutdown,
    CleaningUp,
    CleanedUp,
}

pub(crate) struct InstalledModule {
    kind: ModuleKind,
    module: Box<dyn RuntimeModule>,
    stage: ModuleStage,
}

impl InstalledModule {
    pub(crate) fn new<Module: MicroserviceModule + 'static>(module: Module) -> Self {
        Self {
            kind: Module::KIND,
            module: Box::new(module),
            stage: ModuleStage::Installed,
        }
    }

    pub(crate) fn kind(&self) -> ModuleKind {
        self.kind
    }
    pub(crate) fn stage(&self) -> ModuleStage {
        self.stage
    }
    pub(crate) fn set_stage(&mut self, next_stage: ModuleStage) {
        self.stage = next_stage;
    }
    pub(crate) fn initialize(&mut self) -> ModuleFuture {
        self.module.initialize()
    }
    pub(crate) fn setup(&mut self) -> ModuleFuture {
        self.module.setup()
    }
    pub(crate) fn run(&mut self) -> ModuleFuture {
        self.module.run()
    }
    pub(crate) fn stop(&mut self) -> ModuleFuture {
        self.module.stop()
    }
    pub(crate) fn teardown(&mut self) -> ModuleFuture {
        self.module.teardown()
    }
    pub(crate) fn shutdown(&mut self) -> ModuleFuture {
        self.module.shutdown()
    }
    pub(crate) fn cleanup(&mut self) -> ModuleFuture {
        self.module.cleanup()
    }
}

#[cfg(test)]
#[path = "../tests/installed_module.rs"]
mod tests;
