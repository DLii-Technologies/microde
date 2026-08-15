import type { MicroserviceContext } from '@microde/microservice';

import { PassiveModule } from './passive-module.js';

export class FailingSynchronousExecutionModule extends PassiveModule {
	constructor(
		microservice: MicroserviceContext,
		events: string[],
		name: string,
		private readonly failure: Error,
	) {
		super(microservice, events, name);
	}

	override run(): Promise<void> {
		this.record('run');
		throw this.failure;
	}
}
