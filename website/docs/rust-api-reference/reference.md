---
title: Reference
---

# `Reference<T>`

A typed relationship slot that does not affect lifecycle ordering and is available only during run.

```rust
pub fn new(name: impl Into<String>, port: Port<T>) -> Self
pub fn name(&self) -> &str
pub fn port(&self) -> &Port<T>
```

Return its descriptor from `MicroserviceModule::relationships`, bind it with `Microservice::bind`, and resolve it with `RunContext::use_relationship`. Reference cycles are allowed.
