---
title: Microservice
---

# `Microservice`

Composes installed modules and coordinates their lifecycle.

## Methods

### `new`

```rust
pub fn new() -> Self
```

Creates an idle service using the production module context. `Default::default()` is equivalent.

### `state`

```rust
pub fn state(&self) -> MicroserviceState
```

Returns the service's current lifecycle state.

### `install`

```rust
pub fn install<M, F>(&mut self, factory: F) -> Result<(), MicroserviceError>
where
    M: MicroserviceModule + 'static,
    F: FnOnce(MicroserviceContextHandle) -> M
```

Installs an unnamed module. Use this when the module does not participate in explicit relationship binding.

### `install_named`

```rust
pub fn install_named<M, F>(
    &mut self,
    id: impl Into<String>,
    factory: F,
) -> Result<ModuleHandle<M>, MicroserviceError>
where
    M: MicroserviceModule + 'static,
    F: FnOnce(MicroserviceContextHandle) -> M
```

Installs a module under a unique stable ID and returns the handle used by [`bind`](#bind).

### `bind`

```rust
pub fn bind(
    &mut self,
    consumer: &dyn ModuleHandleIdentity,
    slot: &dyn RelationshipSlot,
    target: &dyn ModuleHandleIdentity,
) -> Result<(), MicroserviceError>
```

Binds one declared relationship on `consumer` to a provider exported by `target`. Both handles must belong to this service.

### `run`

```rust
pub fn run(
    &mut self,
) -> BoxFuture<'static, Result<MicroserviceExecutionResult, MicroserviceError>>
```

Seals and validates the composition, starts the lifecycle immediately, and returns an owned completion future. Dropping the future does not cancel execution. A service can run only once.

### `stop`

```rust
pub fn stop(
    &self,
    request: MicroserviceStopRequest,
) -> BoxFuture<'static, Result<MicroserviceExecutionResult, MicroserviceError>>
```

Requests an orderly stop and waits for the shared completion result. The first stop request wins.
