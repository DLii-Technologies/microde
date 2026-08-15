import type { MicroserviceContext } from './microservice-context.js';

/**
 * Defines the lifecycle shared by every module installed in a microservice.
 *
 * Lifecycle methods run in phase order. Initialization and setup run in installation
 * order, while teardown, shutdown, and cleanup run in reverse installation order.
 * Extend {@link PassiveMicroserviceModule} or {@link ActiveMicroserviceModule}
 * instead of extending this class directly.
 */
export abstract class MicroserviceModule {
	/** Creates a module with access to the supplied microservice context. */
	constructor(public readonly context: MicroserviceContext) {}

	/** Acquires resources needed to configure the module. */
	async initialize(): Promise<void> {}

	/** Connects the initialized module to the rest of the service. */
	async setup(): Promise<void> {}

	/** Performs the module's work. */
	abstract run(): Promise<void>;

	/** Reverses work performed during setup. */
	async teardown(): Promise<void> {}

	/** Releases resources acquired during initialization. */
	async shutdown(): Promise<void> {}

	/** Performs final cleanup, including when an earlier lifecycle phase failed. */
	async cleanup(): Promise<void> {}
}

/**
 * A module whose `run` method completes on its own.
 *
 * A microservice containing only passive modules finishes after every module's
 * `run` promise settles.
 */
export abstract class PassiveMicroserviceModule extends MicroserviceModule {
	/** Performs no work by default. */
	async run(): Promise<void> {}
}

/**
 * A long-running module that can be asked to stop.
 *
 * When execution ends, active modules are stopped in reverse installation order.
 */
export abstract class ActiveMicroserviceModule extends MicroserviceModule {
	/** Requests that the running module finish its `run` operation. */
	abstract stop(): Promise<void>;
}
