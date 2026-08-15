import type { MicroserviceContext } from '@microde/microservice';

import { PassiveModule } from './passive-module.js';

export class FailingExecutionModule extends PassiveModule {
	constructor(
		context: MicroserviceContext,
		events: string[],
		name: string,
		private readonly failure: Error,
	) {
		super(context, events, name);
	}

	override async run(): Promise<void> {
		this.record('run');
		throw this.failure;
	}
}
