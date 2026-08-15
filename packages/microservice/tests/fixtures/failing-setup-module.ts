import type { MicroserviceContext } from '@microde/microservice';

import { PassiveModule } from './passive-module.js';

export class FailingSetupModule extends PassiveModule {
	constructor(
		microservice: MicroserviceContext,
		events: string[],
		name: string,
		private readonly failure: Error,
	) {
		super(microservice, events, name);
	}

	override async setup(): Promise<void> {
		this.record('setup');
		throw this.failure;
	}
}
