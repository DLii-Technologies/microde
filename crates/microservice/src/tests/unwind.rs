use std::sync::{Arc, Mutex};

use futures::executor::block_on;

use super::*;

struct TestContext;

impl MicroserviceContext for TestContext {
    fn request_stop(&self, _request: MicroserviceStopRequest) {}

    fn panic(&self, error: Option<MicroserviceError>) -> ! {
        panic!("test panic: {error:?}");
    }
}

struct UnwindModule {
    name: &'static str,
    events: Arc<Mutex<Vec<String>>>,
    fail_teardown: bool,
    fail_shutdown: bool,
    fail_cleanup: bool,
}

impl UnwindModule {
    fn phase(&self, phase: &'static str, fail: bool) -> ModuleFuture {
        let event = format!("{}:{phase}", self.name);
        let events = self.events.clone();
        Box::pin(async move {
            events.lock().unwrap().push(event);
            if fail {
                Err(MicroserviceError::new(format!("{phase} failed")))
            } else {
                Ok(())
            }
        })
    }
}

impl MicroserviceModule for UnwindModule {
    const KIND: ModuleKind = ModuleKind::Passive;
    fn teardown(&mut self) -> ModuleFuture {
        self.phase("teardown", self.fail_teardown)
    }

    fn shutdown(&mut self) -> ModuleFuture {
        self.phase("shutdown", self.fail_shutdown)
    }

    fn cleanup(&mut self) -> ModuleFuture {
        self.phase("cleanup", self.fail_cleanup)
    }

    fn run(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }

    fn stop(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }
}

fn service() -> Microservice {
    Microservice::with_context(Arc::new(TestContext))
}

fn install(
    service: &mut Microservice,
    events: &Arc<Mutex<Vec<String>>>,
    name: &'static str,
    stage: ModuleStage,
    configure: impl FnOnce(&mut UnwindModule),
) {
    service
        .install(|_| {
            let mut module = UnwindModule {
                name,
                events: events.clone(),
                fail_teardown: false,
                fail_shutdown: false,
                fail_cleanup: false,
            };
            configure(&mut module);
            module
        })
        .unwrap();
    service.modules.last_mut().unwrap().set_stage(stage);
}

#[test]
fn unwind_phases_run_in_reverse_order_and_reach_final_stages() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = service();
    install(
        &mut service,
        &events,
        "first",
        ModuleStage::Executed,
        |_| {},
    );
    install(
        &mut service,
        &events,
        "second",
        ModuleStage::Executed,
        |_| {},
    );

    assert!(block_on(service.teardown_modules()).is_empty());
    assert!(
        service
            .modules
            .iter()
            .all(|module| module.stage() == ModuleStage::TornDown)
    );
    assert!(block_on(service.shutdown_modules()).is_empty());
    assert!(
        service
            .modules
            .iter()
            .all(|module| module.stage() == ModuleStage::Shutdown)
    );
    assert!(block_on(service.cleanup_modules()).is_empty());
    assert!(
        service
            .modules
            .iter()
            .all(|module| module.stage() == ModuleStage::CleanedUp)
    );

    assert_eq!(
        *events.lock().unwrap(),
        vec![
            "second:teardown",
            "first:teardown",
            "second:shutdown",
            "first:shutdown",
            "second:cleanup",
            "first:cleanup"
        ]
    );
}

#[test]
fn teardown_and_shutdown_only_run_for_eligible_stages_but_cleanup_runs_for_all() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = service();
    install(
        &mut service,
        &events,
        "installed",
        ModuleStage::Installed,
        |_| {},
    );
    install(
        &mut service,
        &events,
        "initializing",
        ModuleStage::Initializing,
        |_| {},
    );
    install(
        &mut service,
        &events,
        "setting-up",
        ModuleStage::SettingUp,
        |_| {},
    );

    assert!(block_on(service.teardown_modules()).is_empty());
    assert!(block_on(service.shutdown_modules()).is_empty());
    assert!(block_on(service.cleanup_modules()).is_empty());

    assert_eq!(
        *events.lock().unwrap(),
        vec![
            "setting-up:teardown",
            "setting-up:shutdown",
            "initializing:shutdown",
            "setting-up:cleanup",
            "initializing:cleanup",
            "installed:cleanup"
        ]
    );
}

#[test]
fn unwind_failures_are_collected_without_stopping_later_modules() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = service();
    install(
        &mut service,
        &events,
        "first",
        ModuleStage::Executed,
        |_| {},
    );
    install(
        &mut service,
        &events,
        "second",
        ModuleStage::Executed,
        |module| {
            module.fail_teardown = true;
            module.fail_shutdown = true;
            module.fail_cleanup = true;
        },
    );

    assert_eq!(
        block_on(service.teardown_modules()),
        vec![MicroserviceError::new("teardown failed")]
    );
    assert!(
        service
            .modules
            .iter()
            .all(|module| module.stage() == ModuleStage::TornDown)
    );
    assert_eq!(
        block_on(service.shutdown_modules()),
        vec![MicroserviceError::new("shutdown failed")]
    );
    assert!(
        service
            .modules
            .iter()
            .all(|module| module.stage() == ModuleStage::Shutdown)
    );
    assert_eq!(
        block_on(service.cleanup_modules()),
        vec![MicroserviceError::new("cleanup failed")]
    );
    assert!(
        service
            .modules
            .iter()
            .all(|module| module.stage() == ModuleStage::CleanedUp)
    );

    assert_eq!(
        *events.lock().unwrap(),
        vec![
            "second:teardown",
            "first:teardown",
            "second:shutdown",
            "first:shutdown",
            "second:cleanup",
            "first:cleanup"
        ]
    );
}
