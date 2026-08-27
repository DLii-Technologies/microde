---
title: Dependency
---

# `Dependency<T>`

A typed relationship slot that affects lifecycle ordering and is available during setup and run.

```rust
pub fn new(name: impl Into<String>, port: Port<T>) -> Self
pub fn name(&self) -> &str
pub fn port(&self) -> &Port<T>
```

Return its descriptor from `MicrodeModule::relationships`, bind it with `MicrodeApplication::bind`, and resolve it with `SetupContext::use_dependency` or `RunContext::use_relationship`.

Dependencies form a directed acyclic graph. Their providers initialize and set up before consumers, and reverse lifecycle phases run consumers before providers. Dependency cycles are rejected before initialization.
