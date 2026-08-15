---
title: MicroserviceContextHandle
---

# `MicroserviceContextHandle`

An independently owned, cloneable module-facing context.

```rust
pub type MicroserviceContextHandle = Arc<dyn MicroserviceContext>;
```

The handle is passed to module factories. Clone it when multiple owned tasks need to request a stop or trigger an immediate panic.
