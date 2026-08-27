use std::any::TypeId;
use std::marker::PhantomData;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_PORT_ID: AtomicU64 = AtomicU64::new(0);
static NEXT_SLOT_ID: AtomicU64 = AtomicU64::new(0);

/// Nominal runtime identity for a provider contract.
pub struct Port<T: ?Sized> {
    id: u64,
    description: String,
    contract: PhantomData<fn() -> T>,
    module_type: Option<(TypeId, &'static str)>,
}

impl<T: ?Sized> Port<T> {
    pub fn new(description: impl Into<String>) -> Self {
        Self {
            id: NEXT_PORT_ID.fetch_add(1, Ordering::Relaxed),
            description: description.into(),
            contract: PhantomData,
            module_type: None,
        }
    }

    pub fn description(&self) -> &str {
        &self.description
    }

    pub fn for_module<Module: crate::MicrodeModule + 'static>(
        description: impl Into<String>,
    ) -> Self {
        Self {
            id: NEXT_PORT_ID.fetch_add(1, Ordering::Relaxed),
            description: description.into(),
            contract: PhantomData,
            module_type: Some((TypeId::of::<Module>(), std::any::type_name::<Module>())),
        }
    }
}

impl<T: ?Sized> Clone for Port<T> {
    fn clone(&self) -> Self {
        Self {
            id: self.id,
            description: self.description.clone(),
            contract: PhantomData,
            module_type: self.module_type,
        }
    }
}

struct Relationship<T: ?Sized> {
    slot_id: u64,
    name: String,
    port: Port<T>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelationshipKind {
    Dependency,
    Reference,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelationshipDescriptor {
    pub(crate) slot_id: u64,
    pub(crate) name: String,
    pub(crate) port_id: u64,
    pub(crate) port_description: String,
    pub(crate) kind: RelationshipKind,
    pub(crate) module_type: Option<(TypeId, &'static str)>,
}

pub trait RelationshipSlot {
    fn descriptor(&self) -> RelationshipDescriptor;
}

impl<T: ?Sized> Relationship<T> {
    fn new(name: impl Into<String>, port: Port<T>) -> Self {
        Self {
            slot_id: NEXT_SLOT_ID.fetch_add(1, Ordering::Relaxed),
            name: name.into(),
            port,
        }
    }
}

macro_rules! relationship_handle {
    ($name:ident, $kind:expr) => {
        pub struct $name<T: ?Sized>(Relationship<T>);

        impl<T: ?Sized> Clone for $name<T> {
            fn clone(&self) -> Self {
                Self(Relationship {
                    slot_id: self.0.slot_id,
                    name: self.0.name.clone(),
                    port: self.0.port.clone(),
                })
            }
        }

        impl<T: ?Sized> $name<T> {
            pub fn new(name: impl Into<String>, port: Port<T>) -> Self {
                Self(Relationship::new(name, port))
            }

            pub fn name(&self) -> &str {
                &self.0.name
            }

            pub fn port(&self) -> &Port<T> {
                &self.0.port
            }

            pub(crate) fn slot_id(&self) -> u64 {
                self.0.slot_id
            }
        }

        impl<T: ?Sized> RelationshipSlot for $name<T> {
            fn descriptor(&self) -> RelationshipDescriptor {
                RelationshipDescriptor {
                    slot_id: self.0.slot_id,
                    name: self.0.name.clone(),
                    port_id: self.0.port.id,
                    port_description: self.0.port.description.clone(),
                    kind: $kind,
                    module_type: self.0.port.module_type,
                }
            }
        }
    };
}

relationship_handle!(Dependency, RelationshipKind::Dependency);
relationship_handle!(Reference, RelationshipKind::Reference);

#[derive(Clone)]
pub struct Provider {
    pub(crate) port_id: u64,
    resolver: Arc<
        dyn Fn() -> Result<Arc<dyn std::any::Any + Send + Sync>, crate::MicrodeError> + Send + Sync,
    >,
}

impl Provider {
    pub fn new<T: Send + Sync + 'static>(port: Port<T>, value: T) -> Self {
        let value: Arc<dyn std::any::Any + Send + Sync> = Arc::new(value);
        Self {
            port_id: port.id,
            resolver: Arc::new(move || Ok(value.clone())),
        }
    }

    pub fn try_new<T, Factory>(port: Port<T>, factory: Factory) -> Self
    where
        T: Send + Sync + 'static,
        Factory: Fn() -> Result<T, crate::MicrodeError> + Send + Sync + 'static,
    {
        Self {
            port_id: port.id,
            resolver: Arc::new(move || {
                factory().map(|value| Arc::new(value) as Arc<dyn std::any::Any + Send + Sync>)
            }),
        }
    }

    pub(crate) fn resolve(
        &self,
    ) -> Result<Arc<dyn std::any::Any + Send + Sync>, crate::MicrodeError> {
        (self.resolver)()
    }
}
