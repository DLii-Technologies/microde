use std::sync::{Arc, Mutex};

use microde_application::{MicrodeContext, MicrodeContextHandle, MicrodeError, MicrodeStopRequest};

#[derive(Default)]
struct TestContext {
    requests: Mutex<Vec<MicrodeStopRequest>>,
}

impl MicrodeContext for TestContext {
    fn request_stop(&self, request: MicrodeStopRequest) {
        self.requests.lock().unwrap().push(request);
    }

    fn panic(&self, error: Option<MicrodeError>) -> ! {
        panic!("test context panic: {error:?}");
    }
}

struct ContextOnlyModule {
    context: MicrodeContextHandle,
}

impl ContextOnlyModule {
    fn request_stop(&self) {
        self.context
            .request_stop(MicrodeStopRequest::with_exit_code(12));
    }
}

fn assert_send_sync<T: Send + Sync>() {}

#[test]
fn a_module_can_request_stop_with_a_fake_context_and_no_runtime() {
    assert_send_sync::<MicrodeContextHandle>();

    let fake = Arc::new(TestContext::default());
    let module = ContextOnlyModule {
        context: fake.clone(),
    };

    module.request_stop();

    assert_eq!(
        *fake.requests.lock().unwrap(),
        vec![MicrodeStopRequest::with_exit_code(12)]
    );
}
