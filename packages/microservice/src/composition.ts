import type { MicrodeModule } from './microde-module.js';

declare const moduleType: unique symbol;
const owners = new WeakMap<object, object>();

/** Stable identity of one installed module instance. */
export type ModuleInstanceId = string;

/** Opaque binding target for one installed module instance. */
export interface ModuleHandle<Module extends MicrodeModule> {
	readonly id: ModuleInstanceId;
	readonly [moduleType]: Module;
}

export function createModuleHandle<Module extends MicrodeModule>(
	id: ModuleInstanceId,
	owner: object,
): ModuleHandle<Module> {
	const handle = Object.freeze({ id }) as ModuleHandle<Module>;
	owners.set(handle, owner);
	return handle;
}

export function isModuleHandleOwnedBy(
	handle: ModuleHandle<MicrodeModule>,
	owner: object,
): boolean {
	return owners.get(handle) === owner;
}
