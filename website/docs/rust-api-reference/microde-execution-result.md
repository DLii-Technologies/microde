---
title: MicrodeExecutionResult
---

# `MicrodeExecutionResult`

The outcome returned after a service finishes its lifecycle.

```rust
pub struct MicrodeExecutionResult {
    pub exit_code: i32,
    pub error: Option<MicrodeError>,
    pub errors: Option<Vec<MicrodeError>>,
}
```

`error` contains the highest-priority lifecycle error. `errors` contains every lifecycle error in priority order when more than one occurred. Use `exit_code` as the suggested process exit code.
