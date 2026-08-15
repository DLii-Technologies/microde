---
title: SetupContext
---

# `SetupContext`

Resolves dependencies during `MicroserviceModule::setup_with_context`.

```rust
pub fn use_dependency<T>(
    &self,
    relationship: &Dependency<T>,
) -> Result<T, MicroserviceError>
where
    T: Clone + Send + Sync + 'static
```

The returned value is owned. References are intentionally unavailable during setup because they do not establish lifecycle order.
