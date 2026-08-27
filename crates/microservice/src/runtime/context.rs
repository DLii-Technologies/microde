use std::backtrace::Backtrace;
use std::sync::{Arc, Mutex};

use crate::{MicrodeApplicationState, MicrodeContext, MicrodeError, MicrodeStopRequest};

use super::RuntimeControl;

pub(crate) type TerminationStrategy = fn(Option<MicrodeError>) -> !;

pub(crate) struct RuntimeContext {
    control: Arc<RuntimeControl>,
    state: Arc<Mutex<MicrodeApplicationState>>,
    terminate: TerminationStrategy,
}

impl RuntimeContext {
    pub(crate) fn new(
        control: Arc<RuntimeControl>,
        state: Arc<Mutex<MicrodeApplicationState>>,
        terminate: TerminationStrategy,
    ) -> Self {
        Self {
            control,
            state,
            terminate,
        }
    }
}

impl MicrodeContext for RuntimeContext {
    fn request_stop(&self, request: MicrodeStopRequest) {
        let state = *self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if matches!(
            state,
            MicrodeApplicationState::Idle | MicrodeApplicationState::Installing
        ) {
            panic!("cannot stop application before it has started; current state: {state:?}");
        }
        self.control.request_stop(request);
    }

    fn panic(&self, error: Option<MicrodeError>) -> ! {
        (self.terminate)(error)
    }
}

pub(crate) fn terminate_process(error: Option<MicrodeError>) -> ! {
    if let Some(error) = error {
        eprintln!("{error}");
    }
    eprintln!("{}", Backtrace::force_capture());
    std::process::exit(1)
}
