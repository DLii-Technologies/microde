---
title: Provider
---

# `Provider`

An owned value or fallible value factory exported by a module for a [`Port`](./port.md).

```rust
pub fn new<T: Send + Sync + 'static>(port: Port<T>, value: T) -> Self

pub fn try_new<T, F>(port: Port<T>, factory: F) -> Self
where
    T: Send + Sync + 'static,
    F: Fn() -> Result<T, MicroserviceError> + Send + Sync + 'static
```

Return providers from `MicroserviceModule::providers`. Provider factories are resolved while composition is validated, before any lifecycle callback begins. A provider value is resolved once and shared across relationships through owned clones.
