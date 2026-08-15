---
title: ModuleHandle
---

# `ModuleHandle<Module>`

An opaque, typed binding target for one installed module instance.

```rust
pub fn id(&self) -> &ModuleInstanceId
```

`Microservice::install_named` creates handles. Pass them to `Microservice::bind`; a handle cannot be used with a different service. The type parameter preserves the installed module type without exposing or borrowing the module object.
