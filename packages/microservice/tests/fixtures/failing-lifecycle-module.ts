import type { MicroserviceContext } from '@microde/microservice';

import { PassiveModule } from './passive-module.js';

export type FailingLifecycleStage = 'teardown' | 'shutdown' | 'cleanup';

export class FailingLifecycleModule extends PassiveModule {
	constructor(
		context: MicroserviceContext,
		events: string[],
		name: string,
		private readonly failureStage: FailingLifecycleStage,
		private readonly failure: Error,
	) {
		super(context, events, name);
	}

	override async teardown(): Promise<void> {
		this.record('teardown');
		this.throwIfFailing('teardown');
	}

	override async shutdown(): Promise<void> {
		this.record('shutdown');
		this.throwIfFailing('shutdown');
	}

	override async cleanup(): Promise<void> {
		this.record('cleanup');
		this.throwIfFailing('cleanup');
	}

	private throwIfFailing(stage: FailingLifecycleStage): void {
		if (this.failureStage === stage) {
			throw this.failure;
		}
	}
}
