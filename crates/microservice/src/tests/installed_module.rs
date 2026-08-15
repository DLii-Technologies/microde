use std::sync::{Arc, Mutex};

use futures::executor::block_on;

use super::*;

struct RecordingModule {
    events: Arc<Mutex<Vec<&'static str>>>,
}

impl MicroserviceModule for RecordingModule {
    fn initialize(&mut self) -> ModuleFuture {
        self.record("initialize")
    }

    fn setup(&mut self) -> ModuleFuture {
        self.record("setup")
    }

    fn run(&mut self) -> ModuleFuture {
        self.record("run")
    }

    fn teardown(&mut self) -> ModuleFuture {
        self.record("teardown")
    }

    fn shutdown(&mut self) -> ModuleFuture {
        self.record("shutdown")
    }

    fn cleanup(&mut self) -> ModuleFuture {
        self.record("cleanup")
    }
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

impl ActiveMicroserviceModule for RecordingModule {
    fn stop(&mut self) -> ModuleFuture {
        self.record("stop")
    }
}

#[test]
fn passive_storage_tracks_stage_and_dispatches_lifecycle() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut installed = InstalledModule::passive(RecordingModule {
        events: events.clone(),
    });

    assert_eq!(installed.kind(), ModuleKind::Passive);
    assert_eq!(installed.stage(), ModuleStage::Installed);
    installed.set_stage(ModuleStage::Executing);
    assert_eq!(installed.stage(), ModuleStage::Executing);

    block_on(installed.initialize()).unwrap();
    block_on(installed.setup()).unwrap();
    block_on(installed.run()).unwrap();
    assert!(installed.stop().is_none());
    block_on(installed.teardown()).unwrap();
    block_on(installed.shutdown()).unwrap();
    block_on(installed.cleanup()).unwrap();

    assert_eq!(
        *events.lock().unwrap(),
        vec![
            "initialize",
            "setup",
            "run",
            "teardown",
            "shutdown",
            "cleanup"
        ]
    );
}

#[test]
fn active_storage_dispatches_stop_and_reports_active_kind() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut installed = InstalledModule::active(RecordingModule {
        events: events.clone(),
    });

    assert_eq!(installed.kind(), ModuleKind::Active);
    assert_eq!(installed.stage(), ModuleStage::Installed);
    installed.set_stage(ModuleStage::Executing);
    assert_eq!(installed.stage(), ModuleStage::Executing);
    block_on(installed.initialize()).unwrap();
    block_on(installed.setup()).unwrap();
    block_on(installed.run()).unwrap();
    block_on(installed.stop().unwrap()).unwrap();
    block_on(installed.teardown()).unwrap();
    block_on(installed.shutdown()).unwrap();
    block_on(installed.cleanup()).unwrap();

    assert_eq!(
        *events.lock().unwrap(),
        vec![
            "initialize",
            "setup",
            "run",
            "stop",
            "teardown",
            "shutdown",
            "cleanup"
        ]
    );
}
