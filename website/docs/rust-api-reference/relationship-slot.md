---
title: RelationshipSlot
---

# `RelationshipSlot`

The common trait implemented by `Dependency<T>` and `Reference<T>`.

```rust
pub trait RelationshipSlot {
    fn descriptor(&self) -> RelationshipDescriptor;
}
```

`MicrodeApplication::bind` accepts this trait so either relationship kind can be bound. Modules also use `descriptor()` when returning their declared relationships.
