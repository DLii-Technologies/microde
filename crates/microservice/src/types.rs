/// Describes whether a module completes independently or requires a stop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModuleKind {
    Passive,
    Active,
}

/// The observable lifecycle state of a microservice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MicroserviceState {
    Idle,
    Installing,
    Initialization,
    Setup,
    Running,
    TearDown,
    Shutdown,
    CleanUp,
    Finished,
    Failed,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_kinds_are_distinct_copyable_values() {
        let passive = ModuleKind::Passive;
        let copied = passive;

        assert_eq!(passive, copied);
        assert_ne!(passive, ModuleKind::Active);
        assert_eq!(format!("{passive:?}"), "Passive");
    }

    #[test]
    fn lifecycle_states_preserve_the_runtime_vocabulary() {
        let states = [
            MicroserviceState::Idle,
            MicroserviceState::Installing,
            MicroserviceState::Initialization,
            MicroserviceState::Setup,
            MicroserviceState::Running,
            MicroserviceState::TearDown,
            MicroserviceState::Shutdown,
            MicroserviceState::CleanUp,
            MicroserviceState::Finished,
            MicroserviceState::Failed,
        ];

        assert_eq!(states.len(), 10);
        assert_eq!(states[0], MicroserviceState::Idle);
        assert_eq!(states[9], MicroserviceState::Failed);
    }
}
