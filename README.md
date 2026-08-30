# Microde

[![Microde — Build composable applications with explicit lifecycles](website/static/img/social-card.svg)](https://microde.dlii.tech)

[![Codecov](https://codecov.io/gh/DLii-Technologies/microde/branch/master/graph/badge.svg)](https://codecov.io/gh/DLii-Technologies/microde/branch/master)

Microde is a framework for building software as a collection of composable, independently defined modules rather than committing early to a fixed service topology. It provides the same explicit composition and lifecycle model in TypeScript and Rust, with runtime-specific APIs and consistent dependency, reference, and failure semantics.

## Installation

For TypeScript:

```sh
npm install @microde/application
```

For Rust:

```sh
cargo add microde-application
```

Both packages expose the same explicit composition and lifecycle model through
their language-native APIs.

## Quick start

Create a module, install it in a service, and run the service:

```ts
import {
	MicrodeApplication,
	type MicrodeContext,
	MicrodeModule,
	ModuleKind,
} from '@microde/application';

class GreetingModule extends MicrodeModule {
	readonly kind = ModuleKind.Passive;

	constructor(context: MicrodeContext) {
		super(context);
	}

	async run(): Promise<void> {
		console.log('Hello from Microde');
	}

	async stop(): Promise<void> {}
}

const service = new MicrodeApplication();
service.install((context) => new GreetingModule(context));

const result = await service.serve();

if (result.error !== undefined) {
	console.error(result.error);
}

process.exitCode = result.exitCode;
```

For a finite application task, use `run(main)` instead. Modules start before the
main callback, and its completion begins orderly shutdown:

```ts
const result = await service.run(async (context) => {
	await performWork();
});
```

A service initializes and sets up modules in dependency-first order, then tears
them down, shuts them down, and cleans them up in reverse order. Lifecycle
failures are returned in the execution result after cleanup completes.

Declare `ModuleKind.Passive` for work whose `run()` finishes on its own and
`ModuleKind.Active` for work whose `run()` finishes only after `stop()`.
Modules receive a `MicrodeContext`, which exposes only the `requestStop()` and
`panic()` operations they need from their owning service.

Named installations return opaque handles that bind relationship slots to exact
module instances. Providers expose typed values through runtime ports;
dependencies determine lifecycle order, while references are available only
during `run` and do not participate in the dependency graph. Rust exposes the
equivalent model through `ModuleHandle`, `Port`, `Provider`, `Dependency`, and
`Reference`.

The Rust runtime can be used like this:

```rust
use microde_application::{MicrodeApplication, MicrodeError, MicrodeModule, ModuleFuture, ModuleKind};

struct Greeting;

impl MicrodeModule for Greeting {
    const KIND: ModuleKind = ModuleKind::Passive;

    fn run(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }
}

#[tokio::main]
async fn main() -> Result<(), MicrodeError> {
    let mut service = MicrodeApplication::new();
    service.install(|_| Greeting)?;
    service.serve().await?;
    Ok(())
}
```

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
