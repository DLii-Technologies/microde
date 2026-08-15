import type { MicroserviceContext } from './microservice-context.js';

/** Describes whether a module completes independently or requires a stop. */
export enum ModuleKind {
	Passive,
	Active,
}

/**
 * Defines the lifecycle shared by every module installed in a microservice.
 *
 * Lifecycle methods run in phase order. Initialization and setup run in installation
 * order, while teardown, shutdown, and cleanup run in reverse installation order.
 * Each module declares its kind and can override the default no-op `run` and `stop`.
 */
export abstract class MicroserviceModule {
	abstract readonly kind: ModuleKind;

	/** Creates a module operating within the supplied microservice context. */
	constructor(protected readonly context: MicroserviceContext) {}

	/** Acquires resources needed to configure the module. */
	async initialize(): Promise<void> {}

	/** Connects the initialized module to the rest of the service. */
	async setup(): Promise<void> {}

	/** Performs the module's work. Does nothing by default. */
	async run(): Promise<void> {}

	/** Requests that the module finish or release its running work. Does nothing by default. */
	async stop(): Promise<void> {}

	/** Reverses work performed during setup. */
	async teardown(): Promise<void> {}

	/** Releases resources acquired during initialization. */
	async shutdown(): Promise<void> {}

	/** Performs final cleanup, including when an earlier lifecycle phase failed. */
	async cleanup(): Promise<void> {}
}
