# Microde application runtime

[![code coverage](https://codecov.io/gh/DLii-Technologies/microde/graph/badge.svg?component=rust-application)](https://codecov.io/gh/DLii-Technologies/microde)

`microde-application` is the Rust implementation of Microde's composition and
lifecycle runtime. It installs passive and active modules, coordinates their
asynchronous lifecycle hooks, supports orderly stop requests, and reports a
deterministic execution result.

Lifecycle methods return owned, `Send`, `'static` futures. This lets the runtime
poll modules concurrently without borrowing the service or holding a lock across
an await point.

```rust
use microde_application::{
    MicrodeApplication, MicrodeError, MicrodeModule, ModuleFuture, ModuleKind,
};

struct Worker;

impl MicrodeModule for Worker {
    const KIND: ModuleKind = ModuleKind::Passive;

    fn run(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }

    fn stop(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }
}

#[tokio::main]
async fn main() -> Result<(), MicrodeError> {
    let mut service = MicrodeApplication::new();
    service.install(|_| Worker)?;

    let result = service.serve().await?;
    assert_eq!(result.exit_code, 0);
    assert!(result.error.is_none());

    Ok(())
}
```

Use `run` for a finite application task. Microde starts the modules first and
begins orderly shutdown when the task returns:

```rust,ignore
let result = service.run(|context| async move {
    import_records().await?;
    Ok(())
}).await?;
```

Every module declares `MicrodeModule::KIND`. The default `run` and `stop`
operations are no-ops. A passive module's `run` future is expected to complete
normally; an active module's overridden `run` future should return only after
the module stops. An application's owned `serve` or `run` future can be polled
while another task calls `MicrodeApplication::stop`; the first stop request wins and
all callers receive the same completed result.

## Explicit dependencies and references

`install_named` returns an opaque, identity-bearing `ModuleHandle`. Modules expose
owned values through typed `Port` and `Provider` declarations and return their
relationship descriptors from `relationships()`. Composition binds exact instances:

```rust,ignore
let database = service.install_named("database", |_| DatabaseModule::new())?;
let orders = service.install_named("orders", |_| OrdersModule::new(database_port.clone()))?;
service.bind(&orders, &orders_database, &database)?;
```

Override `setup_with_context` to use dependencies. Override `run_with_context` to
use dependencies or references. Provider values are owned and cloned, preserving
`Send + 'static` lifecycle futures. Dependency cycles fail before initialization;
reference cycles are allowed and do not affect lifecycle order.

Calling `serve` or `run` seals the composition. All bindings and provider factories are
validated and staged before initialization, so a wiring or provider error starts
no lifecycle callback. Named instances are ordered by the dependency graph with
stable IDs as the tie-breaker; teardown, shutdown, and cleanup use the exact
reverse order.
