import type { Port } from './relationship.js';

/** One owned value exported through a runtime port token. */
export interface Provider<T> {
	readonly port: Port<T>;
	resolve(): T;
}

export function provide<T>(port: Port<T>, value: T): Provider<T> {
	return Object.freeze({ port, resolve: () => value });
}

export function provideFactory<T>(
	port: Port<T>,
	factory: () => T,
): Provider<T> {
	return Object.freeze({ port, resolve: factory });
}
