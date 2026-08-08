import { Microservice, MicroserviceModule } from '@microde/microservice';

export class PassiveModule extends MicroserviceModule {
	constructor(
		microservice: Microservice,
		protected readonly events: string[],
	) {
		super(microservice);
	}

	async initialize(): Promise<void> {
		this.events.push('initialize');
	}

	async setup(): Promise<void> {
		this.events.push('setup');
	}

	run(): Promise<void> | undefined {
		this.events.push('run');
		return undefined;
	}

	async teardown(): Promise<void> {
		this.events.push('teardown');
	}

	async shutdown(): Promise<void> {
		this.events.push('shutdown');
	}

	async cleanup(): Promise<void> {
		this.events.push('cleanup');
	}
}
