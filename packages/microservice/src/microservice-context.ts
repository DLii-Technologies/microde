/**
 * Operations exposed by a microservice to its installed modules.
 *
 * Depending on this contract keeps modules independent of the concrete
 * microservice lifecycle coordinator.
 */
export interface MicroserviceStopRequest {
	readonly exitCode?: number;
	readonly error?: unknown;
}

export interface MicroserviceContext {
	/** Terminates the process immediately, optionally logging a fatal error. */
	panic(error?: unknown): never;

	/** Requests an orderly stop without waiting for lifecycle completion. */
	requestStop(request?: MicroserviceStopRequest): void;
}
