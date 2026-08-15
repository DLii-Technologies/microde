import type { MicroserviceContext } from '@microde/microservice';
import { MicroserviceModule, ModuleKind } from '@microde/microservice';

export class ActiveModule extends MicroserviceModule {
	readonly kind = ModuleKind.Active;

	constructor(
		context: MicroserviceContext,
		events: string[],
		name?: string,
		private readonly completion: Promise<void> = Promise.resolve(),
		private readonly onRun: () => void = () => {},
		private readonly onStop: () => void = () => {},
		private readonly stopCompletion: Promise<void> = Promise.resolve(),
		private readonly onCompletion: () => void = () => {},
	) {
		super(context);
		this.events = events;
		this.name = name;
	}

	private readonly events: string[];
	private readonly name?: string;

	protected record(event: string): void {
		this.events.push(this.name ? `${this.name}:${event}` : event);
	}

	async initialize(): Promise<void> {
		this.record('initialize');
	}

	async setup(): Promise<void> {
		this.record('setup');
	}

	override async run(): Promise<void> {
		this.record('run');
		this.onRun();
		await this.completion;
		this.onCompletion();
	}

	override async stop(): Promise<void> {
		this.record('stop');
		this.onStop();
		await this.stopCompletion;
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
