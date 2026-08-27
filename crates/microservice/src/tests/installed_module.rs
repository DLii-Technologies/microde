use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use futures::executor::block_on;

use super::*;
use crate::{RunContext, SetupContext};

struct RecordingModule {
    events: Arc<Mutex<Vec<&'static str>>>,
}

impl RecordingModule {
    fn record(&self, event: &'static str) -> ModuleFuture {
        let events = self.events.clone();
        Box::pin(async move {
            events.lock().unwrap().push(event);
            Ok(())
        })
    }
}

struct PassiveRecording(RecordingModule);

impl MicrodeModule for PassiveRecording {
    const KIND: ModuleKind = ModuleKind::Passive;

    fn initialize(&mut self) -> ModuleFuture {
        self.0.record("initialize")
    }
    fn setup(&mut self) -> ModuleFuture {
        self.0.record("setup")
    }
    fn run(&mut self) -> ModuleFuture {
        self.0.record("run")
    }
    fn stop(&mut self) -> ModuleFuture {
        self.0.record("stop")
    }
    fn teardown(&mut self) -> ModuleFuture {
        self.0.record("teardown")
    }
    fn shutdown(&mut self) -> ModuleFuture {
        self.0.record("shutdown")
    }
    fn cleanup(&mut self) -> ModuleFuture {
        self.0.record("cleanup")
    }
}

struct ActiveRecording(RecordingModule);

impl MicrodeModule for ActiveRecording {
    const KIND: ModuleKind = ModuleKind::Active;

    fn initialize(&mut self) -> ModuleFuture {
        self.0.record("initialize")
    }
    fn setup(&mut self) -> ModuleFuture {
        self.0.record("setup")
    }
    fn run(&mut self) -> ModuleFuture {
        self.0.record("run")
    }
    fn stop(&mut self) -> ModuleFuture {
        self.0.record("stop")
    }
    fn teardown(&mut self) -> ModuleFuture {
        self.0.record("teardown")
    }
    fn shutdown(&mut self) -> ModuleFuture {
        self.0.record("shutdown")
    }
    fn cleanup(&mut self) -> ModuleFuture {
        self.0.record("cleanup")
    }
}

fn assert_lifecycle(mut installed: InstalledModule, expected_kind: ModuleKind) {
    assert_eq!(installed.kind(), expected_kind);
    assert_eq!(installed.stage(), ModuleStage::Installed);
    installed.set_stage(ModuleStage::Executing);
    assert_eq!(installed.stage(), ModuleStage::Executing);

    block_on(installed.initialize()).unwrap();
    let resolutions = Arc::new(HashMap::new());
    let id = installed.id().clone();
    block_on(installed.setup_with_context(SetupContext::new(id.clone(), resolutions.clone())))
        .unwrap();
    block_on(installed.run_with_context(RunContext::new(id, resolutions))).unwrap();
    block_on(installed.stop()).unwrap();
    block_on(installed.teardown()).unwrap();
    block_on(installed.shutdown()).unwrap();
    block_on(installed.cleanup()).unwrap();
}

#[test]
fn installed_modules_capture_the_kind_and_dispatch_the_lifecycle() {
    let passive_events = Arc::new(Mutex::new(Vec::new()));
    assert_lifecycle(
        InstalledModule::new(
            ModuleInstanceId::new("passive"),
            PassiveRecording(RecordingModule {
                events: passive_events.clone(),
            }),
        ),
        ModuleKind::Passive,
    );

    let active_events = Arc::new(Mutex::new(Vec::new()));
    assert_lifecycle(
        InstalledModule::new(
            ModuleInstanceId::new("active"),
            ActiveRecording(RecordingModule {
                events: active_events.clone(),
            }),
        ),
        ModuleKind::Active,
    );

    let expected = vec![
        "initialize",
        "setup",
        "run",
        "stop",
        "teardown",
        "shutdown",
        "cleanup",
    ];
    assert_eq!(*passive_events.lock().unwrap(), expected);
    assert_eq!(*active_events.lock().unwrap(), expected);
}
