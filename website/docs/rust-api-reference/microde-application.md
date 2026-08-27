---
title: MicrodeApplication
---

# `MicrodeApplication`

Composes installed modules and coordinates their lifecycle.

## Methods

### `new`

```rust
pub fn new() -> Self
```

Creates an idle service using the production module context. `Default::default()` is equivalent.

### `state`

```rust
pub fn state(&self) -> MicrodeApplicationState
```

Returns the service's current lifecycle state.

### `install`

```rust
pub fn install<M, F>(&mut self, factory: F) -> Result<(), MicrodeError>
where
    M: MicrodeModule + 'static,
    F: FnOnce(MicrodeContextHandle) -> M
```

Installs an unnamed module. Use this when the module does not participate in explicit relationship binding.

### `install_named`

```rust
pub fn install_named<M, F>(
    &mut self,
    id: impl Into<String>,
    factory: F,
) -> Result<ModuleHandle<M>, MicrodeError>
where
    M: MicrodeModule + 'static,
    F: FnOnce(MicrodeContextHandle) -> M
```

Installs a module under a unique stable ID and returns the handle used by [`bind`](#bind).

### `bind`

```rust
pub fn bind(
    &mut self,
    consumer: &dyn ModuleHandleIdentity,
    slot: &dyn RelationshipSlot,
    target: &dyn ModuleHandleIdentity,
) -> Result<(), MicrodeError>
```

Binds one declared relationship on `consumer` to a provider exported by `target`. Both handles must belong to this service.

### `serve`

```rust
pub fn serve(
    &mut self,
) -> BoxFuture<'static, Result<MicrodeExecutionResult, MicrodeError>>
```

Seals and validates the composition, starts the module-driven lifecycle immediately, and returns an owned completion future. Dropping the future does not cancel execution.

### `run`

```rust
pub fn run<Main, MainFuture>(
    &mut self,
    main: Main,
) -> BoxFuture<'static, Result<MicrodeExecutionResult, MicrodeError>>
```

Starts the modules and then invokes `main`. Completion or failure of `main`
begins orderly shutdown. An application can execute only once.

### `stop`

```rust
pub fn stop(
    &self,
    request: MicrodeStopRequest,
) -> BoxFuture<'static, Result<MicrodeExecutionResult, MicrodeError>>
```

Requests an orderly stop and waits for the shared completion result. The first stop request wins.
