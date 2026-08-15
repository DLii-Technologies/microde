---
title: Examples
---

# Examples

## A stoppable active module

An active module keeps its `run()` promise pending until `stop()` releases it:

```ts
import {
	ActiveMicroserviceModule,
	Microservice,
	type MicroserviceContext,
} from '@microde/microservice';

class WorkerModule extends ActiveMicroserviceModule {
	private finish!: () => void;
	private readonly completion = new Promise<void>((resolve) => {
		this.finish = resolve;
	});

	constructor(context: MicroserviceContext) {
		super(context);
	}

	async run(): Promise<void> {
		return this.completion;
	}

	async stop(): Promise<void> {
		this.finish();
	}
}

const service = new Microservice();
service.install((context) => new WorkerModule(context));

process.once('SIGTERM', () => void service.stop());

const result = await service.run();
process.exitCode = result.exitCode;
```

Real modules can use the same shape to own an HTTP server, queue consumer, scheduler, or other resource with a start/stop boundary.
