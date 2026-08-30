import type { MicrodeContext } from '@microde/application';

import { PassiveModule } from './passive-module.js';

export class FailingInitializationModule extends PassiveModule {
	constructor(
		context: MicrodeContext,
		events: string[],
		name: string,
		private readonly failure: unknown,
	) {
		super(context, events, name);
	}

	override async initialize(): Promise<void> {
		this.record('initialize');
		throw this.failure;
	}
}
