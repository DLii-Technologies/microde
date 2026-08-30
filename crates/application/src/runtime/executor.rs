use std::future::Future;
use std::sync::OnceLock;

use futures::executor::ThreadPool;

pub(crate) fn spawn(future: impl Future<Output = ()> + Send + 'static) {
    static EXECUTOR: OnceLock<ThreadPool> = OnceLock::new();
    EXECUTOR
        .get_or_init(|| ThreadPool::new().expect("failed to create the application executor"))
        .spawn_ok(future);
}
