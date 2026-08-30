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
	MicrodeApplication,
	type MicrodeContext,
	MicrodeModule,
	ModuleKind,
} from '@microde/application';

class WorkerModule extends MicrodeModule {
	readonly kind = ModuleKind.Active;

	private finish!: () => void;
	private readonly completion = new Promise<void>((resolve) => {
		this.finish = resolve;
	});

	constructor(context: MicrodeContext) {
		super(context);
	}

	async run(): Promise<void> {
		return this.completion;
	}

	async stop(): Promise<void> {
		this.finish();
	}
}

const service = new MicrodeApplication();
service.install((context) => new WorkerModule(context));

process.once('SIGTERM', () => service.stop());

const result = await service.serve();
process.exitCode = result.exitCode;
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
use microde_application::{MicrodeApplication, MicrodeError, MicrodeModule, ModuleFuture, ModuleKind};

struct Worker;

impl MicrodeModule for Worker {
    const KIND: ModuleKind = ModuleKind::Active;

    fn run(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }

    fn stop(&mut self) -> ModuleFuture {
        Box::pin(async { Ok(()) })
    }
}

#[tokio::main]
async fn main() -> Result<(), MicrodeError> {
    let mut service = MicrodeApplication::new();
    service.install(|_| Worker)?;
    service.serve().await?;
    Ok(())
}
```

</TabItem>
</Tabs>

Real modules can use the same shape to own an HTTP server, queue consumer, scheduler, or other resource with a start/stop boundary.
