# Microde microservice runtime

`microde-microservice` is the Rust implementation of Microde's composition and
lifecycle runtime. It installs passive and active modules, coordinates their
asynchronous lifecycle hooks, supports orderly stop requests, and reports a
deterministic execution result.

Lifecycle methods return owned, `Send`, `'static` futures. This lets the runtime
poll modules concurrently without borrowing the service or holding a lock across
an await point.

```rust
use microde_microservice::{
    Microservice, MicroserviceError, MicroserviceModule, ModuleFuture,
};

struct Worker;

impl MicroserviceModule for Worker {
    fn run(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }
}

#[tokio::main]
async fn main() -> Result<(), MicroserviceError> {
    let mut service = Microservice::new();
    service.install_passive(|_| Worker)?;

    let result = service.run().await?;
    assert_eq!(result.exit_code, 0);
    assert!(result.error.is_none());

    Ok(())
}
```

Use `install_active` for long-running modules that implement
`ActiveMicroserviceModule::stop`. A service's owned `run` future can be polled
while another task calls `Microservice::stop`; the first stop request wins and
all callers receive the same completed result.
