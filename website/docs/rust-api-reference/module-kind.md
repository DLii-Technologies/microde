---
title: ModuleKind
---

# `ModuleKind`

Describes how the runtime interprets completion of a module's `run` future.

```rust
pub enum ModuleKind {
    Passive,
    Active,
}
```

- `Passive` modules complete independently. When all passive modules complete, active modules are stopped.
- `Active` modules normally remain running until an orderly stop is requested.
