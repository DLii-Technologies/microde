use crate::{ActiveMicroserviceModule, MicroserviceModule, ModuleFuture, ModuleKind};

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

pub(crate) enum InstalledModule {
    Passive {
        module: Box<dyn MicroserviceModule>,
        stage: ModuleStage,
    },
    Active {
        module: Box<dyn ActiveMicroserviceModule>,
        stage: ModuleStage,
    },
}

impl InstalledModule {
    pub(crate) fn passive(module: impl MicroserviceModule + 'static) -> Self {
        Self::Passive {
            module: Box::new(module),
            stage: ModuleStage::Installed,
        }
    }

    pub(crate) fn active(module: impl ActiveMicroserviceModule + 'static) -> Self {
        Self::Active {
            module: Box::new(module),
            stage: ModuleStage::Installed,
        }
    }

    pub(crate) fn kind(&self) -> ModuleKind {
        match self {
            Self::Passive { .. } => ModuleKind::Passive,
            Self::Active { .. } => ModuleKind::Active,
        }
    }

    pub(crate) fn stage(&self) -> ModuleStage {
        match self {
            Self::Passive { stage, .. } | Self::Active { stage, .. } => *stage,
        }
    }

    pub(crate) fn set_stage(&mut self, next_stage: ModuleStage) {
        match self {
            Self::Passive { stage, .. } | Self::Active { stage, .. } => *stage = next_stage,
        }
    }

    pub(crate) fn initialize(&mut self) -> ModuleFuture {
        match self {
            Self::Passive { module, .. } => module.initialize(),
            Self::Active { module, .. } => module.initialize(),
        }
    }

    pub(crate) fn setup(&mut self) -> ModuleFuture {
        match self {
            Self::Passive { module, .. } => module.setup(),
            Self::Active { module, .. } => module.setup(),
        }
    }

    pub(crate) fn run(&mut self) -> ModuleFuture {
        match self {
            Self::Passive { module, .. } => module.run(),
            Self::Active { module, .. } => module.run(),
        }
    }

    pub(crate) fn stop(&mut self) -> Option<ModuleFuture> {
        match self {
            Self::Passive { .. } => None,
            Self::Active { module, .. } => Some(module.stop()),
        }
    }

    pub(crate) fn teardown(&mut self) -> ModuleFuture {
        match self {
            Self::Passive { module, .. } => module.teardown(),
            Self::Active { module, .. } => module.teardown(),
        }
    }

    pub(crate) fn shutdown(&mut self) -> ModuleFuture {
        match self {
            Self::Passive { module, .. } => module.shutdown(),
            Self::Active { module, .. } => module.shutdown(),
        }
    }

    pub(crate) fn cleanup(&mut self) -> ModuleFuture {
        match self {
            Self::Passive { module, .. } => module.cleanup(),
            Self::Active { module, .. } => module.cleanup(),
        }
    }
}

#[cfg(test)]
#[path = "../tests/installed_module.rs"]
mod tests;
