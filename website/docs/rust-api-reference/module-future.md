---
title: ModuleFuture
---

# `ModuleFuture`

The object-safe future returned by module lifecycle operations.

```rust
pub type ModuleFuture =
    Pin<Box<dyn Future<Output = Result<(), MicrodeError>> + Send + 'static>>;
```

The future must own everything it uses because it is `Send + 'static` and cannot borrow the module. Return one with `Box::pin(async move { ... })`.
