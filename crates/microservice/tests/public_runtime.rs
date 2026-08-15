use std::path::PathBuf;
use std::process::Command;
use std::sync::mpsc;
use std::time::Duration;

use futures::executor::block_on;
use microde_microservice::{
    Microservice, MicroserviceContextHandle, MicroserviceError, MicroserviceExecutionResult,
    MicroserviceModule, MicroserviceState, MicroserviceStopRequest, ModuleFuture, ModuleKind,
};

struct RequestingModule {
    context: MicroserviceContextHandle,
}

struct CleanupNotifier(Option<mpsc::Sender<()>>);

impl MicroserviceModule for CleanupNotifier {
    const KIND: ModuleKind = ModuleKind::Passive;
    fn cleanup(&mut self) -> ModuleFuture {
        let sender = self.0.take().unwrap();
        Box::pin(async move {
            sender.send(()).unwrap();
            Ok(())
        })
    }

    fn run(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }
    fn stop(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }
}

struct UnexpectedPanic(mpsc::Sender<()>);

impl MicroserviceModule for UnexpectedPanic {
    const KIND: ModuleKind = ModuleKind::Passive;
    fn run(&mut self) -> ModuleFuture {
        self.0.send(()).unwrap();
        panic!("unexpected module panic")
    }

    fn stop(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }
}

struct PanickingModule {
    context: MicroserviceContextHandle,
    error: Option<MicroserviceError>,
    shutdown_marker: PathBuf,
}

impl MicroserviceModule for PanickingModule {
    const KIND: ModuleKind = ModuleKind::Passive;
    fn shutdown(&mut self) -> ModuleFuture {
        let marker = self.shutdown_marker.clone();
        Box::pin(async move {
            std::fs::write(marker, "shutdown ran").unwrap();
            Ok(())
        })
    }

    fn run(&mut self) -> ModuleFuture {
        self.context.panic(self.error.clone())
    }
    fn stop(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }
}

impl MicroserviceModule for RequestingModule {
    const KIND: ModuleKind = ModuleKind::Passive;
    fn run(&mut self) -> ModuleFuture {
        self.context
            .request_stop(MicroserviceStopRequest::with_exit_code(6));
        Box::pin(async { Ok(()) })
    }

    fn stop(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }
}

#[test]
fn public_construction_supports_module_requested_shutdown() {
    let mut service = Microservice::default();
    service
        .install(|context| RequestingModule { context })
        .unwrap();

    let result = block_on(service.run()).unwrap();

    assert_eq!(
        result,
        MicroserviceExecutionResult {
            exit_code: 6,
            error: None,
            errors: None,
        }
    );
    assert_eq!(service.state(), MicroserviceState::Failed);
}

#[test]
fn dropping_the_completion_future_does_not_cancel_the_lifecycle() {
    let (sender, receiver) = mpsc::channel();
    let mut service = Microservice::new();
    service.install(|_| CleanupNotifier(Some(sender))).unwrap();

    drop(service.run());

    receiver.recv_timeout(Duration::from_secs(1)).unwrap();
    assert_eq!(service.state(), MicroserviceState::Finished);
}

#[test]
fn an_unexpected_lifecycle_panic_completes_all_waiters_with_an_error() {
    let (sender, receiver) = mpsc::channel();
    let mut service = Microservice::new();
    service.install(|_| UnexpectedPanic(sender)).unwrap();
    let run = service.run();
    receiver.recv_timeout(Duration::from_secs(1)).unwrap();
    let stop = service.stop(MicroserviceStopRequest::success());

    let (run, stop) = block_on(futures::future::join(run, stop));

    assert_eq!(
        run.unwrap_err(),
        MicroserviceError::new("unexpected module panic")
    );
    assert_eq!(
        stop.unwrap_err(),
        MicroserviceError::new("unexpected module panic")
    );
    assert_eq!(service.state(), MicroserviceState::Failed);
}

#[test]
fn production_panic_terminates_the_process() {
    const CHILD_MARKER: &str = "MICRODE_PANIC_CHILD";
    const SHUTDOWN_MARKER: &str = "MICRODE_SHUTDOWN_MARKER";
    if let Some(mode) = std::env::var_os(CHILD_MARKER) {
        let shutdown_marker = PathBuf::from(std::env::var_os(SHUTDOWN_MARKER).unwrap());
        let mut service = Microservice::new();
        service
            .install(|context| PanickingModule {
                context,
                error: (mode == "with-error").then(|| MicroserviceError::new("fatal child error")),
                shutdown_marker,
            })
            .unwrap();
        let _ = block_on(service.run());
        unreachable!("panic must terminate before the lifecycle returns");
    }

    for mode in ["without-error", "with-error"] {
        let shutdown_marker = std::env::temp_dir().join(format!(
            "microde-panic-{}-{mode}.marker",
            std::process::id()
        ));
        let output = Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("production_panic_terminates_the_process")
            .arg("--nocapture")
            .env(CHILD_MARKER, mode)
            .env(SHUTDOWN_MARKER, &shutdown_marker)
            .output()
            .unwrap();

        assert_eq!(output.status.code(), Some(1));
        assert!(!shutdown_marker.exists());
    }
}

#[test]
fn runtime_context_rejects_stop_requests_before_execution() {
    let mut service = Microservice::new();
    let mut captured_context = None;
    service
        .install(|context| {
            captured_context = Some(context.clone());
            RequestingModule { context }
        })
        .unwrap();

    let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        captured_context
            .unwrap()
            .request_stop(MicroserviceStopRequest::success());
    }));

    assert!(panic.is_err());
    assert_eq!(service.state(), MicroserviceState::Idle);
}
