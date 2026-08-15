---
title: ModuleInstanceId
---

# `ModuleInstanceId`

The stable identity of one installed module instance.

```rust
pub fn new(value: impl Into<String>) -> Self
pub fn as_str(&self) -> &str
```

Named installations use the caller-provided value. IDs participate in deterministic lifecycle ordering when the dependency graph otherwise leaves modules unordered.
