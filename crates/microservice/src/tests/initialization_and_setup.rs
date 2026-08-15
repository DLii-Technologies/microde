use std::sync::{Arc, Mutex};

use futures::executor::block_on;

use super::*;

#[derive(Clone)]
struct ControlContext {
    control: Arc<RuntimeControl>,
}

impl MicroserviceContext for ControlContext {
    fn request_stop(&self, request: MicroserviceStopRequest) {
        self.control.request_stop(request);
    }

    fn panic(&self, error: Option<MicroserviceError>) -> ! {
        panic!("test panic: {error:?}");
    }
}

struct PhaseModule {
    name: &'static str,
    events: Arc<Mutex<Vec<String>>>,
    context: MicroserviceContextHandle,
    fail_initialize: bool,
    fail_setup: bool,
    stop_during_initialize: bool,
    stop_during_setup: bool,
}

impl MicroserviceModule for PhaseModule {
    const KIND: ModuleKind = ModuleKind::Passive;
    fn initialize(&mut self) -> ModuleFuture {
        let event = format!("{}:initialize", self.name);
        let events = self.events.clone();
        let context = self.context.clone();
        let fail = self.fail_initialize;
        let stop = self.stop_during_initialize;
        Box::pin(async move {
            events.lock().unwrap().push(event);
            if stop {
                context.request_stop(MicroserviceStopRequest::success());
            }
            if fail {
                Err(MicroserviceError::new("initialization failed"))
            } else {
                Ok(())
            }
        })
    }

    fn setup(&mut self) -> ModuleFuture {
        let event = format!("{}:setup", self.name);
        let events = self.events.clone();
        let context = self.context.clone();
        let fail = self.fail_setup;
        let stop = self.stop_during_setup;
        Box::pin(async move {
            events.lock().unwrap().push(event);
            if stop {
                context.request_stop(MicroserviceStopRequest::success());
            }
            if fail {
                Err(MicroserviceError::new("setup failed"))
            } else {
                Ok(())
            }
        })
    }

    fn run(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }

    fn stop(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }
}

fn service() -> (Microservice, Arc<RuntimeControl>) {
    let control = Arc::new(RuntimeControl::default());
    let context: MicroserviceContextHandle = Arc::new(ControlContext {
        control: control.clone(),
    });
    (
        Microservice::with_context_and_control(context, control.clone()),
        control,
    )
}

fn install(
    service: &mut Microservice,
    events: &Arc<Mutex<Vec<String>>>,
    name: &'static str,
    configure: impl FnOnce(&mut PhaseModule),
) {
    service
        .install(|context| {
            let mut module = PhaseModule {
                name,
                events: events.clone(),
                context,
                fail_initialize: false,
                fail_setup: false,
                stop_during_initialize: false,
                stop_during_setup: false,
            };
            configure(&mut module);
            module
        })
        .unwrap();
}

#[test]
fn initializes_and_sets_up_in_installation_order_with_stage_tracking() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let (mut service, _) = service();
    install(&mut service, &events, "first", |_| {});
    install(&mut service, &events, "second", |_| {});

    let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe({
        let context = service.context.clone();
        move || context.panic(Some(MicroserviceError::new("fatal")))
    }));
    assert!(panic.is_err());

    block_on(service.initialize_modules()).unwrap();
    assert!(
        service
            .modules
            .iter()
            .all(|module| module.stage() == ModuleStage::Initialized)
    );
    block_on(service.setup_modules()).unwrap();
    assert!(
        service
            .modules
            .iter()
            .all(|module| module.stage() == ModuleStage::SetUp)
    );
    for module in &mut service.modules {
        block_on(module.run()).unwrap();
    }

    assert_eq!(
        *events.lock().unwrap(),
        vec![
            "first:initialize",
            "second:initialize",
            "first:setup",
            "second:setup"
        ]
    );
}

#[test]
fn initialization_failure_stops_forward_progress_and_preserves_stage() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let (mut service, _) = service();
    install(&mut service, &events, "first", |module| {
        module.fail_initialize = true;
    });
    install(&mut service, &events, "second", |_| {});

    let error = block_on(service.initialize_modules()).unwrap_err();

    assert_eq!(error, MicroserviceError::new("initialization failed"));
    assert_eq!(service.modules[0].stage(), ModuleStage::Initializing);
    assert_eq!(service.modules[1].stage(), ModuleStage::Installed);
    assert_eq!(*events.lock().unwrap(), vec!["first:initialize"]);
}

#[test]
fn setup_failure_stops_forward_progress_and_preserves_stage() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let (mut service, _) = service();
    install(&mut service, &events, "first", |module| {
        module.fail_setup = true;
    });
    install(&mut service, &events, "second", |_| {});
    block_on(service.initialize_modules()).unwrap();

    let error = block_on(service.setup_modules()).unwrap_err();

    assert_eq!(error, MicroserviceError::new("setup failed"));
    assert_eq!(service.modules[0].stage(), ModuleStage::SettingUp);
    assert_eq!(service.modules[1].stage(), ModuleStage::Initialized);
    assert_eq!(
        *events.lock().unwrap(),
        vec!["first:initialize", "second:initialize", "first:setup"]
    );
}

#[test]
fn stop_requested_during_initialization_skips_remaining_modules() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let (mut service, control) = service();
    install(&mut service, &events, "first", |module| {
        module.stop_during_initialize = true;
    });
    install(&mut service, &events, "second", |_| {});

    block_on(service.initialize_modules()).unwrap();

    assert!(control.stop_requested());
    assert_eq!(service.modules[0].stage(), ModuleStage::Initialized);
    assert_eq!(service.modules[1].stage(), ModuleStage::Installed);
    assert_eq!(*events.lock().unwrap(), vec!["first:initialize"]);
}

#[test]
fn stop_requested_during_setup_skips_remaining_modules_and_first_request_wins() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let (mut service, control) = service();
    install(&mut service, &events, "first", |module| {
        module.stop_during_setup = true;
    });
    install(&mut service, &events, "second", |_| {});
    block_on(service.initialize_modules()).unwrap();

    block_on(service.setup_modules()).unwrap();
    control.request_stop(MicroserviceStopRequest::with_exit_code(99));

    assert_eq!(
        control.stop_request(),
        Some(MicroserviceStopRequest::success())
    );
    assert_eq!(service.modules[0].stage(), ModuleStage::SetUp);
    assert_eq!(service.modules[1].stage(), ModuleStage::Initialized);
    assert_eq!(
        *events.lock().unwrap(),
        vec!["first:initialize", "second:initialize", "first:setup"]
    );
}
