declare const portType: unique symbol;

/** Runtime identity for a provider contract. */
export interface Port<T> {
	readonly description: string;
	readonly key: symbol;
	readonly moduleType?: Function;
	readonly [portType]: T;
}

export function concretePort<Module, T>(
	moduleType: abstract new (...args: any[]) => Module,
	description: string,
): Port<T> {
	return Object.freeze({
		description,
		key: Symbol(description),
		moduleType,
	}) as unknown as Port<T>;
}

/** Creates a nominal runtime token for a provider contract. */
export function port<T>(description: string): Port<T> {
	return Object.freeze({
		description,
		key: Symbol(description),
	}) as unknown as Port<T>;
}

export type RelationshipKind = 'dependency' | 'reference';

export interface Relationship<T, Kind extends RelationshipKind> {
	readonly name: string;
	readonly kind: Kind;
	readonly port: Port<T>;
}

export type RelationshipHandle = Relationship<unknown, RelationshipKind>;

export type Dependency<T> = Relationship<T, 'dependency'>;
export type Reference<T> = Relationship<T, 'reference'>;

export function dependency<T>(name: string, token: Port<T>): Dependency<T> {
	return Object.freeze({ name, kind: 'dependency', port: token });
}

export function reference<T>(name: string, token: Port<T>): Reference<T> {
	return Object.freeze({ name, kind: 'reference', port: token });
}
