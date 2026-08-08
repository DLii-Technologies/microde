---
sidebar_position: 3
title: Quick start
---

# Quick start

Create a passive module for a finite task, install it, and run the service:

```ts
import { Microservice, PassiveMicroserviceModule } from '@microde/microservice';

class GreetingModule extends PassiveMicroserviceModule {
	async initialize(): Promise<void> {}

	async setup(): Promise<void> {}

	async run(): Promise<void> {
		console.log('Hello from Microde');
	}

	async teardown(): Promise<void> {}

	async shutdown(): Promise<void> {}

	async cleanup(): Promise<void> {}
}

const service = new Microservice();

service.install((microservice) => new GreetingModule(microservice));

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
