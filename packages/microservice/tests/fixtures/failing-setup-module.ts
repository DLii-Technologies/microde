import type { MicrodeContext } from '@microde/microservice';

import { PassiveModule } from './passive-module.js';

export class FailingSetupModule extends PassiveModule {
	constructor(
		context: MicrodeContext,
		events: string[],
		name: string,
		private readonly failure: Error,
	) {
		super(context, events, name);
	}

	override async setup(): Promise<void> {
		this.record('setup');
		throw this.failure;
	}
}
