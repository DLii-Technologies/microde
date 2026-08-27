---
title: MicrodeContextHandle
---

# `MicrodeContextHandle`

An independently owned, cloneable module-facing context.

```rust
pub type MicrodeContextHandle = Arc<dyn MicrodeContext>;
```

The handle is passed to module factories. Clone it when multiple owned tasks need to request a stop or trigger an immediate panic.
