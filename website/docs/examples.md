---
title: Examples
---

# Examples

## A stoppable active module

An active module keeps its `run()` promise pending until `stop()` releases it:

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="language">
<TabItem value="typescript" label="TypeScript">

```ts
import {
	Microservice,
	type MicroserviceContext,
	MicroserviceModule,
	ModuleKind,
} from '@microde/microservice';

class WorkerModule extends MicroserviceModule {
	readonly kind = ModuleKind.Active;

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

process.once('SIGTERM', () => service.stop());

const result = await service.run();
process.exitCode = result.exitCode;
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
use microde_microservice::{Microservice, MicroserviceError, MicroserviceModule, ModuleFuture, ModuleKind};

struct Worker;

impl MicroserviceModule for Worker {
    const KIND: ModuleKind = ModuleKind::Active;

    fn run(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }

    fn stop(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }
}

#[tokio::main]
async fn main() -> Result<(), MicroserviceError> {
    let mut service = Microservice::new();
    service.install(|_| Worker)?;
    service.run().await?;
    Ok(())
}
```

</TabItem>
</Tabs>

Real modules can use the same shape to own an HTTP server, queue consumer, scheduler, or other resource with a start/stop boundary.
