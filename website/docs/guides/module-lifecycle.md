---
title: Module lifecycle
---

# Module lifecycle

Use each lifecycle phase for a distinct level of resource ownership.

| Phase        | Purpose                                        | Order                         |
| ------------ | ---------------------------------------------- | ----------------------------- |
| `initialize` | Acquire resources and prepare local state      | Installation order            |
| `setup`      | Connect the module to other service components | Installation order            |
| `run`        | Perform finite or long-running work            | Started in installation order |
| `teardown`   | Undo setup                                     | Reverse installation order    |
| `shutdown`   | Release initialized resources                  | Reverse installation order    |
| `cleanup`    | Perform unconditional final cleanup            | Reverse installation order    |

## Partial startup

Microde tracks how far each module progressed. If initialization fails, only modules that reached initialization are shut down, but every installed module is cleaned up. If setup fails, only modules that reached setup are torn down.

This lets lifecycle methods assume that their corresponding forward phase was reached. Cleanup is the exception: it must be safe after any earlier outcome.

## Implementation guidance

- Keep lifecycle methods idempotent where practical.
- Let errors propagate; Microde records them and continues the appropriate unwind phases.
- Do not call `panic()` for recoverable lifecycle failures because it exits the process without unwinding.
- Ensure an active module's `stop()` eventually settles its `run()` promise.
