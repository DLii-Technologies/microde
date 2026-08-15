---
title: MicroserviceContext
---

# `MicroserviceContext`

Operations exposed by a service to its installed modules.

```rust
pub trait MicroserviceContext: Send + Sync {
    fn request_stop(&self, request: MicroserviceStopRequest);
    fn panic(&self, error: Option<MicroserviceError>) -> !;
}
```

`request_stop` initiates orderly shutdown and returns immediately. `panic` terminates execution immediately and bypasses teardown, shutdown, and cleanup.

Factories receive a [`MicroserviceContextHandle`](./microservice-context-handle.md), which can be cloned into owned asynchronous work.
