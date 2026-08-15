import {
	type MicroserviceContext,
	PassiveMicroserviceModule,
} from '@microde/microservice';

export class PassiveModule extends PassiveMicroserviceModule {
	constructor(
		microservice: MicroserviceContext,
		protected readonly events: string[],
		protected readonly name?: string,
	) {
		super(microservice);
	}

	protected record(event: string): void {
		this.events.push(this.name ? `${this.name}:${event}` : event);
	}

	async initialize(): Promise<void> {
		this.record('initialize');
	}

	async setup(): Promise<void> {
		this.record('setup');
	}

	async run(): Promise<void> {
		this.record('run');
	}

	async teardown(): Promise<void> {
		this.record('teardown');
	}

	async shutdown(): Promise<void> {
		this.record('shutdown');
	}

	async cleanup(): Promise<void> {
		this.record('cleanup');
	}
}
