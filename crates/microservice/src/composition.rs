use std::fmt::{self, Debug, Formatter};
use std::marker::PhantomData;

use crate::MicroserviceModule;

/// Stable identity of one installed module instance.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ModuleInstanceId(String);

impl ModuleInstanceId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Opaque binding target for one installed module instance.
pub struct ModuleHandle<Module: MicroserviceModule> {
    id: ModuleInstanceId,
    pub(crate) owner: u64,
    module: PhantomData<fn() -> Module>,
}

#[doc(hidden)]
pub trait ModuleHandleIdentity {
    fn module_instance_id(&self) -> &ModuleInstanceId;
    fn composition_owner(&self) -> u64;
}

impl<Module: MicroserviceModule> Debug for ModuleHandle<Module> {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ModuleHandle")
            .field("id", &self.id)
            .finish_non_exhaustive()
    }
}

impl<Module: MicroserviceModule> ModuleHandle<Module> {
    pub(crate) fn new(id: ModuleInstanceId, owner: u64) -> Self {
        Self {
            id,
            owner,
            module: PhantomData,
        }
    }

    pub fn id(&self) -> &ModuleInstanceId {
        &self.id
    }
}

impl<Module: MicroserviceModule> ModuleHandleIdentity for ModuleHandle<Module> {
    fn module_instance_id(&self) -> &ModuleInstanceId {
        &self.id
    }
    fn composition_owner(&self) -> u64 {
        self.owner
    }
}

#[cfg(test)]
mod tests {
    use crate::{Dependency, Port, Reference};

    trait Database: Send + Sync {}

    #[test]
    fn declares_independent_typed_relationship_slots() {
        let port = Port::<dyn Database>::new("database");
        let first = Dependency::new("database", port.clone());
        let second = Dependency::new("database", port.clone());
        let peer = Reference::new("peer", port);

        assert_eq!(first.name(), "database");
        assert_eq!(first.port().description(), "database");
        assert_ne!(first.slot_id(), second.slot_id());
        assert_eq!(peer.name(), "peer");
        assert_eq!(peer.port().description(), "database");
    }
}
