use std::sync::{Arc, Mutex};

use super::*;
use crate::{
    Dependency, Port, Provider, Reference, RelationshipDescriptor, RunContext, SetupContext,
};

#[derive(Clone)]
struct Database(&'static str);

struct ProviderModule {
    port: Port<Database>,
    database: Database,
    events: Arc<Mutex<Vec<&'static str>>>,
}

impl MicrodeModule for ProviderModule {
    const KIND: ModuleKind = ModuleKind::Passive;

    fn providers(&self) -> Vec<Provider> {
        vec![Provider::new(self.port.clone(), self.database.clone())]
    }

    fn initialize(&mut self) -> ModuleFuture {
        self.events.lock().unwrap().push("provider");
        Box::pin(async { Ok(()) })
    }
}

struct ConsumerModule {
    database: Dependency<Database>,
    events: Arc<Mutex<Vec<&'static str>>>,
}

impl MicrodeModule for ConsumerModule {
    const KIND: ModuleKind = ModuleKind::Passive;

    fn relationships(&self) -> Vec<RelationshipDescriptor> {
        vec![self.database.descriptor()]
    }

    fn initialize(&mut self) -> ModuleFuture {
        self.events.lock().unwrap().push("consumer");
        Box::pin(async { Ok(()) })
    }
}

#[test]
fn binds_exact_providers_and_applies_dependency_first_order() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let port = Port::new("database");
    let dependency = Dependency::new("database", port.clone());
    let mut service = MicrodeApplication::new();
    let consumer = service
        .install_named("consumer", |_| ConsumerModule {
            database: dependency.clone(),
            events: events.clone(),
        })
        .unwrap();
    let provider = service
        .install_named("provider", |_| ProviderModule {
            port,
            database: Database("primary"),
            events: events.clone(),
        })
        .unwrap();

    service.bind(&consumer, &dependency, &provider).unwrap();
    let result = futures::executor::block_on(service.serve()).unwrap();
    assert_eq!(result.exit_code, 0);
    assert_eq!(*events.lock().unwrap(), vec!["provider", "consumer"]);
}

#[test]
fn rejects_duplicate_missing_incompatible_and_foreign_bindings() {
    let port = Port::new("database");
    let dependency = Dependency::new("database", port.clone());
    let mut service = MicrodeApplication::new();
    let consumer = service
        .install_named("consumer", |_| ConsumerModule {
            database: dependency.clone(),
            events: Arc::new(Mutex::new(Vec::new())),
        })
        .unwrap();
    let provider = service
        .install_named("provider", |_| ProviderModule {
            port: port.clone(),
            database: Database("primary"),
            events: Arc::new(Mutex::new(Vec::new())),
        })
        .unwrap();
    service.bind(&consumer, &dependency, &provider).unwrap();
    assert_eq!(
        service
            .bind(&consumer, &dependency, &provider)
            .unwrap_err()
            .to_string(),
        "relationship 'consumer.database' is already bound"
    );

    let missing = Dependency::new("missing", port.clone());
    assert_eq!(
        service
            .bind(&consumer, &missing, &provider)
            .unwrap_err()
            .to_string(),
        "unknown relationship 'consumer.missing'"
    );

    let other_port = Port::new("other");
    let other_dependency = Dependency::new("other", other_port);
    let other_consumer = service
        .install_named("other-consumer", |_| ConsumerModule {
            database: other_dependency.clone(),
            events: Arc::new(Mutex::new(Vec::new())),
        })
        .unwrap();
    assert_eq!(
        service
            .bind(&other_consumer, &other_dependency, &provider)
            .unwrap_err()
            .to_string(),
        "module 'provider' does not provide port 'other'"
    );

    let mut foreign_service = MicrodeApplication::new();
    let foreign = foreign_service
        .install_named("foreign", |_| ProviderModule {
            port,
            database: Database("foreign"),
            events: Arc::new(Mutex::new(Vec::new())),
        })
        .unwrap();
    assert_eq!(
        service
            .bind(&consumer, &dependency, &foreign)
            .unwrap_err()
            .to_string(),
        "module handle 'foreign' belongs to another application"
    );
}

#[test]
fn missing_binding_rejects_run_before_lifecycle_execution() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let port = Port::new("database");
    let dependency = Dependency::new("database", port);
    let mut service = MicrodeApplication::new();
    service
        .install_named("consumer", |_| ConsumerModule {
            database: dependency,
            events: events.clone(),
        })
        .unwrap();

    assert_eq!(
        futures::executor::block_on(service.serve())
            .unwrap_err()
            .to_string(),
        "missing binding for relationship 'consumer.database'"
    );
    assert!(events.lock().unwrap().is_empty());
}

struct AccessModule {
    database: Dependency<Database>,
    peer: Reference<Database>,
    values: Arc<Mutex<Vec<String>>>,
}

impl MicrodeModule for AccessModule {
    const KIND: ModuleKind = ModuleKind::Passive;

    fn relationships(&self) -> Vec<RelationshipDescriptor> {
        vec![self.database.descriptor(), self.peer.descriptor()]
    }

    fn setup_with_context(&mut self, context: SetupContext) -> ModuleFuture {
        let database = context.use_dependency(&self.database).unwrap();
        self.values
            .lock()
            .unwrap()
            .push(format!("setup:{}", database.0));
        Box::pin(async { Ok(()) })
    }

    fn run_with_context(&mut self, context: RunContext) -> ModuleFuture {
        let database: Database = context.use_relationship(&self.database).unwrap();
        let peer: Database = context.use_relationship(&self.peer).unwrap();
        let mut values = self.values.lock().unwrap();
        values.push(format!("run:{}", database.0));
        values.push(format!("reference:{}", peer.0));
        Box::pin(async { Ok(()) })
    }
}

#[test]
fn exposes_dependencies_in_setup_and_both_relationship_kinds_in_run() {
    let values = Arc::new(Mutex::new(Vec::new()));
    let port = Port::new("database-access");
    let database = Dependency::new("database", port.clone());
    let peer = Reference::new("peer", port.clone());
    let mut service = MicrodeApplication::new();
    let consumer = service
        .install_named("consumer", |_| AccessModule {
            database: database.clone(),
            peer: peer.clone(),
            values: values.clone(),
        })
        .unwrap();
    let provider = service
        .install_named("provider", |_| ProviderModule {
            port,
            database: Database("primary"),
            events: Arc::new(Mutex::new(Vec::new())),
        })
        .unwrap();
    service.bind(&consumer, &database, &provider).unwrap();
    service.bind(&consumer, &peer, &provider).unwrap();

    futures::executor::block_on(service.serve()).unwrap();
    assert_eq!(
        *values.lock().unwrap(),
        vec!["setup:primary", "run:primary", "reference:primary"]
    );
}

struct GraphNode {
    relationship: RelationshipDescriptor,
    provider: Provider,
}

impl MicrodeModule for GraphNode {
    const KIND: ModuleKind = ModuleKind::Passive;
    fn relationships(&self) -> Vec<RelationshipDescriptor> {
        vec![self.relationship.clone()]
    }
    fn providers(&self) -> Vec<Provider> {
        vec![self.provider.clone()]
    }
}

#[test]
fn rejects_dependency_cycles_but_allows_reference_cycles() {
    let port = Port::<String>::new("cycle");
    let a_dependency = Dependency::new("peer", port.clone());
    let b_dependency = Dependency::new("peer", port.clone());
    let mut cyclic = MicrodeApplication::new();
    let a = cyclic
        .install_named("a", |_| GraphNode {
            relationship: a_dependency.descriptor(),
            provider: Provider::new(port.clone(), "a".to_owned()),
        })
        .unwrap();
    let b = cyclic
        .install_named("b", |_| GraphNode {
            relationship: b_dependency.descriptor(),
            provider: Provider::new(port.clone(), "b".to_owned()),
        })
        .unwrap();
    cyclic.bind(&a, &a_dependency, &b).unwrap();
    cyclic.bind(&b, &b_dependency, &a).unwrap();
    assert_eq!(
        futures::executor::block_on(cyclic.serve())
            .unwrap_err()
            .to_string(),
        "dependency cycle detected: a -> b -> a"
    );

    let a_reference = Reference::new("peer", port.clone());
    let b_reference = Reference::new("peer", port.clone());
    let mut referenced = MicrodeApplication::new();
    let a = referenced
        .install_named("a", |_| GraphNode {
            relationship: a_reference.descriptor(),
            provider: Provider::new(port.clone(), "a".to_owned()),
        })
        .unwrap();
    let b = referenced
        .install_named("b", |_| GraphNode {
            relationship: b_reference.descriptor(),
            provider: Provider::new(port, "b".to_owned()),
        })
        .unwrap();
    referenced.bind(&a, &a_reference, &b).unwrap();
    referenced.bind(&b, &b_reference, &a).unwrap();
    assert_eq!(
        futures::executor::block_on(referenced.serve())
            .unwrap()
            .exit_code,
        0
    );
}

#[test]
fn rejects_binding_after_lifecycle_execution_and_foreign_consumers() {
    let port = Port::<String>::new("binding-state");
    let dependency = Dependency::new("peer", port.clone());
    let mut service = MicrodeApplication::new();
    let provider = service
        .install_named("provider", |_| ProviderModule {
            port: Port::new("unused"),
            database: Database("value"),
            events: Arc::new(Mutex::new(Vec::new())),
        })
        .unwrap();
    futures::executor::block_on(service.serve()).unwrap();
    assert!(service.bind(&provider, &dependency, &provider).is_err());

    let mut first = MicrodeApplication::new();
    let foreign = first
        .install_named("foreign", |_| GraphNode {
            relationship: dependency.descriptor(),
            provider: Provider::new(port.clone(), "foreign".to_owned()),
        })
        .unwrap();
    let mut second = MicrodeApplication::new();
    let local = second
        .install_named("local", |_| GraphNode {
            relationship: dependency.descriptor(),
            provider: Provider::new(port, "local".to_owned()),
        })
        .unwrap();
    assert_eq!(
        second
            .bind(&foreign, &dependency, &local)
            .unwrap_err()
            .to_string(),
        "module handle 'foreign' belongs to another application"
    );
}

#[test]
fn provider_creation_failure_is_atomic_and_permanently_seals_composition() {
    let port = Port::<String>::new("factory");
    let dependency = Dependency::new("provider", port.clone());
    let mut service = MicrodeApplication::new();
    let consumer = service
        .install_named("consumer", |_| GraphNode {
            relationship: dependency.descriptor(),
            provider: Provider::new(port.clone(), "consumer".to_owned()),
        })
        .unwrap();
    let provider = service
        .install_named("provider", |_| FactoryProviderNode {
            provider: Provider::try_new(port.clone(), || {
                Err(MicrodeError::new("provider creation failed"))
            }),
        })
        .unwrap();
    service.bind(&consumer, &dependency, &provider).unwrap();

    assert_eq!(
        futures::executor::block_on(service.serve())
            .unwrap_err()
            .to_string(),
        "provider creation failed"
    );
    assert!(service.install_named("late", |_| PassiveGraphNode).is_err());
    assert!(service.bind(&consumer, &dependency, &provider).is_err());
    assert_eq!(
        futures::executor::block_on(service.serve())
            .unwrap_err()
            .to_string(),
        "cannot start application more than once; composition is sealed"
    );
}

struct PassiveGraphNode;
impl MicrodeModule for PassiveGraphNode {
    const KIND: ModuleKind = ModuleKind::Passive;
}

struct FactoryProviderNode {
    provider: Provider,
}

#[test]
fn validates_concrete_module_requirements_without_exposing_modules() {
    let port = Port::<Database>::for_module::<ProviderModule>("concrete-database");
    let dependency = Dependency::new("database", port.clone());
    let mut valid = MicrodeApplication::new();
    let consumer = valid
        .install_named("consumer", |_| ConsumerModule {
            database: dependency.clone(),
            events: Arc::new(Mutex::new(Vec::new())),
        })
        .unwrap();
    let provider = valid
        .install_named("provider", |_| ProviderModule {
            port: port.clone(),
            database: Database("primary"),
            events: Arc::new(Mutex::new(Vec::new())),
        })
        .unwrap();
    valid.bind(&consumer, &dependency, &provider).unwrap();

    let mut invalid = MicrodeApplication::new();
    let invalid_consumer = invalid
        .install_named("consumer", |_| ConsumerModule {
            database: dependency.clone(),
            events: Arc::new(Mutex::new(Vec::new())),
        })
        .unwrap();
    let impostor = invalid
        .install_named("impostor", |_| ConcreteImpostor {
            provider: Provider::new(port, Database("impostor")),
        })
        .unwrap();
    assert_eq!(
        invalid
            .bind(&invalid_consumer, &dependency, &impostor)
            .unwrap_err()
            .to_string(),
        "module 'impostor' does not satisfy concrete module requirement 'ProviderModule'"
    );
}

struct ConcreteImpostor {
    provider: Provider,
}
impl MicrodeModule for ConcreteImpostor {
    const KIND: ModuleKind = ModuleKind::Passive;
    fn providers(&self) -> Vec<Provider> {
        vec![self.provider.clone()]
    }
}
impl MicrodeModule for FactoryProviderNode {
    const KIND: ModuleKind = ModuleKind::Passive;
    fn providers(&self) -> Vec<Provider> {
        vec![self.provider.clone()]
    }
}
