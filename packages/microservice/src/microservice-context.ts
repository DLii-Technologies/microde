import type { MicroserviceExecutionResult } from './microservice.js';

/**
 * Operations exposed by a microservice to its installed modules.
 *
 * Depending on this contract keeps modules independent of the concrete
 * microservice lifecycle coordinator.
 */
export interface MicroserviceContext {
	/** Terminates the process immediately, optionally logging a fatal error. */
	panic(error?: unknown): never;

	/** Requests an orderly stop and resolves with the execution result. */
	stop(): Promise<MicroserviceExecutionResult>;
	/** Requests an orderly stop with a specific exit code. */
	stop(exitCode: number): Promise<MicroserviceExecutionResult>;
	/** Requests an orderly stop caused by an error. */
	stop(error: unknown): Promise<MicroserviceExecutionResult>;
	/** Requests an orderly stop with both an exit code and error. */
	stop(
		exitCode: number,
		error: unknown,
	): Promise<MicroserviceExecutionResult>;
}
