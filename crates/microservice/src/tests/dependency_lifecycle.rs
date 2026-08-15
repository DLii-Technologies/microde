use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::*;
use crate::{
    Dependency, ModuleHandle, Port, Provider, Reference, RelationshipDescriptor, RelationshipSlot,
};

struct FixtureNode {
    name: String,
    events: Arc<Mutex<Vec<String>>>,
    relationships: Vec<RelationshipDescriptor>,
    provider: Provider,
    fail_setup: bool,
}

impl FixtureNode {
    fn record(&self, phase: &str) {
        self.events
            .lock()
            .unwrap()
            .push(format!("{phase}:{}", self.name));
    }
}

impl MicroserviceModule for FixtureNode {
    const KIND: ModuleKind = ModuleKind::Passive;
    fn relationships(&self) -> Vec<RelationshipDescriptor> {
        self.relationships.clone()
    }
    fn providers(&self) -> Vec<Provider> {
        vec![self.provider.clone()]
    }
    fn initialize(&mut self) -> ModuleFuture {
        self.record("initialize");
        Box::pin(async { Ok(()) })
    }
    fn setup(&mut self) -> ModuleFuture {
        self.record("setup");
        let error = self
            .fail_setup
            .then(|| MicroserviceError::new(format!("setup:{}", self.name)));
        Box::pin(async move { error.map_or(Ok(()), Err) })
    }
    fn run(&mut self) -> ModuleFuture {
        self.record("run");
        Box::pin(async { Ok(()) })
    }
    fn stop(&mut self) -> ModuleFuture {
        self.record("stop");
        Box::pin(async { Ok(()) })
    }
    fn teardown(&mut self) -> ModuleFuture {
        self.record("teardown");
        Box::pin(async { Ok(()) })
    }
    fn shutdown(&mut self) -> ModuleFuture {
        self.record("shutdown");
        Box::pin(async { Ok(()) })
    }
    fn cleanup(&mut self) -> ModuleFuture {
        self.record("cleanup");
        Box::pin(async { Ok(()) })
    }
}

#[derive(Clone, Copy)]
enum EdgeKind {
    Dependency,
    Reference,
}

struct Edge<'a> {
    consumer: &'a str,
    target: &'a str,
    kind: EdgeKind,
}

fn run_fixture(
    names: &[&str],
    edges: &[Edge<'_>],
    permutation: &[&str],
    fail_setup: Option<&str>,
) -> (Vec<String>, Option<MicroserviceError>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let port = Port::<String>::new("fixture");
    let mut slots: HashMap<String, Vec<Box<dyn RelationshipSlot>>> = HashMap::new();
    for edge in edges {
        let slot: Box<dyn RelationshipSlot> = match edge.kind {
            EdgeKind::Dependency => {
                Box::new(Dependency::new(format!("to-{}", edge.target), port.clone()))
            }
            EdgeKind::Reference => {
                Box::new(Reference::new(format!("to-{}", edge.target), port.clone()))
            }
        };
        slots
            .entry(edge.consumer.to_owned())
            .or_default()
            .push(slot);
    }
    let mut service = Microservice::new();
    let mut handles: HashMap<String, ModuleHandle<FixtureNode>> = HashMap::new();
    for name in permutation {
        let provided_name = (*name).to_owned();
        let relationships = slots
            .get(*name)
            .map(|items| items.iter().map(|slot| slot.descriptor()).collect())
            .unwrap_or_default();
        let handle = service
            .install_named(*name, |_| FixtureNode {
                name: (*name).to_owned(),
                events: events.clone(),
                relationships,
                provider: Provider::try_new(port.clone(), move || Ok(provided_name.clone())),
                fail_setup: fail_setup == Some(*name),
            })
            .unwrap();
        handles.insert((*name).to_owned(), handle);
    }
    for edge in edges {
        let slot = slots[edge.consumer]
            .iter()
            .find(|slot| slot.descriptor().name == format!("to-{}", edge.target))
            .unwrap();
        service
            .bind(
                &handles[edge.consumer],
                slot.as_ref(),
                &handles[edge.target],
            )
            .unwrap();
    }
    let result = futures::executor::block_on(service.run()).unwrap();
    assert_eq!(names.len(), permutation.len());
    let captured = events.lock().unwrap().clone();
    (captured, result.error)
}

fn successful_trace(order: &[&str]) -> Vec<String> {
    let reverse = order.iter().rev().copied().collect::<Vec<_>>();
    ["initialize", "setup", "run"]
        .into_iter()
        .flat_map(|phase| order.iter().map(move |name| format!("{phase}:{name}")))
        .chain(
            ["stop", "teardown", "shutdown", "cleanup"]
                .into_iter()
                .flat_map(|phase| reverse.iter().map(move |name| format!("{phase}:{name}"))),
        )
        .collect()
}

#[test]
fn graph_fixtures_are_installation_order_independent() {
    let fixtures = vec![
        (
            vec!["a", "b", "c"],
            vec![
                Edge {
                    consumer: "a",
                    target: "b",
                    kind: EdgeKind::Dependency,
                },
                Edge {
                    consumer: "b",
                    target: "c",
                    kind: EdgeKind::Dependency,
                },
            ],
            vec!["c", "b", "a"],
        ),
        (
            vec!["a", "b", "c"],
            vec![
                Edge {
                    consumer: "a",
                    target: "c",
                    kind: EdgeKind::Dependency,
                },
                Edge {
                    consumer: "b",
                    target: "c",
                    kind: EdgeKind::Dependency,
                },
            ],
            vec!["c", "a", "b"],
        ),
        (
            vec!["a", "b", "c", "d"],
            vec![
                Edge {
                    consumer: "a",
                    target: "b",
                    kind: EdgeKind::Dependency,
                },
                Edge {
                    consumer: "a",
                    target: "c",
                    kind: EdgeKind::Dependency,
                },
                Edge {
                    consumer: "b",
                    target: "d",
                    kind: EdgeKind::Dependency,
                },
                Edge {
                    consumer: "c",
                    target: "d",
                    kind: EdgeKind::Dependency,
                },
            ],
            vec!["d", "b", "c", "a"],
        ),
        (
            vec!["a", "b", "c"],
            vec![
                Edge {
                    consumer: "a",
                    target: "b",
                    kind: EdgeKind::Dependency,
                },
                Edge {
                    consumer: "a",
                    target: "c",
                    kind: EdgeKind::Reference,
                },
                Edge {
                    consumer: "c",
                    target: "a",
                    kind: EdgeKind::Reference,
                },
            ],
            vec!["b", "a", "c"],
        ),
        (
            vec!["orders", "reports", "primary", "analytics"],
            vec![
                Edge {
                    consumer: "orders",
                    target: "primary",
                    kind: EdgeKind::Dependency,
                },
                Edge {
                    consumer: "reports",
                    target: "analytics",
                    kind: EdgeKind::Dependency,
                },
            ],
            vec!["analytics", "primary", "orders", "reports"],
        ),
    ];
    for (names, edges, order) in fixtures {
        let forward = run_fixture(&names, &edges, &names, None).0;
        let reversed_names = names.iter().rev().copied().collect::<Vec<_>>();
        let reversed = run_fixture(&names, &edges, &reversed_names, None).0;
        assert_eq!(forward, successful_trace(&order));
        assert_eq!(reversed, forward);
    }
}

#[test]
fn setup_failure_unwinds_by_graph_stage_and_reverse_order() {
    let edges = vec![
        Edge {
            consumer: "a",
            target: "b",
            kind: EdgeKind::Dependency,
        },
        Edge {
            consumer: "b",
            target: "c",
            kind: EdgeKind::Dependency,
        },
    ];
    let (events, error) = run_fixture(&["a", "b", "c"], &edges, &["a", "c", "b"], Some("b"));
    assert_eq!(error, Some(MicroserviceError::new("setup:b")));
    assert_eq!(
        events,
        vec![
            "initialize:c",
            "initialize:b",
            "initialize:a",
            "setup:c",
            "setup:b",
            "teardown:b",
            "teardown:c",
            "shutdown:a",
            "shutdown:b",
            "shutdown:c",
            "cleanup:a",
            "cleanup:b",
            "cleanup:c",
        ]
    );
}
