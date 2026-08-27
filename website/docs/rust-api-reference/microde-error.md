---
title: MicrodeError
---

# `MicrodeError`

An owned, cloneable error that can cross runtime concurrency boundaries.

```rust
pub fn new(message: impl Into<String>) -> MicrodeError
```

`MicrodeError` implements `std::error::Error`, `Display`, `Clone`, `Eq`, and `PartialEq`.

```rust
let error = MicrodeError::new("connection failed");
assert_eq!(error.to_string(), "connection failed");
```
