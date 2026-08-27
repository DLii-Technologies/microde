---
title: Port
---

# `Port<T>`

A nominal runtime identity for a typed provider contract.

```rust
pub fn new(description: impl Into<String>) -> Self
pub fn description(&self) -> &str
pub fn for_module<M: MicrodeModule + 'static>(description: impl Into<String>) -> Self
```

Clone a port to share the same contract identity between a provider and its relationship slots. Calling `Port::new` twice creates two different contracts even when their descriptions match.

`for_module` additionally requires the bound provider to be an installation of the specified concrete module type.
