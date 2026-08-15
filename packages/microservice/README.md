# @microde/microservice

[![npm version](https://img.shields.io/npm/v/%40microde%2Fmicroservice.svg)](https://www.npmjs.com/package/@microde/microservice)
[![code coverage](https://codecov.io/gh/DLii-Technologies/microde/graph/badge.svg?component=microservice)](https://codecov.io/gh/DLii-Technologies/microde)

The core driver for Microde service composition and lifecycle management.

```ts
import {
	Microservice,
	type MicroserviceContext,
	PassiveMicroserviceModule,
} from '@microde/microservice';

class Task extends PassiveMicroserviceModule {
	constructor(context: MicroserviceContext) {
		super(context);
	}

	async run(): Promise<void> {
		console.log('Task complete');
	}
}

const service = new Microservice();
service.install((context) => new Task(context));

const result = await service.run();
process.exitCode = result.exitCode;
```

Modules depend on `MicroserviceContext`, the narrow `stop()` and `panic()`
contract implemented by `Microservice`.

See the documentation in the repository for lifecycle guides and the complete API reference.
