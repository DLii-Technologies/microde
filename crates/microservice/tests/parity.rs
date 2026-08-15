use std::sync::{Arc, Mutex};
use std::task::Poll;

use futures::channel::oneshot;
use futures::executor::block_on;
use futures::future::{join, poll_fn};
use microde_microservice::{
    Microservice, MicroserviceContextHandle, MicroserviceError, MicroserviceModule,
    MicroserviceState, MicroserviceStopRequest, ModuleFuture, ModuleKind,
};

struct PassiveFixture {
    name: &'static str,
    events: Arc<Mutex<Vec<String>>>,
    context: MicroserviceContextHandle,
    initialize_error: bool,
    setup_error: bool,
    execution_error: bool,
    cleanup_error: bool,
    requested_stop: Option<MicroserviceStopRequest>,
}

impl PassiveFixture {
    fn new(
        name: &'static str,
        events: Arc<Mutex<Vec<String>>>,
        context: MicroserviceContextHandle,
    ) -> Self {
        Self {
            name,
            events,
            context,
            initialize_error: false,
            setup_error: false,
            execution_error: false,
            cleanup_error: false,
            requested_stop: None,
        }
    }

    fn phase(&self, phase: &'static str, fails: bool) -> ModuleFuture {
        let event = format!("{}:{phase}", self.name);
        let events = self.events.clone();
        Box::pin(async move {
            events.lock().unwrap().push(event);
            if fails {
                Err(MicroserviceError::new(format!("{phase} failed")))
            } else {
                Ok(())
            }
        })
    }
}

impl MicroserviceModule for PassiveFixture {
    const KIND: ModuleKind = ModuleKind::Passive;
    fn initialize(&mut self) -> ModuleFuture {
        self.phase("initialize", self.initialize_error)
    }

    fn setup(&mut self) -> ModuleFuture {
        self.phase("setup", self.setup_error)
    }

    fn cleanup(&mut self) -> ModuleFuture {
        self.phase("cleanup", self.cleanup_error)
    }

    fn run(&mut self) -> ModuleFuture {
        self.events
            .lock()
            .unwrap()
            .push(format!("{}:run", self.name));
        let context = self.context.clone();
        let requested_stop = self.requested_stop.clone();
        let execution_error = self.execution_error;
        Box::pin(async move {
            if let Some(request) = requested_stop {
                context.request_stop(request);
            }
            if execution_error {
                Err(MicroserviceError::new("run failed"))
            } else {
                Ok(())
            }
        })
    }

    fn stop(&mut self) -> ModuleFuture {
        self.phase("stop", false)
    }
}

struct ActiveFixture {
    name: &'static str,
    events: Arc<Mutex<Vec<String>>>,
    completion: Option<oneshot::Receiver<()>>,
    release: Option<oneshot::Sender<()>>,
    immediate: bool,
    stop_error: bool,
    cleanup_error: bool,
}

impl ActiveFixture {
    fn pending(name: &'static str, events: Arc<Mutex<Vec<String>>>) -> Self {
        let (release, completion) = oneshot::channel();
        Self {
            name,
            events,
            completion: Some(completion),
            release: Some(release),
            immediate: false,
            stop_error: false,
            cleanup_error: false,
        }
    }

    fn immediate(name: &'static str, events: Arc<Mutex<Vec<String>>>) -> Self {
        Self {
            name,
            events,
            completion: None,
            release: None,
            immediate: true,
            stop_error: false,
            cleanup_error: false,
        }
    }
}

impl MicroserviceModule for ActiveFixture {
    const KIND: ModuleKind = ModuleKind::Active;
    fn cleanup(&mut self) -> ModuleFuture {
        let fails = self.cleanup_error;
        Box::pin(async move {
            if fails {
                Err(MicroserviceError::new("cleanup failed"))
            } else {
                Ok(())
            }
        })
    }

    fn run(&mut self) -> ModuleFuture {
        self.events
            .lock()
            .unwrap()
            .push(format!("{}:run", self.name));
        if self.immediate {
            return Box::pin(async { Ok(()) });
        }
        let completion = self.completion.take().unwrap();
        Box::pin(async move {
            let _ = completion.await;
            Ok(())
        })
    }

    fn stop(&mut self) -> ModuleFuture {
        self.events
            .lock()
            .unwrap()
            .push(format!("{}:stop", self.name));
        let release = self.release.take();
        let fails = self.stop_error;
        Box::pin(async move {
            if fails {
                return Err(MicroserviceError::new("stop failed"));
            }
            if let Some(release) = release {
                let _ = release.send(());
            }
            Ok(())
        })
    }
}

fn poll_until_pending(
    future: &mut futures::future::BoxFuture<
        'static,
        Result<microde_microservice::MicroserviceExecutionResult, MicroserviceError>,
    >,
) {
    block_on(poll_fn(|context| match future.as_mut().poll(context) {
        Poll::Pending => Poll::Ready(()),
        Poll::Ready(_) => panic!("expected the service to remain running"),
    }));
}

#[test]
fn parity_01_two_passive_modules_complete_successfully() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = Microservice::new();
    for name in ["first", "second"] {
        service
            .install(|context| PassiveFixture::new(name, events.clone(), context))
            .unwrap();
    }

    let result = block_on(service.run()).unwrap();

    assert_eq!(result.exit_code, 0);
    assert!(result.error.is_none());
    assert_eq!(service.state(), MicroserviceState::Finished);
    assert_eq!(
        events.lock().unwrap().as_slice(),
        [
            "first:initialize",
            "second:initialize",
            "first:setup",
            "second:setup",
            "first:run",
            "second:run",
            "second:stop",
            "first:stop",
            "second:cleanup",
            "first:cleanup"
        ]
    );
}

#[test]
fn parity_02_active_module_receives_stop() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = Microservice::new();
    service
        .install(|_| ActiveFixture::immediate("active", events.clone()))
        .unwrap();

    assert_eq!(block_on(service.run()).unwrap().exit_code, 0);
    assert_eq!(
        events.lock().unwrap().as_slice(),
        ["active:run", "active:stop"]
    );
}

#[test]
fn parity_03_multiple_active_modules_stop_in_reverse_order() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = Microservice::new();
    service
        .install(|_| ActiveFixture::pending("first", events.clone()))
        .unwrap();
    service
        .install(|_| ActiveFixture::immediate("second", events.clone()))
        .unwrap();

    block_on(service.run()).unwrap();

    assert_eq!(
        events.lock().unwrap().as_slice(),
        ["first:run", "second:run", "second:stop", "first:stop"]
    );
}

#[test]
fn parity_04_initialization_failure() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = Microservice::new();
    service
        .install(|context| {
            let mut module = PassiveFixture::new("module", events.clone(), context);
            module.initialize_error = true;
            module
        })
        .unwrap();

    assert_eq!(
        block_on(service.run()).unwrap().error,
        Some(MicroserviceError::new("initialize failed"))
    );
}

#[test]
fn parity_05_setup_failure() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = Microservice::new();
    service
        .install(|context| {
            let mut module = PassiveFixture::new("module", events.clone(), context);
            module.setup_error = true;
            module
        })
        .unwrap();

    assert_eq!(
        block_on(service.run()).unwrap().error,
        Some(MicroserviceError::new("setup failed"))
    );
}

#[test]
fn parity_06_execution_failure() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = Microservice::new();
    service
        .install(|context| {
            let mut module = PassiveFixture::new("module", events.clone(), context);
            module.execution_error = true;
            module
        })
        .unwrap();

    assert_eq!(
        block_on(service.run()).unwrap().error,
        Some(MicroserviceError::new("run failed"))
    );
}

#[test]
fn parity_07_stop_failure() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = Microservice::new();
    service
        .install(|_| {
            let mut module = ActiveFixture::immediate("active", events.clone());
            module.stop_error = true;
            module
        })
        .unwrap();

    assert_eq!(
        block_on(service.run()).unwrap().error,
        Some(MicroserviceError::new("stop failed"))
    );
}

#[test]
fn parity_08_cleanup_failure() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = Microservice::new();
    service
        .install(|context| {
            let mut module = PassiveFixture::new("module", events.clone(), context);
            module.cleanup_error = true;
            module
        })
        .unwrap();

    assert_eq!(
        block_on(service.run()).unwrap().error,
        Some(MicroserviceError::new("cleanup failed"))
    );
}

#[test]
fn parity_09_simultaneous_error_categories_follow_priority() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = Microservice::new();
    service
        .install(|_| {
            let mut module = ActiveFixture::pending("active", events.clone());
            module.stop_error = true;
            module.cleanup_error = true;
            module
        })
        .unwrap();
    service
        .install(|context| {
            let mut module = PassiveFixture::new("passive", events.clone(), context);
            module.execution_error = true;
            module.requested_stop = Some(MicroserviceStopRequest::with_error(
                MicroserviceError::new("requested failure"),
            ));
            module
        })
        .unwrap();

    let result = block_on(service.run()).unwrap();

    assert_eq!(
        result.error,
        Some(MicroserviceError::new("requested failure"))
    );
    assert_eq!(
        result.errors,
        Some(vec![
            MicroserviceError::new("requested failure"),
            MicroserviceError::new("stop failed"),
            MicroserviceError::new("run failed"),
            MicroserviceError::new("cleanup failed"),
        ])
    );
}

#[test]
fn parity_10_explicit_stop_exit_code() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = Microservice::new();
    service
        .install(|_| ActiveFixture::pending("active", events))
        .unwrap();
    let mut run = service.run();
    poll_until_pending(&mut run);

    let (stop, run) = block_on(join(
        service.stop(MicroserviceStopRequest::with_exit_code(42)),
        run,
    ));

    assert_eq!(stop.unwrap().exit_code, 42);
    assert_eq!(run.unwrap().exit_code, 42);
}

#[test]
fn parity_11_explicit_stop_error() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = Microservice::new();
    service
        .install(|_| ActiveFixture::pending("active", events))
        .unwrap();
    let mut run = service.run();
    poll_until_pending(&mut run);

    let failure = MicroserviceError::new("explicit stop error");
    let (stop, run) = block_on(join(
        service.stop(MicroserviceStopRequest::with_error(failure.clone())),
        run,
    ));

    assert_eq!(stop.unwrap().error, Some(failure.clone()));
    assert_eq!(run.unwrap().error, Some(failure));
}

#[test]
fn parity_12_module_initiated_shutdown_request() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut service = Microservice::new();
    service
        .install(|context| {
            let mut module = PassiveFixture::new("module", events, context);
            module.requested_stop = Some(MicroserviceStopRequest::with_exit_code(23));
            module
        })
        .unwrap();

    let result = block_on(service.run()).unwrap();

    assert_eq!(result.exit_code, 23);
    assert_eq!(service.state(), MicroserviceState::Failed);
}
