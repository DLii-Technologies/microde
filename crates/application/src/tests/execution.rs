use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::channel::oneshot;
use futures::executor::block_on;

use super::*;

struct TestContext;

impl MicrodeContext for TestContext {
    fn request_stop(&self, _request: MicrodeStopRequest) {}

    fn panic(&self, error: Option<MicrodeError>) -> ! {
        panic!("test panic: {error:?}");
    }
}

struct PassiveRun {
    name: &'static str,
    events: Arc<Mutex<Vec<String>>>,
    failure: Option<MicrodeError>,
}

impl MicrodeModule for PassiveRun {
    const KIND: ModuleKind = ModuleKind::Passive;
    fn run(&mut self) -> ModuleFuture {
        self.events
            .lock()
            .unwrap()
            .push(format!("{}:run", self.name));
        let failure = self.failure.clone();
        Box::pin(async move {
            match failure {
                Some(error) => Err(error),
                None => Ok(()),
            }
        })
    }

    fn stop(&mut self) -> ModuleFuture {
        self.events
            .lock()
            .unwrap()
            .push(format!("{}:stop", self.name));
        Box::pin(async { Ok(()) })
    }
}

struct ActiveRun {
    name: &'static str,
    events: Arc<Mutex<Vec<String>>>,
    completion: Option<oneshot::Receiver<()>>,
    release: Option<oneshot::Sender<()>>,
    completes_immediately: bool,
    stop_failure: Option<MicrodeError>,
}

struct FailedStopContinues {
    completion: Option<oneshot::Receiver<()>>,
    release: Option<oneshot::Sender<()>>,
    completed: Option<std::sync::mpsc::Sender<()>>,
}

impl MicrodeModule for FailedStopContinues {
    const KIND: ModuleKind = ModuleKind::Active;
    fn run(&mut self) -> ModuleFuture {
        let completion = self.completion.take().unwrap();
        let completed = self.completed.take().unwrap();
        Box::pin(async move {
            let _ = completion.await;
            completed.send(()).unwrap();
            Ok(())
        })
    }
    fn stop(&mut self) -> ModuleFuture {
        let release = self.release.take().unwrap();
        Box::pin(async move {
            let _ = release.send(());
            Err(MicrodeError::new("stop failed"))
        })
    }
}

impl ActiveRun {
    fn pending(name: &'static str, events: Arc<Mutex<Vec<String>>>) -> Self {
        let (release, completion) = oneshot::channel();
        Self {
            name,
            events,
            completion: Some(completion),
            release: Some(release),
            completes_immediately: false,
            stop_failure: None,
        }
    }

    fn immediate(name: &'static str, events: Arc<Mutex<Vec<String>>>) -> Self {
        Self {
            name,
            events,
            completion: None,
            release: None,
            completes_immediately: true,
            stop_failure: None,
        }
    }

    fn with_stop_failure(mut self, message: &'static str) -> Self {
        self.stop_failure = Some(MicrodeError::new(message));
        self
    }
}

impl MicrodeModule for ActiveRun {
    const KIND: ModuleKind = ModuleKind::Active;
    fn run(&mut self) -> ModuleFuture {
        self.events
            .lock()
            .unwrap()
            .push(format!("{}:run", self.name));
        if self.completes_immediately {
            return Box::pin(async { Ok(()) });
        }

        let completion = self.completion.take().unwrap();
        let events = self.events.clone();
        let name = self.name;
        Box::pin(async move {
            let _ = completion.await;
            events.lock().unwrap().push(format!("{name}:complete"));
            Ok(())
        })
    }
    fn stop(&mut self) -> ModuleFuture {
        self.events
            .lock()
            .unwrap()
            .push(format!("{}:stop", self.name));
        let release = self.release.take();
        let failure = self.stop_failure.clone();
        Box::pin(async move {
            if let Some(error) = failure {
                return Err(error);
            }
            if let Some(release) = release {
                let _ = release.send(());
            }
            Ok(())
        })
    }
}

fn service() -> MicrodeApplication {
    MicrodeApplication::with_context(Arc::new(TestContext))
}

#[test]
fn execution_test_context_and_closed_stop_signal_are_observable() {
    let context = TestContext;
    context.request_stop(MicrodeStopRequest::success());
    let panic = std::panic::catch_unwind(|| context.panic(None));
    assert!(panic.is_err());

    let control = RuntimeControl::default();
    drop(control.take_stop_receiver());
    control.request_stop(MicrodeStopRequest::success());
    assert!(control.stop_requested());
}

#[test]
fn all_passive_runs_settle_and_execution_failures_are_collected() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = service();
    service
        .install(|_| PassiveRun {
            name: "first",
            events: events.clone(),
            failure: None,
        })
        .unwrap();
    service
        .install(|_| PassiveRun {
            name: "second",
            events: events.clone(),
            failure: Some(MicrodeError::new("passive failed")),
        })
        .unwrap();

    let errors = block_on(service.execute_modules(None));

    assert_eq!(errors.execution, vec![MicrodeError::new("passive failed")]);
    assert!(errors.stop.is_empty());
    assert!(
        service
            .modules
            .iter()
            .all(|module| module.stage() == ModuleStage::Executed)
    );
    assert_eq!(
        *events.lock().unwrap(),
        vec!["first:run", "second:run", "second:stop", "first:stop"]
    );
}

#[test]
fn an_active_completion_stops_active_modules_in_reverse_order() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = service();
    service
        .install(|_| ActiveRun::pending("first", events.clone()))
        .unwrap();
    service
        .install(|_| ActiveRun::immediate("second", events.clone()))
        .unwrap();

    let errors = block_on(service.execute_modules(None));

    assert!(errors.execution.is_empty());
    assert!(errors.stop.is_empty());
    assert!(
        service
            .modules
            .iter()
            .all(|module| module.stage() == ModuleStage::Executed)
    );
    assert!(events.lock().unwrap().starts_with(&[
        "first:run".to_owned(),
        "second:run".to_owned(),
        "second:stop".to_owned(),
        "first:stop".to_owned(),
        "first:complete".to_owned(),
    ]));
}

#[test]
fn passive_success_does_not_end_execution_while_an_active_run_remains() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = service();
    service
        .install(|_| PassiveRun {
            name: "passive",
            events: events.clone(),
            failure: None,
        })
        .unwrap();
    service
        .install(|_| ActiveRun::immediate("active", events.clone()))
        .unwrap();

    let errors = block_on(service.execute_modules(None));

    assert!(errors.execution.is_empty());
    assert!(errors.stop.is_empty());
    assert_eq!(
        *events.lock().unwrap(),
        vec!["passive:run", "active:run", "active:stop", "passive:stop"]
    );
}

#[test]
fn a_stop_request_stops_and_awaits_an_active_run() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = service();
    service
        .install(|_| ActiveRun::pending("active", events.clone()))
        .unwrap();
    service
        .control
        .request_stop(MicrodeStopRequest::with_exit_code(4));

    let errors = block_on(service.execute_modules(None));

    assert!(errors.execution.is_empty());
    assert!(errors.stop.is_empty());
    assert_eq!(service.modules[0].stage(), ModuleStage::Executed);
    assert_eq!(
        *events.lock().unwrap(),
        vec!["active:run", "active:stop", "active:complete"]
    );
}

#[test]
fn a_passive_failure_triggers_active_shutdown() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = service();
    service
        .install(|_| ActiveRun::pending("active", events.clone()))
        .unwrap();
    service
        .install(|_| PassiveRun {
            name: "passive",
            events: events.clone(),
            failure: Some(MicrodeError::new("passive failed")),
        })
        .unwrap();

    let errors = block_on(service.execute_modules(None));

    assert_eq!(errors.execution, vec![MicrodeError::new("passive failed")]);
    assert!(errors.stop.is_empty());
    assert_eq!(
        *events.lock().unwrap(),
        vec![
            "active:run",
            "passive:run",
            "passive:stop",
            "active:stop",
            "active:complete"
        ]
    );
}

#[test]
fn stop_failures_are_recorded_while_successful_stops_are_awaited() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = service();
    service
        .install(|_| ActiveRun::pending("first", events.clone()))
        .unwrap();
    service
        .install(|_| {
            ActiveRun::pending("second", events.clone()).with_stop_failure("second stop failed")
        })
        .unwrap();
    service.control.request_stop(MicrodeStopRequest::success());

    let errors = block_on(service.execute_modules(None));

    assert!(errors.execution.is_empty());
    assert_eq!(errors.stop, vec![MicrodeError::new("second stop failed")]);
    assert_eq!(service.modules[0].stage(), ModuleStage::Executed);
    assert_eq!(service.modules[1].stage(), ModuleStage::Executing);
    assert_eq!(
        *events.lock().unwrap(),
        vec![
            "first:run",
            "second:run",
            "second:stop",
            "first:stop",
            "first:complete"
        ]
    );
}

#[test]
fn multiple_stop_failures_follow_reverse_installation_order() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = service();
    service
        .install(|_| {
            ActiveRun::pending("first", events.clone()).with_stop_failure("first stop failed")
        })
        .unwrap();
    service
        .install(|_| {
            ActiveRun::pending("second", events.clone()).with_stop_failure("second stop failed")
        })
        .unwrap();
    service.control.request_stop(MicrodeStopRequest::success());

    let errors = block_on(service.execute_modules(None));

    assert_eq!(
        errors.stop,
        vec![
            MicrodeError::new("second stop failed"),
            MicrodeError::new("first stop failed")
        ]
    );
    assert_eq!(
        *events.lock().unwrap(),
        vec!["first:run", "second:run", "second:stop", "first:stop"]
    );
}

#[test]
fn a_run_continues_after_its_active_stop_fails() {
    let (release, completion) = oneshot::channel();
    let (completed, completion_observed) = std::sync::mpsc::channel();
    let mut service = service();
    service
        .install(|_| FailedStopContinues {
            completion: Some(completion),
            release: Some(release),
            completed: Some(completed),
        })
        .unwrap();
    service.control.request_stop(MicrodeStopRequest::success());

    let errors = block_on(service.execute_modules(None));

    assert_eq!(errors.stop, vec![MicrodeError::new("stop failed")]);
    completion_observed
        .recv_timeout(Duration::from_secs(1))
        .unwrap();
}
