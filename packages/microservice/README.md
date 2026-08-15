# @microde/microservice

[![npm version](https://img.shields.io/npm/v/%40microde%2Fmicroservice.svg)](https://www.npmjs.com/package/@microde/microservice)
[![code coverage](https://codecov.io/gh/DLii-Technologies/microde/graph/badge.svg?component=ts-microservice)](https://codecov.io/gh/DLii-Technologies/microde)

The core driver for Microde service composition and lifecycle management.

```ts
import {
	Microservice,
	type MicroserviceContext,
	MicroserviceModule,
	ModuleKind,
} from '@microde/microservice';

class Task extends MicroserviceModule {
	readonly kind = ModuleKind.Passive;

	constructor(context: MicroserviceContext) {
		super(context);
	}

	async run(): Promise<void> {
		console.log('Task complete');
	}

	async stop(): Promise<void> {}
}

const service = new Microservice();
service.install((context) => new Task(context));

const result = await service.run();
process.exitCode = result.exitCode;
```

Modules depend on `MicroserviceContext`, the narrow `requestStop()` and `panic()`
contract supplied by the `Microservice` through a dedicated context object.

See the documentation in the repository for lifecycle guides and the complete API reference.

## Explicit dependencies and references

Named installation returns an opaque module handle. Modules declare runtime port
tokens, provider exports, and relationship slots; the service binds each slot to
one exact handle before `run()` atomically validates and wires the composition.

```ts
const databasePort = port<Database>('database');

class OrdersModule extends MicroserviceModule {
	readonly kind = ModuleKind.Passive;
	readonly database = dependency('database', databasePort);
	readonly relationships = [this.database];

	async setup(context: SetupContext) {
		context.use(this.database);
	}
}

const database = service.install(
	'database',
	(context) => new DatabaseModule(context),
);
const orders = service.install(
	'orders',
	(context) => new OrdersModule(context),
);
service.bind(orders, 'database', database);
```

Dependencies form an acyclic lifecycle graph. References may form cycles, do not
affect ordering, and are accessible only from `RunContext`.
