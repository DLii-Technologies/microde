use std::sync::{Arc, Mutex};

use microde_microservice::{
    MicroserviceContext, MicroserviceContextHandle, MicroserviceError, MicroserviceStopRequest,
};

#[derive(Default)]
struct TestContext {
    requests: Mutex<Vec<MicroserviceStopRequest>>,
}

impl MicroserviceContext for TestContext {
    fn request_stop(&self, request: MicroserviceStopRequest) {
        self.requests.lock().unwrap().push(request);
    }

    fn panic(&self, error: Option<MicroserviceError>) -> ! {
        panic!("test context panic: {error:?}");
    }
}

struct ContextOnlyModule {
    context: MicroserviceContextHandle,
}

impl ContextOnlyModule {
    fn request_stop(&self) {
        self.context
            .request_stop(MicroserviceStopRequest::with_exit_code(12));
    }
}

fn assert_send_sync<T: Send + Sync>() {}

#[test]
fn a_module_can_request_stop_with_a_fake_context_and_no_runtime() {
    assert_send_sync::<MicroserviceContextHandle>();

    let fake = Arc::new(TestContext::default());
    let module = ContextOnlyModule {
        context: fake.clone(),
    };

    module.request_stop();

    assert_eq!(
        *fake.requests.lock().unwrap(),
        vec![MicroserviceStopRequest::with_exit_code(12)]
    );
}
