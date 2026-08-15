---
title: MicroserviceStopRequest
---

# `MicroserviceStopRequest`

A non-blocking request for orderly lifecycle termination.

```rust
pub struct MicroserviceStopRequest {
    pub exit_code: Option<i32>,
    pub error: Option<MicroserviceError>,
}
```

## Constructors

- `success()` requests a successful stop with the default exit code.
- `with_exit_code(code)` supplies a process exit code.
- `with_error(error)` records an error.
- `with_exit_code_and_error(code, error)` supplies both.

`Default::default()` is equivalent to `success()`.
