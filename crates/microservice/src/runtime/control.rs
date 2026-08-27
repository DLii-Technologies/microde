use std::sync::{Mutex, MutexGuard};

use event_listener::Event;
use futures::channel::oneshot;

use crate::{MicrodeError, MicrodeExecutionResult, MicrodeStopRequest};

pub(crate) type RuntimeResult = Result<MicrodeExecutionResult, MicrodeError>;

pub(crate) struct RuntimeControl {
    stop_request: Mutex<Option<MicrodeStopRequest>>,
    stop_sender: Mutex<Option<oneshot::Sender<()>>>,
    stop_receiver: Mutex<Option<oneshot::Receiver<()>>>,
    completion: Mutex<Option<RuntimeResult>>,
    completion_event: Event,
}

impl Default for RuntimeControl {
    fn default() -> Self {
        let (stop_sender, stop_receiver) = oneshot::channel();
        Self {
            stop_request: Mutex::new(None),
            stop_sender: Mutex::new(Some(stop_sender)),
            stop_receiver: Mutex::new(Some(stop_receiver)),
            completion: Mutex::new(None),
            completion_event: Event::new(),
        }
    }
}

impl RuntimeControl {
    pub(crate) fn request_stop(&self, request: MicrodeStopRequest) {
        let mut first_request = lock(&self.stop_request);
        if first_request.is_none() {
            *first_request = Some(request);
            let sender = lock(&self.stop_sender)
                .take()
                .expect("the first stop request owns the stop sender");
            let _ = sender.send(());
        }
    }

    pub(crate) fn stop_requested(&self) -> bool {
        lock(&self.stop_request).is_some()
    }

    pub(crate) fn stop_request(&self) -> Option<MicrodeStopRequest> {
        lock(&self.stop_request).clone()
    }

    pub(crate) fn take_stop_receiver(&self) -> oneshot::Receiver<()> {
        lock(&self.stop_receiver).take().unwrap()
    }

    pub(crate) fn complete(&self, result: RuntimeResult) {
        *lock(&self.completion) = Some(result);
        self.completion_event.notify(usize::MAX);
    }

    pub(crate) async fn wait_for_completion(&self) -> RuntimeResult {
        loop {
            let listener = self.completion_event.listen();
            if let Some(result) = lock(&self.completion).clone() {
                return result;
            }
            listener.await;
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
