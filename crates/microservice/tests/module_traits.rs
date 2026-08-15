use std::sync::{Arc, Mutex};

use futures::executor::block_on;
use microde_microservice::{
    ActiveMicroserviceModule, MicroserviceError, MicroserviceModule, ModuleFuture,
};

struct PassiveTestModule {
    events: Arc<Mutex<Vec<&'static str>>>,
}

impl MicroserviceModule for PassiveTestModule {
    fn run(&mut self) -> ModuleFuture {
        let events = self.events.clone();
        Box::pin(async move {
            events.lock().unwrap().push("run");
            Ok(())
        })
    }
}

struct ActiveTestModule {
    events: Arc<Mutex<Vec<&'static str>>>,
}

impl MicroserviceModule for ActiveTestModule {
    fn run(&mut self) -> ModuleFuture {
        Box::pin(async { Err(MicroserviceError::new("run failed")) })
    }
}

impl ActiveMicroserviceModule for ActiveTestModule {
    fn stop(&mut self) -> ModuleFuture {
        let events = self.events.clone();
        Box::pin(async move {
            events.lock().unwrap().push("stop");
            Ok(())
        })
    }
}

#[test]
fn optional_lifecycle_phases_succeed_by_default() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut module = PassiveTestModule {
        events: events.clone(),
    };

    block_on(module.initialize()).unwrap();
    block_on(module.setup()).unwrap();
    block_on(module.run()).unwrap();
    block_on(module.teardown()).unwrap();
    block_on(module.shutdown()).unwrap();
    block_on(module.cleanup()).unwrap();

    assert_eq!(*events.lock().unwrap(), vec!["run"]);
}

#[test]
fn active_modules_have_a_required_stop_operation() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut module: Box<dyn ActiveMicroserviceModule> = Box::new(ActiveTestModule {
        events: events.clone(),
    });

    assert_eq!(
        block_on(module.run()).unwrap_err(),
        MicroserviceError::new("run failed")
    );
    block_on(module.stop()).unwrap();

    assert_eq!(*events.lock().unwrap(), vec!["stop"]);
}

#[test]
fn an_active_run_can_remain_owned_while_stop_is_requested() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let mut module = ActiveTestModule {
        events: events.clone(),
    };

    let run = module.run();
    let stop = module.stop();

    block_on(stop).unwrap();
    assert_eq!(
        block_on(run).unwrap_err(),
        MicroserviceError::new("run failed")
    );
    assert_eq!(*events.lock().unwrap(), vec!["stop"]);
}
