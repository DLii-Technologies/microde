---
title: Stopping and errors
---

# Stopping and errors

## Request an orderly stop

Call `stop()` after execution has started. It requests an orderly unwind. Await the promise returned by `run()` to receive the final result:

```ts
const execution = service.run();

process.once('SIGTERM', () => {
	service.stop();
});

const result = await execution;
process.exitCode = result.exitCode;
```

You can request a particular exit code, associate an error with the stop, or provide both:

```ts
service.stop(2);
service.stop(new Error('lost connection'));
service.stop(2, new Error('invalid configuration'));
```

Only the first stop request supplies the requested exit code and error. Calling `stop()` before the service starts throws.

## Handle lifecycle failures

Lifecycle failures do not reject the main execution promise. Inspect the returned result after cleanup finishes:

```ts
const result = await service.run();

if (result.errors) {
	for (const error of result.errors) {
		console.error(error);
	}
} else if (result.error !== undefined) {
	console.error(result.error);
}
```

The `errors` array is present only when more than one failure was recorded. `error` contains the primary failure.

## Panic only when immediate exit is required

`panic(error)` logs the error and a trace, then calls `process.exit(1)`. Because this bypasses teardown and cleanup, reserve it for conditions where continuing the normal lifecycle is unsafe.
