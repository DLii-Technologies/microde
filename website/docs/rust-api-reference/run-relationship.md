---
title: RunRelationship
---

# `RunRelationship<T>`

The common trait implemented by `Dependency<T>` and `Reference<T>` for values accepted by `RunContext::use_relationship`.

```rust
pub trait RunRelationship<T> {
    fn slot_id(&self) -> u64;
    fn name(&self) -> &str;
}
```

Application code normally uses this trait only through the generic bound on `RunContext::use_relationship`.
