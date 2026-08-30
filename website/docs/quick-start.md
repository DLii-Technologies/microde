---
sidebar_position: 3
title: Quick start
---

# Quick start

Create a passive module for a finite task, install it, and run the service:

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="language">
<TabItem value="typescript" label="TypeScript">

```ts
import {
	MicrodeApplication,
	type MicrodeContext,
	MicrodeModule,
	ModuleKind,
	port,
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
process.exitCode = result.exitCode;
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
use microde_application::{MicrodeApplication, MicrodeError, MicrodeModule, ModuleFuture, ModuleKind};

struct Greeting;

impl MicrodeModule for Greeting {
    const KIND: ModuleKind = ModuleKind::Passive;

    fn run(&mut self) -> ModuleFuture {
        Box::pin(async {
            println!("Hello from Microde");
            Ok(())
        })
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

</TabItem>
</Tabs>

`serve()` resolves only after the lifecycle has finished, including teardown, shutdown, and cleanup. Lifecycle failures are returned in the result rather than thrown from the returned promise:

<Tabs groupId="language">
<TabItem value="typescript" label="TypeScript">

```ts
const result = await service.serve();

if (result.error !== undefined) {
	console.error(result.error);
}

process.exitCode = result.exitCode;
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let result = service.serve().await?;

if let Some(error) = result.error {
    eprintln!("{error}");
}

std::process::exit(result.exit_code);
```

</TabItem>
</Tabs>

## Running an application task

Use `run(main)` when the application has a finite main task. Modules start first,
and completion or failure of the task begins orderly shutdown.

<Tabs groupId="language">
<TabItem value="typescript" label="TypeScript">

```ts
const result = await service.run(async (context) => {
	await performWork();
});
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let result = service.run(|context| async move {
    perform_work().await?;
    Ok(())
}).await?;
```

</TabItem>
</Tabs>

An individual `MicrodeApplication` can execute only once. Install every module before calling `serve()` or `run(main)`.

Module constructors should accept `MicrodeContext`, not the concrete `MicrodeApplication` class. The context exposes non-blocking `requestStop()` and `panic()` operations without coupling the module to lifecycle coordination APIs such as `install()`, `serve()`, `run()`, public `stop()`, or `state`.

## Named dependencies

Install named instances and bind relationship slots explicitly before starting
the application:

<Tabs groupId="language">
<TabItem value="typescript" label="TypeScript">

```ts
const databasePort = port<Database>('database');
const database = service.install(
	'database',
	(context) => new DatabaseModule(context),
);
const orders = service.install(
	'orders',
	(context) => new OrdersModule(context, databasePort),
);
service.bind(orders, 'database', database);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let database_port = Port::<Database>::new("database");
let database = service.install_named("database", |_| DatabaseModule::new())?;
let orders = service.install_named("orders", |_| OrdersModule::new())?;
let database_slot = Dependency::new("database", database_port);
service.bind(&orders, &database_slot, &database)?;
```

</TabItem>
</Tabs>

Microde validates all bindings, rejects dependency cycles, and publishes
provider resolutions atomically when execution begins. References may be cyclic,
but they are not part of lifecycle ordering and cannot be read during `setup`.
