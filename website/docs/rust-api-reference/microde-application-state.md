---
title: MicrodeApplicationState
---

# `MicrodeApplicationState`

The observable lifecycle state returned by `MicrodeApplication::state()`.

```rust
pub enum MicrodeApplicationState {
    Idle,
    Installing,
    Initialization,
    Setup,
    Running,
    TearDown,
    Shutdown,
    CleanUp,
    Finished,
    Failed,
}
```

Installation is allowed only while idle. `Finished` and `Failed` are terminal states.
