---
title: MicrodeContext
---

# `MicrodeContext`

Operations exposed by a service to its installed modules.

```rust
pub trait MicrodeContext: Send + Sync {
    fn request_stop(&self, request: MicrodeStopRequest);
    fn panic(&self, error: Option<MicrodeError>) -> !;
}
```

`request_stop` initiates orderly shutdown and returns immediately. `panic` terminates execution immediately and bypasses teardown, shutdown, and cleanup.

Factories receive a [`MicrodeContextHandle`](./microde-context-handle.md), which can be cloned into owned asynchronous work.
