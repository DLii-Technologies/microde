import type { MicrodeContext } from './microde-context.js';
import type { Provider } from './provider.js';
import type { RelationshipHandle } from './relationship.js';
import type { RunContext, SetupContext } from './lifecycle-context.js';

/** Describes whether a module completes independently or requires a stop. */
export enum ModuleKind {
	Passive,
	Active,
}

/**
 * Defines the lifecycle shared by every module installed in a Microde application.
 *
 * Lifecycle methods run in phase order. Initialization and setup run in installation
 * order, while teardown, shutdown, and cleanup run in reverse installation order.
 * Each module declares its kind and can override the default no-op `run` and `stop`.
 */
export abstract class MicrodeModule {
	abstract readonly kind: ModuleKind;
	/** Relationship slots declared by this module instance. */
	readonly relationships: readonly RelationshipHandle[] = [];
	/** Owned contract values exported by this module instance. */
	readonly providers: readonly Provider<unknown>[] = [];

	/** Creates a module operating within the supplied application context. */
	constructor(protected readonly context: MicrodeContext) {}

	/** Acquires resources needed to configure the module. */
	async initialize(): Promise<void> {}

	/** Connects the initialized module to the rest of the service. */
	async setup(_context: SetupContext): Promise<void> {}

	/** Performs the module's work. Does nothing by default. */
	async run(_context: RunContext): Promise<void> {}

	/** Requests that the module finish or release its running work. Does nothing by default. */
	async stop(): Promise<void> {}

	/** Reverses work performed during setup. */
	async teardown(): Promise<void> {}

	/** Releases resources acquired during initialization. */
	async shutdown(): Promise<void> {}

	/** Performs final cleanup, including when an earlier lifecycle phase failed. */
	async cleanup(): Promise<void> {}
}
