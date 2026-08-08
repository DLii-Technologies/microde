# @microde/microservice

The core driver for Microde service composition and lifecycle management.

```ts
import { Microservice, PassiveMicroserviceModule } from '@microde/microservice';

class Task extends PassiveMicroserviceModule {
	async initialize() {}
	async setup() {}
	async run() {}
	async teardown() {}
	async shutdown() {}
	async cleanup() {}
}

const service = new Microservice();
service.install((microservice) => new Task(microservice));

const result = await service.run();
process.exitCode = result.exitCode;
```

See the documentation in the repository for lifecycle guides and the complete API reference.
