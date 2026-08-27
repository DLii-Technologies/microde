/**
 * Operations exposed by a Microde application to its installed modules.
 *
 * Depending on this contract keeps modules independent of the concrete
 * application lifecycle coordinator.
 */
export interface MicrodeStopRequest {
	readonly exitCode?: number;
	readonly error?: unknown;
}

export interface MicrodeContext {
	/** Terminates the process immediately, optionally logging a fatal error. */
	panic(error?: unknown): never;

	/** Requests an orderly stop without waiting for lifecycle completion. */
	requestStop(request?: MicrodeStopRequest): void;
}
