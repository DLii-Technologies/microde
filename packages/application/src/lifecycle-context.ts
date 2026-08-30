import type { ModuleInstanceId } from './composition.js';
import type {
	Dependency,
	Reference,
	RelationshipHandle,
} from './relationship.js';

export interface ResolvedRelationship {
	readonly owner: ModuleInstanceId;
	readonly value: unknown;
}

export interface SetupContext {
	use<T>(relationship: Dependency<T>): T;
}

export interface RunContext {
	use<T>(relationship: Dependency<T> | Reference<T>): T;
}

class DefaultLifecycleContext {
	constructor(
		private readonly owner: ModuleInstanceId,
		private readonly phase: 'setup' | 'run',
		private readonly resolutions: ReadonlyMap<
			RelationshipHandle,
			ResolvedRelationship
		>,
	) {}

	use<T>(relationship: Dependency<T> | Reference<T>): T {
		const resolved = this.resolutions.get(
			relationship as RelationshipHandle,
		);
		if (!resolved || resolved.owner !== this.owner) {
			throw new Error(
				`Relationship "${this.owner}.${relationship.name}" is not resolved for this module.`,
			);
		}
		if (this.phase === 'setup' && relationship.kind === 'reference') {
			throw new Error(
				`Relationship "${this.owner}.${relationship.name}" is not available during setup.`,
			);
		}
		return resolved.value as T;
	}
}

export function createSetupContext(
	owner: ModuleInstanceId,
	resolutions: ReadonlyMap<RelationshipHandle, ResolvedRelationship>,
): SetupContext {
	return new DefaultLifecycleContext(owner, 'setup', resolutions);
}

export function createRunContext(
	owner: ModuleInstanceId,
	resolutions: ReadonlyMap<RelationshipHandle, ResolvedRelationship>,
): RunContext {
	return new DefaultLifecycleContext(owner, 'run', resolutions);
}
