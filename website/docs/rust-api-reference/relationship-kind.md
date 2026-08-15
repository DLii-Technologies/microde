---
title: RelationshipKind
---

# `RelationshipKind`

Identifies how a relationship participates in the lifecycle.

```rust
pub enum RelationshipKind {
    Dependency,
    Reference,
}
```

Dependencies affect lifecycle order and can be used during setup. References do neither and can be used during run only.
