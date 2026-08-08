import type { Microservice } from '@microde/microservice';

import { PassiveModule } from './passive-module.js';

export class FailingExecutionModule extends PassiveModule {
	constructor(
		microservice: Microservice,
		events: string[],
		name: string,
		private readonly failure: Error,
	) {
		super(microservice, events, name);
	}

	override async run(): Promise<void> {
		this.record('run');
		throw this.failure;
	}
}
