import { describe, expect, it } from 'vitest';

import { DependencyGraph } from '../src/dependency-graph.js';

describe('DependencyGraph', () => {
	it('orders an empty graph and unrelated modules deterministically', () => {
		expect(new DependencyGraph([]).order()).toEqual([]);
		expect(new DependencyGraph(['z', 'a', 'm']).order()).toEqual([
			'a',
			'm',
			'z',
		]);
	});

	it('orders chains, branches, and diamonds dependency-first', () => {
		const graph = new DependencyGraph(['a', 'b', 'c', 'd']);
		graph.addDependency('a', 'b');
		graph.addDependency('a', 'c');
		graph.addDependency('b', 'd');
		graph.addDependency('c', 'd');

		expect(graph.order()).toEqual(['d', 'b', 'c', 'a']);
	});

	it('rejects unknown nodes and deterministic dependency cycles', () => {
		const graph = new DependencyGraph(['a', 'b', 'c']);
		expect(() => graph.addDependency('missing', 'a')).toThrow(
			'Unknown module instance ID "missing".',
		);
		expect(() => graph.addDependency('a', 'missing')).toThrow(
			'Unknown module instance ID "missing".',
		);
		graph.addDependency('a', 'b');
		graph.addDependency('b', 'c');
		graph.addDependency('c', 'a');

		expect(() => graph.order()).toThrow(
			'Dependency cycle detected: a -> b -> c -> a.',
		);
	});

	it('rejects self dependencies', () => {
		const graph = new DependencyGraph(['worker']);
		graph.addDependency('worker', 'worker');
		expect(() => graph.order()).toThrow(
			'Dependency cycle detected: worker -> worker.',
		);
	});
});
