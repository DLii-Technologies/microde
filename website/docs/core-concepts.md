---
sidebar_position: 4
title: Core concepts
---

# Core concepts

## The microservice

`Microservice` owns the installed modules and coordinates their lifecycle. Its `state` property exposes the current phase, and its execution result reports an exit code plus any failures encountered while running or unwinding the service.

## Modules

Every module owns one focused part of a service and implements six lifecycle methods:

1. `initialize` acquires resources needed to configure the module.
2. `setup` connects the initialized module to the service.
3. `run` performs the module's work.
4. `teardown` reverses setup.
5. `shutdown` releases initialized resources.
6. `cleanup` performs final cleanup in every execution path.

Initialization and setup proceed in installation order. Teardown, shutdown, and cleanup proceed in reverse installation order.

## Module context

Every module receives a `MicroserviceContext` through its constructor. The base module makes it available to subclasses as the protected, read-only `context` property. The context deliberately contains only the service operations a module needs:

- `requestStop()` requests an orderly stop without waiting for the overall lifecycle result. Its optional request object can contain an exit code, error, or both.
- `panic()` terminates immediately when normal lifecycle cleanup would be unsafe.

`Microservice` owns a dedicated object that implements this contract and supplies it to module factories. Modules should accept `MicroserviceContext` rather than depend on the concrete lifecycle coordinator. This keeps modules focused and makes them easier to test with a minimal context substitute.

## Passive modules

A `PassiveMicroserviceModule` performs work whose `run()` promise completes on its own. When a service has only passive modules, it begins unwinding after every module settles.

## Active modules

An `ActiveMicroserviceModule` represents a long-running component and adds a `stop()` method. If an active module finishes, a passive module fails, or the service receives a stop request, Microde asks active modules to stop in reverse installation order before unwinding the lifecycle.

The active module's `stop()` implementation should cause its `run()` promise to settle.

## Execution results

Successful execution returns `{ exitCode: 0 }`. A lifecycle or execution failure normally returns exit code `1`, the primary `error`, and—when multiple failures occur—an `errors` array in priority order.
