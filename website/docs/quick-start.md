---
sidebar_position: 3
title: Quick start
---

# Quick start

Create a passive module for a finite task, install it, and run the service:

```ts
import {
	Microservice,
	type MicroserviceContext,
	PassiveMicroserviceModule,
} from '@microde/microservice';

class GreetingModule extends PassiveMicroserviceModule {
	constructor(context: MicroserviceContext) {
		super(context);
	}

	async run(): Promise<void> {
		console.log('Hello from Microde');
	}
}

const service = new Microservice();

service.install((context) => new GreetingModule(context));

const result = await service.run();
process.exitCode = result.exitCode;
```

`run()` resolves only after the lifecycle has finished, including teardown, shutdown, and cleanup. Lifecycle failures are returned in the result rather than thrown from the returned promise:

```ts
const result = await service.run();

if (result.error !== undefined) {
	console.error(result.error);
}

process.exitCode = result.exitCode;
```

An individual `Microservice` can run only once. Install every module before calling `run()`.

Module constructors should accept `MicroserviceContext`, not the concrete `Microservice` class. The context exposes non-blocking `requestStop()` and `panic()` operations without coupling the module to lifecycle coordination APIs such as `install()`, `run()`, public `stop()`, or `state`.
