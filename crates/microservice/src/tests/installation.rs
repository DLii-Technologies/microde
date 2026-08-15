use std::sync::{Arc, Mutex};

use super::*;

struct TestContext;

impl MicroserviceContext for TestContext {
    fn request_stop(&self, _request: MicroserviceStopRequest) {}

    fn panic(&self, error: Option<MicroserviceError>) -> ! {
        panic!("test panic: {error:?}");
    }
}

struct Passive;

impl MicroserviceModule for Passive {
    const KIND: ModuleKind = ModuleKind::Passive;
    fn run(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }

    fn stop(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }
}

struct Active;

impl MicroserviceModule for Active {
    const KIND: ModuleKind = ModuleKind::Active;
    fn run(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }
    fn stop(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }
}

fn passive_factory(
    received: Arc<Mutex<Vec<MicroserviceContextHandle>>>,
) -> impl FnOnce(MicroserviceContextHandle) -> Passive {
    move |context| {
        received.lock().unwrap().push(context);
        Passive
    }
}

fn active_factory(
    received: Arc<Mutex<Vec<MicroserviceContextHandle>>>,
) -> impl FnOnce(MicroserviceContextHandle) -> Active {
    move |context| {
        received.lock().unwrap().push(context);
        Active
    }
}

fn panicking_factory() -> impl FnOnce(MicroserviceContextHandle) -> Passive {
    |_| panic!("factory failed")
}

fn named_passive_factory(_: MicroserviceContextHandle) -> Passive {
    Passive
}

#[test]
fn installs_passive_and_active_modules_in_order_with_the_shared_context() {
    let context: MicroserviceContextHandle = Arc::new(TestContext);
    let mut microservice = Microservice::with_context(context.clone());
    let received_contexts = Arc::new(Mutex::new(Vec::new()));

    context.request_stop(MicroserviceStopRequest::success());
    let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe({
        let context = context.clone();
        move || context.panic(None)
    }));
    assert!(panic.is_err());

    microservice
        .install(passive_factory(received_contexts.clone()))
        .unwrap();
    microservice
        .install(active_factory(received_contexts.clone()))
        .unwrap();

    assert_eq!(microservice.state(), MicroserviceState::Idle);
    assert_eq!(
        microservice
            .modules
            .iter()
            .map(InstalledModule::kind)
            .collect::<Vec<_>>(),
        vec![ModuleKind::Passive, ModuleKind::Active]
    );
    assert!(
        received_contexts
            .lock()
            .unwrap()
            .iter()
            .all(|received| Arc::ptr_eq(received, &context))
    );

    for installed in &mut microservice.modules {
        let id = installed.id().clone();
        futures::executor::block_on(installed.run_with_context(RunContext::new(
            id,
            Arc::new(std::collections::HashMap::new()),
        )))
        .unwrap();
        futures::executor::block_on(installed.stop()).unwrap();
    }
}

#[test]
fn rejects_installation_after_execution_has_started() {
    let context: MicroserviceContextHandle = Arc::new(TestContext);
    let mut microservice = Microservice::with_context(context);
    microservice.set_state(MicroserviceState::Running);
    let received_contexts = Arc::new(Mutex::new(Vec::new()));
    let mut idle = Microservice::with_context(Arc::new(TestContext));
    idle.install_named("named", named_passive_factory).unwrap();

    let error = microservice
        .install(passive_factory(received_contexts.clone()))
        .unwrap_err();
    let active_error = microservice
        .install(active_factory(received_contexts))
        .unwrap_err();
    let named_error = microservice
        .install_named("named", named_passive_factory)
        .unwrap_err();

    assert_eq!(
        error.to_string(),
        "cannot install module after microservice has started; current state: Running"
    );
    assert_eq!(active_error, error);
    assert_eq!(named_error, error);
    assert!(microservice.modules.is_empty());
}

#[test]
fn restores_idle_state_when_a_factory_panics() {
    let context: MicroserviceContextHandle = Arc::new(TestContext);
    let mut microservice = Microservice::with_context(context);

    let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = microservice.install(panicking_factory());
    }));

    assert!(panic.is_err());
    assert_eq!(microservice.state(), MicroserviceState::Idle);
    assert!(microservice.modules.is_empty());

    microservice.set_state(MicroserviceState::Running);
    assert!(microservice.install(panicking_factory()).is_err());
}

#[test]
fn named_installation_returns_an_opaque_stable_handle() {
    let context: MicroserviceContextHandle = Arc::new(TestContext);
    let mut microservice = Microservice::with_context(context);

    let first = microservice.install_named("first", |_| Passive).unwrap();
    let second = microservice.install_named("second", |_| Passive).unwrap();

    assert_eq!(first.id().as_str(), "first");
    assert_eq!(second.id().as_str(), "second");
    assert_ne!(first.id(), second.id());
    assert_eq!(
        format!("{first:?}"),
        "ModuleHandle { id: ModuleInstanceId(\"first\"), .. }"
    );
}

#[test]
fn duplicate_named_installation_is_rejected_before_factory_evaluation() {
    let context: MicroserviceContextHandle = Arc::new(TestContext);
    let mut microservice = Microservice::with_context(context);
    microservice.install_named("worker", |_| Passive).unwrap();
    let evaluated = Arc::new(Mutex::new(false));

    let error = microservice
        .install_named("worker", {
            let evaluated = evaluated.clone();
            move |_| {
                *evaluated.lock().unwrap() = true;
                Passive
            }
        })
        .unwrap_err();

    assert_eq!(
        error.to_string(),
        "module instance ID 'worker' is already installed"
    );
    assert!(!*evaluated.lock().unwrap());
    assert_eq!(microservice.state(), MicroserviceState::Idle);
}
