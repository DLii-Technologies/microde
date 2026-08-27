---
title: RunContext
---

# `RunContext`

Resolves dependencies and references during `MicrodeModule::run_with_context`.

```rust
pub fn use_relationship<T, S>(
    &self,
    relationship: &S,
) -> Result<T, MicrodeError>
where
    T: Clone + Send + Sync + 'static,
    S: RunRelationship<T>
```

Pass either a `Dependency<T>` or `Reference<T>`. The returned value is owned, allowing it to move into the module's `'static` run future.
