import { Microservice, MicroserviceModule } from '@microde/microservice';

export class PassiveModule extends MicroserviceModule {
	constructor(
		microservice: Microservice,
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

	run(): Promise<void> | undefined {
		this.record('run');
		return undefined;
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
