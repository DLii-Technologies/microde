use crate::{
    MicrodeModule, ModuleFuture, ModuleInstanceId, ModuleKind, Provider, RelationshipDescriptor,
    RunContext, SetupContext, module::RuntimeModule,
};
use std::any::TypeId;

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
    id: ModuleInstanceId,
    kind: ModuleKind,
    module: Box<dyn RuntimeModule>,
    stage: ModuleStage,
    relationships: Vec<RelationshipDescriptor>,
    providers: Vec<Provider>,
    module_type: TypeId,
}

impl InstalledModule {
    pub(crate) fn new<Module: MicrodeModule + 'static>(
        id: ModuleInstanceId,
        module: Module,
    ) -> Self {
        let relationships = module.relationships();
        let providers = module.providers();
        Self {
            id,
            kind: Module::KIND,
            module: Box::new(module),
            stage: ModuleStage::Installed,
            relationships,
            providers,
            module_type: TypeId::of::<Module>(),
        }
    }

    pub(crate) fn id(&self) -> &ModuleInstanceId {
        &self.id
    }
    pub(crate) fn relationships(&self) -> &[RelationshipDescriptor] {
        &self.relationships
    }
    pub(crate) fn providers(&self) -> &[Provider] {
        &self.providers
    }
    pub(crate) fn module_type(&self) -> TypeId {
        self.module_type
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
    pub(crate) fn setup_with_context(&mut self, context: SetupContext) -> ModuleFuture {
        self.module.setup_with_context(context)
    }
    pub(crate) fn run_with_context(&mut self, context: RunContext) -> ModuleFuture {
        self.module.run_with_context(context)
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
