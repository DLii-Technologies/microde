---
title: MicroserviceState
---

# `MicroserviceState`

The observable lifecycle state returned by `Microservice::state()`.

```rust
pub enum MicroserviceState {
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
