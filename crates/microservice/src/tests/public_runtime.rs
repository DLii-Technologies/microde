use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::channel::oneshot;
use futures::executor::block_on;
use futures::future::join;

use super::*;

struct TestContext;

impl MicroserviceContext for TestContext {
    fn request_stop(&self, _request: MicroserviceStopRequest) {}

    fn panic(&self, error: Option<MicroserviceError>) -> ! {
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
                Err(MicroserviceError::new(format!("{phase} failed")))
            } else {
                Ok(())
            }
        })
    }
}

impl MicroserviceModule for FailingModule {
    fn initialize(&mut self) -> ModuleFuture {
        Self::result("initialize", self.initialize)
    }

    fn setup(&mut self) -> ModuleFuture {
        Self::result("setup", self.setup)
    }

    fn run(&mut self) -> ModuleFuture {
        Self::result("run", self.run)
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
}

struct StopFailingActive;

impl MicroserviceModule for StopFailingActive {
    fn run(&mut self) -> ModuleFuture {
        Box::pin(std::future::pending())
    }
}

impl ActiveMicroserviceModule for StopFailingActive {
    fn stop(&mut self) -> ModuleFuture {
        Box::pin(async { Err(MicroserviceError::new("stop failed")) })
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

impl MicroserviceModule for StoppableActive {
    fn run(&mut self) -> ModuleFuture {
        let completion = self.completion.take().unwrap();
        Box::pin(async move {
            let _ = completion.await;
            Ok(())
        })
    }
}

impl ActiveMicroserviceModule for StoppableActive {
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

fn service() -> Microservice {
    Microservice::with_context(Arc::new(TestContext))
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
        "microservice lifecycle panicked"
    );
}

fn wait_for_state(service: &Microservice, expected: MicroserviceState) {
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

    let result = block_on(service.run()).unwrap();

    assert_eq!(
        result,
        MicroserviceExecutionResult {
            exit_code: 0,
            error: None,
            errors: None,
        }
    );
    assert_eq!(service.state(), MicroserviceState::Finished);
    assert_eq!(
        block_on(service.run()).unwrap_err().to_string(),
        "cannot run microservice more than once; current state: Finished"
    );
}

#[test]
fn stop_before_run_is_rejected() {
    let service = service();

    assert_eq!(
        block_on(service.stop(MicroserviceStopRequest::success()))
            .unwrap_err()
            .to_string(),
        "cannot stop microservice before it has started; current state: Idle"
    );
}

#[test]
fn stop_can_wait_for_an_owned_run_future_and_first_request_wins() {
    let mut service = service();
    service.install_active(|_| StoppableActive::new()).unwrap();

    let run = service.run();
    let first_stop = service.stop(MicroserviceStopRequest::with_exit_code(7));
    let second_stop = service.stop(MicroserviceStopRequest::with_exit_code(9));
    let ((first_result, second_result), run_result) =
        block_on(join(join(first_stop, second_stop), run));

    let expected = MicroserviceExecutionResult {
        exit_code: 7,
        error: None,
        errors: None,
    };
    assert_eq!(run_result.unwrap(), expected);
    assert_eq!(first_result.unwrap(), expected);
    assert_eq!(second_result.unwrap(), expected);
    assert_eq!(service.state(), MicroserviceState::Failed);
}

#[test]
fn initialization_and_setup_failures_are_returned_after_unwind() {
    let mut initialization_service = service();
    initialization_service
        .install_passive(|_| FailingModule {
            initialize: true,
            ..FailingModule::default()
        })
        .unwrap();
    let initialization_result = block_on(initialization_service.run()).unwrap();
    assert_eq!(
        initialization_result.error,
        Some(MicroserviceError::new("initialize failed"))
    );
    assert_eq!(initialization_service.state(), MicroserviceState::Failed);

    let mut setup_service = service();
    setup_service
        .install_passive(|_| FailingModule {
            setup: true,
            ..FailingModule::default()
        })
        .unwrap();
    let setup_result = block_on(setup_service.run()).unwrap();
    assert_eq!(
        setup_result.error,
        Some(MicroserviceError::new("setup failed"))
    );
    assert_eq!(setup_service.state(), MicroserviceState::Failed);
}

#[test]
fn execution_and_active_stop_failures_use_their_runtime_priorities() {
    let mut execution_service = service();
    execution_service
        .install_passive(|_| FailingModule {
            run: true,
            ..FailingModule::default()
        })
        .unwrap();
    let execution_result = block_on(execution_service.run()).unwrap();
    assert_eq!(
        execution_result.error,
        Some(MicroserviceError::new("run failed"))
    );

    let mut stop_service = service();
    stop_service.install_active(|_| StopFailingActive).unwrap();
    let run = stop_service.run();
    wait_for_state(&stop_service, MicroserviceState::Running);
    let stop = stop_service.stop(MicroserviceStopRequest::success());
    let (stop_result, run_result) = block_on(join(stop, run));
    let expected = MicroserviceExecutionResult {
        exit_code: 1,
        error: Some(MicroserviceError::new("stop failed")),
        errors: None,
    };
    assert_eq!(stop_result.unwrap(), expected);
    assert_eq!(run_result.unwrap(), expected);
}

#[test]
fn every_unwind_failure_is_retained_in_lifecycle_sequence() {
    let mut service = service();
    service
        .install_passive(|_| FailingModule {
            teardown: true,
            shutdown: true,
            cleanup: true,
            ..FailingModule::default()
        })
        .unwrap();

    let result = block_on(service.run()).unwrap();

    assert_eq!(result.exit_code, 1);
    assert_eq!(
        result.error,
        Some(MicroserviceError::new("teardown failed"))
    );
    assert_eq!(
        result.errors,
        Some(vec![
            MicroserviceError::new("teardown failed"),
            MicroserviceError::new("shutdown failed"),
            MicroserviceError::new("cleanup failed"),
        ])
    );
    assert_eq!(service.state(), MicroserviceState::Failed);
}

#[test]
fn a_stop_request_error_has_highest_priority_in_the_final_result() {
    let mut service = service();
    service.install_active(|_| StoppableActive::new()).unwrap();

    let run = service.run();
    let stop_error = MicroserviceError::new("requested failure");
    let stop = service.stop(MicroserviceStopRequest::with_error(stop_error.clone()));
    let (run_result, stop_result) = block_on(join(run, stop));

    let expected = MicroserviceExecutionResult {
        exit_code: 1,
        error: Some(stop_error),
        errors: None,
    };
    assert_eq!(run_result.unwrap(), expected);
    assert_eq!(stop_result.unwrap(), expected);
    assert_eq!(service.state(), MicroserviceState::Failed);
}
