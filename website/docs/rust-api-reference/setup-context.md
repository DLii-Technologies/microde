---
title: SetupContext
---

# `SetupContext`

Resolves dependencies during `MicrodeModule::setup_with_context`.

```rust
pub fn use_dependency<T>(
    &self,
    relationship: &Dependency<T>,
) -> Result<T, MicrodeError>
where
    T: Clone + Send + Sync + 'static
```

The returned value is owned. References are intentionally unavailable during setup because they do not establish lifecycle order.
