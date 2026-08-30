import type { ModuleInstanceId } from './composition.js';

/** Internal dependency-only DAG with stable traversal and diagnostics. */
export class DependencyGraph {
	private readonly dependencies = new Map<
		ModuleInstanceId,
		Set<ModuleInstanceId>
	>();

	constructor(ids: readonly ModuleInstanceId[]) {
		for (const id of ids) this.dependencies.set(id, new Set());
	}

	addDependency(
		consumer: ModuleInstanceId,
		dependency: ModuleInstanceId,
	): void {
		const dependencies = this.dependencies.get(consumer);
		if (!dependencies) this.unknown(consumer);
		if (!this.dependencies.has(dependency)) this.unknown(dependency);
		dependencies.add(dependency);
	}

	order(): ModuleInstanceId[] {
		const ordered: ModuleInstanceId[] = [];
		const completed = new Set<ModuleInstanceId>();
		const active: ModuleInstanceId[] = [];
		const visit = (id: ModuleInstanceId): void => {
			if (completed.has(id)) return;
			const cycleStart = active.indexOf(id);
			if (cycleStart >= 0) {
				const cycle = [...active.slice(cycleStart), id];
				throw new Error(
					`Dependency cycle detected: ${cycle.join(' -> ')}.`,
				);
			}
			active.push(id);
			for (const dependency of [...this.dependencies.get(id)!].sort()) {
				visit(dependency);
			}
			active.pop();
			completed.add(id);
			ordered.push(id);
		};

		for (const id of [...this.dependencies.keys()].sort()) visit(id);
		return ordered;
	}

	private unknown(id: ModuleInstanceId): never {
		throw new Error(`Unknown module instance ID "${id}".`);
	}
}
