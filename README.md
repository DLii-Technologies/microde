# Microde

[![Microde — Build composable microservices with explicit lifecycles](website/static/img/social-card.svg)](https://microde.dlii.tech)

[![Codecov](https://codecov.io/gh/DLii-Technologies/microde/branch/master/graph/badge.svg)](https://codecov.io/gh/DLii-Technologies/microde/branch/master)

Microde is a framework for building software as a collection of composable, independently defined modules rather than committing early to a fixed service topology. Modules are connected through a common composition and communication model, with support for multiple communication patterns and runtimes hidden behind consistent abstractions. This lets the same application architecture run as a single executable, a small set of services, or a fully distributed microservice system—allowing deployment boundaries to evolve without forcing the software itself to be redesigned.


## Installation

```sh
npm install @microde/microservice
```

Microde is published as an ECMAScript module and includes TypeScript declarations.

## Quick start

Create a module, install it in a service, and run the service:

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

if (result.error !== undefined) {
	console.error(result.error);
}

process.exitCode = result.exitCode;
```

A service initializes and sets up modules in installation order, then tears them
down, shuts them down, and cleans them up in reverse order. Lifecycle failures are
returned in the execution result after cleanup completes.

Use `PassiveMicroserviceModule` for work that finishes on its own. Use
`ActiveMicroserviceModule` for long-running components that implement `stop()`.
Modules receive a `MicroserviceContext`, which exposes only the `requestStop()` and
`panic()` operations they need from their owning service.

## Documentation

Read the [documentation](https://microde.dlii.tech/docs/) for lifecycle guides,
examples, compatibility information, and the complete API reference.

## Development

This repository uses [pnpm](https://pnpm.io/). After installing dependencies with
`pnpm install`, the main commands are:

```sh
pnpm build       # Build all workspace packages
pnpm test        # Run the test suite
pnpm typecheck   # Type-check all workspace packages
pnpm docs:dev    # Start the documentation site locally
```

## License

[MIT](LICENSE)
