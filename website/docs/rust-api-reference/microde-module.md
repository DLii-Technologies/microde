---
title: MicrodeModule
---

# `MicrodeModule`

The lifecycle trait implemented by every installed module.

```rust
pub trait MicrodeModule: Send {
    const KIND: ModuleKind;

    fn relationships(&self) -> Vec<RelationshipDescriptor>;
    fn providers(&self) -> Vec<Provider>;
    fn initialize(&mut self) -> ModuleFuture;
    fn setup(&mut self) -> ModuleFuture;
    fn setup_with_context(&mut self, context: SetupContext) -> ModuleFuture;
    fn run(&mut self) -> ModuleFuture;
    fn run_with_context(&mut self, context: RunContext) -> ModuleFuture;
    fn stop(&mut self) -> ModuleFuture;
    fn teardown(&mut self) -> ModuleFuture;
    fn shutdown(&mut self) -> ModuleFuture;
    fn cleanup(&mut self) -> ModuleFuture;
}
```

All methods have successful no-op defaults. `setup_with_context` delegates to `setup`, and `run_with_context` delegates to `run`, so override only one method from each pair.

Return relationship descriptors from `relationships()` and owned exports from `providers()`. Dependencies are available during setup and run; references are available only during run.

Forward phases run in this order: initialize, setup, run. Reverse phases run teardown, shutdown, cleanup. A passive module completes independently; an active module normally keeps its run future pending until `stop` releases it.
