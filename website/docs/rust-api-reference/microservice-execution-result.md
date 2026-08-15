---
title: MicroserviceExecutionResult
---

# `MicroserviceExecutionResult`

The outcome returned after a service finishes its lifecycle.

```rust
pub struct MicroserviceExecutionResult {
    pub exit_code: i32,
    pub error: Option<MicroserviceError>,
    pub errors: Option<Vec<MicroserviceError>>,
}
```

`error` contains the highest-priority lifecycle error. `errors` contains every lifecycle error in priority order when more than one occurred. Use `exit_code` as the suggested process exit code.
