import type { MicroserviceContext } from '@microde/microservice';

import { PassiveModule } from './passive-module.js';

export class FailingInitializationModule extends PassiveModule {
	constructor(
		microservice: MicroserviceContext,
		events: string[],
		name: string,
		private readonly failure: unknown,
	) {
		super(microservice, events, name);
	}

	override async initialize(): Promise<void> {
		this.record('initialize');
		throw this.failure;
	}
}
