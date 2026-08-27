use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::channel::oneshot;
use futures::executor::block_on;
use futures::future::join;

use super::*;

struct TestContext;

impl MicrodeContext for TestContext {
    fn request_stop(&self, _request: MicrodeStopRequest) {}

    fn panic(&self, error: Option<MicrodeError>) -> ! {
        panic!("test panic: {error:?}");
    }
}

struct StoppableActive {
    completion: Option<oneshot::Receiver<()>>,
    release: Option<oneshot::Sender<()>>,
}

#[derive(Default)]
struct FailingModule {
    initialize: bool,
    setup: bool,
    run: bool,
    teardown: bool,
    shutdown: bool,
    cleanup: bool,
}

impl FailingModule {
    fn result(phase: &'static str, fails: bool) -> ModuleFuture {
        Box::pin(async move {
            if fails {
                Err(MicrodeError::new(format!("{phase} failed")))
            } else {
                Ok(())
            }
        })
    }
}

impl MicrodeModule for FailingModule {
    const KIND: ModuleKind = ModuleKind::Passive;
    fn initialize(&mut self) -> ModuleFuture {
        Self::result("initialize", self.initialize)
    }

    fn setup(&mut self) -> ModuleFuture {
        Self::result("setup", self.setup)
    }

    fn teardown(&mut self) -> ModuleFuture {
        Self::result("teardown", self.teardown)
    }

    fn shutdown(&mut self) -> ModuleFuture {
        Self::result("shutdown", self.shutdown)
    }

    fn cleanup(&mut self) -> ModuleFuture {
        Self::result("cleanup", self.cleanup)
    }

    fn run(&mut self) -> ModuleFuture {
        Self::result("run", self.run)
    }

    fn stop(&mut self) -> ModuleFuture {
        Self::result("stop", false)
    }
}

struct StopFailingActive;

impl MicrodeModule for StopFailingActive {
    const KIND: ModuleKind = ModuleKind::Active;
    fn run(&mut self) -> ModuleFuture {
        Box::pin(std::future::pending())
    }
    fn stop(&mut self) -> ModuleFuture {
        Box::pin(async { Err(MicrodeError::new("stop failed")) })
    }
}

impl StoppableActive {
    fn new() -> Self {
        let (release, completion) = oneshot::channel();
        Self {
            completion: Some(completion),
            release: Some(release),
        }
    }
}

impl MicrodeModule for StoppableActive {
    const KIND: ModuleKind = ModuleKind::Active;
    fn run(&mut self) -> ModuleFuture {
        let completion = self.completion.take().unwrap();
        Box::pin(async move {
            let _ = completion.await;
            Ok(())
        })
    }
    fn stop(&mut self) -> ModuleFuture {
        let release = self.release.take();
        Box::pin(async move {
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
fn application_main_completion_stops_active_modules() {
    let mut application = service();
    application.install(|_| StoppableActive::new()).unwrap();

    let result = block_on(application.run(|context| async move {
        context.request_stop(MicrodeStopRequest::success());
        Ok(())
    }))
    .unwrap();

    assert_eq!(result.exit_code, 0);
    assert_eq!(application.state(), MicrodeApplicationState::Finished);
}

#[test]
fn application_main_failure_is_an_execution_error() {
    let mut application = service();

    let result =
        block_on(application.run(|_| async { Err(MicrodeError::new("main failed")) })).unwrap();

    assert_eq!(result.exit_code, 1);
    assert_eq!(result.error, Some(MicrodeError::new("main failed")));
    assert_eq!(application.state(), MicrodeApplicationState::Failed);
}

#[test]
fn panic_messages_cover_string_and_unknown_payloads() {
    assert_eq!(
        super::panic_message(Box::new("borrowed panic")),
        "borrowed panic"
    );
    assert_eq!(
        super::panic_message(Box::new(String::from("owned panic"))),
        "owned panic"
    );
    assert_eq!(
        super::panic_message(Box::new(42_u32)),
        "application lifecycle panicked"
    );
}

fn wait_for_state(service: &MicrodeApplication, expected: MicrodeApplicationState) {
    let deadline = Instant::now() + Duration::from_secs(1);
    while service.state() != expected {
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {expected:?}"
        );
        std::thread::yield_now();
    }
}

#[test]
fn run_completes_the_full_empty_lifecycle_once() {
    let mut service = service();

    let result = block_on(service.serve()).unwrap();

    assert_eq!(
        result,
        MicrodeExecutionResult {
            exit_code: 0,
            error: None,
            errors: None,
        }
    );
    assert_eq!(service.state(), MicrodeApplicationState::Finished);
    assert_eq!(
        block_on(service.serve()).unwrap_err().to_string(),
        "cannot start application more than once; current state: Finished"
    );
}

#[test]
fn stop_before_run_is_rejected() {
    let service = service();

    assert_eq!(
        block_on(service.stop(MicrodeStopRequest::success()))
            .unwrap_err()
            .to_string(),
        "cannot stop application before it has started; current state: Idle"
    );
}

#[test]
fn stop_can_wait_for_an_owned_run_future_and_first_request_wins() {
    let mut service = service();
    service.install(|_| StoppableActive::new()).unwrap();

    let run = service.serve();
    let first_stop = service.stop(MicrodeStopRequest::with_exit_code(7));
    let second_stop = service.stop(MicrodeStopRequest::with_exit_code(9));
    let ((first_result, second_result), run_result) =
        block_on(join(join(first_stop, second_stop), run));

    let expected = MicrodeExecutionResult {
        exit_code: 7,
        error: None,
        errors: None,
    };
    assert_eq!(run_result.unwrap(), expected);
    assert_eq!(first_result.unwrap(), expected);
    assert_eq!(second_result.unwrap(), expected);
    assert_eq!(service.state(), MicrodeApplicationState::Failed);
}

#[test]
fn initialization_and_setup_failures_are_returned_after_unwind() {
    let mut initialization_service = service();
    initialization_service
        .install(|_| FailingModule {
            initialize: true,
            ..FailingModule::default()
        })
        .unwrap();
    let initialization_result = block_on(initialization_service.serve()).unwrap();
    assert_eq!(
        initialization_result.error,
        Some(MicrodeError::new("initialize failed"))
    );
    assert_eq!(
        initialization_service.state(),
        MicrodeApplicationState::Failed
    );

    let mut setup_service = service();
    setup_service
        .install(|_| FailingModule {
            setup: true,
            ..FailingModule::default()
        })
        .unwrap();
    let setup_result = block_on(setup_service.serve()).unwrap();
    assert_eq!(setup_result.error, Some(MicrodeError::new("setup failed")));
    assert_eq!(setup_service.state(), MicrodeApplicationState::Failed);
}

#[test]
fn execution_and_active_stop_failures_use_their_runtime_priorities() {
    let mut execution_service = service();
    execution_service
        .install(|_| FailingModule {
            run: true,
            ..FailingModule::default()
        })
        .unwrap();
    let execution_result = block_on(execution_service.serve()).unwrap();
    assert_eq!(
        execution_result.error,
        Some(MicrodeError::new("run failed"))
    );

    let mut stop_service = service();
    stop_service.install(|_| StopFailingActive).unwrap();
    let run = stop_service.serve();
    wait_for_state(&stop_service, MicrodeApplicationState::Running);
    let stop = stop_service.stop(MicrodeStopRequest::success());
    let (stop_result, run_result) = block_on(join(stop, run));
    let expected = MicrodeExecutionResult {
        exit_code: 1,
        error: Some(MicrodeError::new("stop failed")),
        errors: None,
    };
    assert_eq!(stop_result.unwrap(), expected);
    assert_eq!(run_result.unwrap(), expected);
}

#[test]
fn every_unwind_failure_is_retained_in_lifecycle_sequence() {
    let mut service = service();
    service
        .install(|_| FailingModule {
            teardown: true,
            shutdown: true,
            cleanup: true,
            ..FailingModule::default()
        })
        .unwrap();

    let result = block_on(service.serve()).unwrap();

    assert_eq!(result.exit_code, 1);
    assert_eq!(result.error, Some(MicrodeError::new("teardown failed")));
    assert_eq!(
        result.errors,
        Some(vec![
            MicrodeError::new("teardown failed"),
            MicrodeError::new("shutdown failed"),
            MicrodeError::new("cleanup failed"),
        ])
    );
    assert_eq!(service.state(), MicrodeApplicationState::Failed);
}

#[test]
fn a_stop_request_error_has_highest_priority_in_the_final_result() {
    let mut service = service();
    service.install(|_| StoppableActive::new()).unwrap();

    let run = service.serve();
    let stop_error = MicrodeError::new("requested failure");
    let stop = service.stop(MicrodeStopRequest::with_error(stop_error.clone()));
    let (run_result, stop_result) = block_on(join(run, stop));

    let expected = MicrodeExecutionResult {
        exit_code: 1,
        error: Some(stop_error),
        errors: None,
    };
    assert_eq!(run_result.unwrap(), expected);
    assert_eq!(stop_result.unwrap(), expected);
    assert_eq!(service.state(), MicrodeApplicationState::Failed);
}
