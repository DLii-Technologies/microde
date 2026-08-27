---
title: Rust API reference
description: Rust API reference for the microde-microservice crate.
---

# `microde-microservice`

The Rust runtime is published as the `microde-microservice` crate. Add it with

```bash
cargo add microde-microservice
```

The API uses the same composition model as the TypeScript runtime while using
Rust-native traits, owned futures, and `Result`-based errors.

## API index

### Runtime

- [`MicrodeApplication`](./rust-api-reference/microde-application.md) installs modules, binds relationships, and coordinates execution.
- [`MicrodeModule`](./rust-api-reference/microde-module.md) defines the module lifecycle.
- [`MicrodeContext`](./rust-api-reference/microde-context.md) lets modules request a stop or terminate immediately.
- [`MicrodeStopRequest`](./rust-api-reference/microde-stop-request.md) describes an orderly shutdown request.
- [`MicrodeExecutionResult`](./rust-api-reference/microde-execution-result.md) reports the final outcome.
- [`MicrodeApplicationState`](./rust-api-reference/microde-application-state.md) and [`ModuleKind`](./rust-api-reference/module-kind.md) describe runtime behavior.
- [`MicrodeError`](./rust-api-reference/microde-error.md) is the error type returned by the runtime.

### Modules and composition

- [`ModuleFuture`](./rust-api-reference/module-future.md) is the owned future returned by lifecycle methods.
- [`ModuleHandle`](./rust-api-reference/module-handle.md) and [`ModuleInstanceId`](./rust-api-reference/module-instance-id.md) identify an exact installed module.
- [`Port`](./rust-api-reference/port.md) declares a provider contract; [`Provider`](./rust-api-reference/provider.md) exports a value for it.
- [`Dependency`](./rust-api-reference/dependency.md) and [`Reference`](./rust-api-reference/reference.md) declare relationship slots.
- [`SetupContext`](./rust-api-reference/setup-context.md) and [`RunContext`](./rust-api-reference/run-context.md) resolve bound values in lifecycle methods.

### Supporting traits and descriptors

- [`RelationshipKind`](./rust-api-reference/relationship-kind.md), [`RelationshipDescriptor`](./rust-api-reference/relationship-descriptor.md), and [`RelationshipSlot`](./rust-api-reference/relationship-slot.md) describe relationship metadata used by composition.
- [`RunRelationship`](./rust-api-reference/run-relationship.md) is implemented by slots accepted by `RunContext`.
- [`MicrodeContextHandle`](./rust-api-reference/microde-context-handle.md) is an independently owned module context.

## Module implementation

Modules declare their kind and override lifecycle methods as needed:

```rust
use microde_microservice::{MicrodeModule, ModuleFuture, ModuleKind};

struct Worker;

impl MicrodeModule for Worker {
    const KIND: ModuleKind = ModuleKind::Passive;

    fn run(&mut self) -> ModuleFuture {
        Box::pin(async {
            println!("worker complete");
            Ok(())
        })
    }
}
```

`initialize`, `setup_with_context`, `run_with_context`, `stop`, `teardown`,
`shutdown`, and `cleanup` have default implementations. Override only the
phases the module needs.

## Installation and composition

`install_named` returns an opaque `ModuleHandle` for one stable module instance.
Handles are required when binding relationships and cannot be used across
different `MicrodeApplication` values.

```rust
let database = service.install_named("database", |_| DatabaseModule::new())?;
let orders = service.install_named("orders", |_| OrdersModule::new())?;
service.bind(&orders, &orders_database, &database)?;
```

Calling `serve` or `run` seals the composition. Bindings, providers, and dependency cycles
are validated before any lifecycle callback starts.

## Ports, providers, and relationships

`Port<T>` identifies a typed provider contract. A module returns its owned
`Provider` values from `providers()`. Consumers declare `Dependency<T>` and
`Reference<T>` relationship slots from a port:

```rust
let database_port = Port::<Database>::new("database");
let database_slot = Dependency::new("database", database_port.clone());
let peer_slot = Reference::new("peer", database_port);
```

Dependencies participate in the lifecycle DAG and are available through
`SetupContext` and `RunContext`. References do not affect lifecycle order and
are available only through `RunContext`, so reference cycles are allowed.

## Lifecycle contexts

Use `SetupContext::use_dependency` during setup and
`RunContext::use_relationship` during run:

```rust
fn setup_with_context(&mut self, context: SetupContext) -> ModuleFuture {
    let database: Database = context.use_dependency(&self.database_slot)?;
    Box::pin(async move { Ok(()) })
}

fn run_with_context(&mut self, context: RunContext) -> ModuleFuture {
    let peer: Database = context.use_relationship(&self.peer_slot)?;
    Box::pin(async move { Ok(()) })
}
```

Lifecycle order is dependency-first with stable instance IDs as tie-breakers.
Teardown, shutdown, and cleanup use the exact reverse order.
