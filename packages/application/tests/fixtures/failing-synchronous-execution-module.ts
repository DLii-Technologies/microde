import type { MicrodeContext } from '@microde/application';

import { PassiveModule } from './passive-module.js';

export class FailingSynchronousExecutionModule extends PassiveModule {
	constructor(
		context: MicrodeContext,
		events: string[],
		name: string,
		private readonly failure: Error,
	) {
		super(context, events, name);
	}

	override run(): Promise<void> {
		this.record('run');
		throw this.failure;
	}
}
