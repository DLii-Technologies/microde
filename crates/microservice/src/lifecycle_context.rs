use std::any::Any;
use std::collections::HashMap;
use std::sync::Arc;

use crate::{Dependency, MicroserviceError, ModuleInstanceId, Reference, RelationshipKind};

#[derive(Clone)]
pub(crate) struct ResolvedRelationship {
    pub(crate) owner: ModuleInstanceId,
    pub(crate) name: String,
    pub(crate) kind: RelationshipKind,
    pub(crate) value: Arc<dyn Any + Send + Sync>,
}

#[derive(Clone)]
pub struct SetupContext {
    owner: ModuleInstanceId,
    resolutions: Arc<HashMap<u64, ResolvedRelationship>>,
}

#[derive(Clone)]
pub struct RunContext {
    owner: ModuleInstanceId,
    resolutions: Arc<HashMap<u64, ResolvedRelationship>>,
}

impl SetupContext {
    pub(crate) fn new(
        owner: ModuleInstanceId,
        resolutions: Arc<HashMap<u64, ResolvedRelationship>>,
    ) -> Self {
        Self { owner, resolutions }
    }

    pub fn use_dependency<T>(&self, relationship: &Dependency<T>) -> Result<T, MicroserviceError>
    where
        T: Clone + Send + Sync + 'static,
    {
        resolve(
            &self.owner,
            &self.resolutions,
            relationship.slot_id(),
            relationship.name(),
            Some(RelationshipKind::Dependency),
        )
    }
}

pub trait RunRelationship<T> {
    fn slot_id(&self) -> u64;
    fn name(&self) -> &str;
}

impl<T> RunRelationship<T> for Dependency<T> {
    fn slot_id(&self) -> u64 {
        self.slot_id()
    }
    fn name(&self) -> &str {
        self.name()
    }
}

impl<T> RunRelationship<T> for Reference<T> {
    fn slot_id(&self) -> u64 {
        self.slot_id()
    }
    fn name(&self) -> &str {
        self.name()
    }
}

impl RunContext {
    pub(crate) fn new(
        owner: ModuleInstanceId,
        resolutions: Arc<HashMap<u64, ResolvedRelationship>>,
    ) -> Self {
        Self { owner, resolutions }
    }

    pub fn use_relationship<T, Slot>(&self, relationship: &Slot) -> Result<T, MicroserviceError>
    where
        T: Clone + Send + Sync + 'static,
        Slot: RunRelationship<T>,
    {
        resolve(
            &self.owner,
            &self.resolutions,
            relationship.slot_id(),
            relationship.name(),
            None,
        )
    }
}

fn resolve<T>(
    owner: &ModuleInstanceId,
    resolutions: &HashMap<u64, ResolvedRelationship>,
    slot_id: u64,
    name: &str,
    expected_kind: Option<RelationshipKind>,
) -> Result<T, MicroserviceError>
where
    T: Clone + Send + Sync + 'static,
{
    let resolved = resolutions
        .get(&slot_id)
        .filter(|value| &value.owner == owner)
        .ok_or_else(|| {
            MicroserviceError::new(format!(
                "relationship '{}.{}' is not resolved for this module",
                owner.as_str(),
                name
            ))
        })?;
    if expected_kind.is_some_and(|kind| resolved.kind != kind) {
        return Err(MicroserviceError::new(format!(
            "relationship '{}.{}' is not available during setup",
            owner.as_str(),
            resolved.name
        )));
    }
    resolved.value.downcast_ref::<T>().cloned().ok_or_else(|| {
        MicroserviceError::new(format!(
            "provider type mismatch for relationship '{}.{}'",
            owner.as_str(),
            resolved.name
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Port;

    fn resolved(
        owner: &str,
        name: &str,
        kind: RelationshipKind,
        value: Arc<dyn Any + Send + Sync>,
    ) -> ResolvedRelationship {
        ResolvedRelationship {
            owner: ModuleInstanceId::new(owner),
            name: name.to_owned(),
            kind,
            value,
        }
    }

    #[test]
    fn reports_unresolved_wrong_phase_and_provider_type_errors() {
        let dependency = Dependency::new("database", Port::<String>::new("database"));
        let mut values = HashMap::new();
        values.insert(
            dependency.slot_id(),
            resolved(
                "other",
                "database",
                RelationshipKind::Dependency,
                Arc::new("value".to_owned()),
            ),
        );
        let context = SetupContext::new(ModuleInstanceId::new("consumer"), Arc::new(values));
        assert_eq!(
            context.use_dependency(&dependency).unwrap_err().to_string(),
            "relationship 'consumer.database' is not resolved for this module"
        );

        let mut values = HashMap::new();
        values.insert(
            dependency.slot_id(),
            resolved(
                "consumer",
                "database",
                RelationshipKind::Reference,
                Arc::new("value".to_owned()),
            ),
        );
        let context = SetupContext::new(ModuleInstanceId::new("consumer"), Arc::new(values));
        assert_eq!(
            context.use_dependency(&dependency).unwrap_err().to_string(),
            "relationship 'consumer.database' is not available during setup"
        );

        let mut values = HashMap::new();
        values.insert(
            dependency.slot_id(),
            resolved(
                "consumer",
                "database",
                RelationshipKind::Dependency,
                Arc::new(7_u8),
            ),
        );
        let context = RunContext::new(ModuleInstanceId::new("consumer"), Arc::new(values));
        assert_eq!(
            context
                .use_relationship::<String, _>(&dependency)
                .unwrap_err()
                .to_string(),
            "provider type mismatch for relationship 'consumer.database'"
        );
    }
}
