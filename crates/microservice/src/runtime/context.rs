use std::backtrace::Backtrace;
use std::sync::{Arc, Mutex};

use crate::{MicroserviceContext, MicroserviceError, MicroserviceState, MicroserviceStopRequest};

use super::RuntimeControl;

pub(crate) type TerminationStrategy = fn(Option<MicroserviceError>) -> !;

pub(crate) struct RuntimeContext {
    control: Arc<RuntimeControl>,
    state: Arc<Mutex<MicroserviceState>>,
    terminate: TerminationStrategy,
}

impl RuntimeContext {
    pub(crate) fn new(
        control: Arc<RuntimeControl>,
        state: Arc<Mutex<MicroserviceState>>,
        terminate: TerminationStrategy,
    ) -> Self {
        Self {
            control,
            state,
            terminate,
        }
    }
}

impl MicroserviceContext for RuntimeContext {
    fn request_stop(&self, request: MicroserviceStopRequest) {
        let state = *self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if matches!(
            state,
            MicroserviceState::Idle | MicroserviceState::Installing
        ) {
            panic!("cannot stop microservice before it has started; current state: {state:?}");
        }
        self.control.request_stop(request);
    }

    fn panic(&self, error: Option<MicroserviceError>) -> ! {
        (self.terminate)(error)
    }
}

pub(crate) fn terminate_process(error: Option<MicroserviceError>) -> ! {
    if let Some(error) = error {
        eprintln!("{error}");
    }
    eprintln!("{}", Backtrace::force_capture());
    std::process::exit(1)
}
