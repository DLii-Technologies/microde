import { describe, expect, it } from 'vitest';

import {
	dependency,
	MicrodeApplication,
	type MicrodeContext,
	MicrodeModule,
	ModuleKind,
	type ModuleHandle,
	port,
	provide,
	reference,
	type RelationshipHandle,
} from '@microde/microservice';

const fixturePort = port<string>('fixture');

class FixtureModule extends MicrodeModule {
	readonly kind = ModuleKind.Passive;
	override readonly providers;

	constructor(
		context: MicrodeContext,
		private readonly name: string,
		private readonly events: string[],
		override readonly relationships: readonly RelationshipHandle[],
		private readonly failSetup = false,
	) {
		super(context);
		this.providers = [provide(fixturePort, name)];
	}

	private record(phase: string): void {
		this.events.push(`${phase}:${this.name}`);
	}
	override async initialize(): Promise<void> {
		this.record('initialize');
	}
	override async setup(): Promise<void> {
		this.record('setup');
		if (this.failSetup) throw new Error(`setup:${this.name}`);
	}
	override async run(): Promise<void> {
		this.record('run');
	}
	override async stop(): Promise<void> {
		this.record('stop');
	}
	override async teardown(): Promise<void> {
		this.record('teardown');
	}
	override async shutdown(): Promise<void> {
		this.record('shutdown');
	}
	override async cleanup(): Promise<void> {
		this.record('cleanup');
	}
}

type Edge = readonly [consumer: string, target: string, kind?: 'reference'];

async function trace(
	names: readonly string[],
	edges: readonly Edge[],
	permutation: readonly string[],
	failSetup?: string,
): Promise<{ events: string[]; error?: unknown }> {
	const events: string[] = [];
	const service = new MicrodeApplication();
	const slots = new Map<string, RelationshipHandle[]>();
	for (const [consumer, target, kind] of edges) {
		const slot =
			kind === 'reference'
				? reference(`to-${target}`, fixturePort)
				: dependency(`to-${target}`, fixturePort);
		const existing = slots.get(consumer) ?? [];
		existing.push(slot);
		slots.set(consumer, existing);
	}
	const handles = new Map<string, ModuleHandle<FixtureModule>>();
	for (const name of permutation) {
		const handle = service.install(
			name,
			(context) =>
				new FixtureModule(
					context,
					name,
					events,
					slots.get(name) ?? [],
					name === failSetup,
				),
		);
		handles.set(name, handle);
	}
	for (const [consumer, target] of edges) {
		service.bind(
			handles.get(consumer)!,
			`to-${target}`,
			handles.get(target)!,
		);
	}
	const result = await service.serve();
	expect(new Set(permutation)).toEqual(new Set(names));
	return { events, error: result.error };
}

function successfulTrace(order: readonly string[]): string[] {
	const reverse = [...order].reverse();
	return [
		...order.map((name) => `initialize:${name}`),
		...order.map((name) => `setup:${name}`),
		...order.map((name) => `run:${name}`),
		...reverse.map((name) => `stop:${name}`),
		...reverse.map((name) => `teardown:${name}`),
		...reverse.map((name) => `shutdown:${name}`),
		...reverse.map((name) => `cleanup:${name}`),
	];
}

describe('dependency lifecycle fixtures', () => {
	const fixtures = [
		{
			names: ['a', 'b', 'c'],
			edges: [
				['a', 'b'],
				['b', 'c'],
			] as Edge[],
			order: ['c', 'b', 'a'],
		},
		{
			names: ['a', 'b', 'c'],
			edges: [
				['a', 'c'],
				['b', 'c'],
			] as Edge[],
			order: ['c', 'a', 'b'],
		},
		{
			names: ['a', 'b', 'c', 'd'],
			edges: [
				['a', 'b'],
				['a', 'c'],
				['b', 'd'],
				['c', 'd'],
			] as Edge[],
			order: ['d', 'b', 'c', 'a'],
		},
		{
			names: ['a', 'b', 'c'],
			edges: [
				['a', 'b'],
				['a', 'c', 'reference'],
				['c', 'a', 'reference'],
			] as Edge[],
			order: ['b', 'a', 'c'],
		},
		{
			names: ['orders', 'reports', 'primary', 'analytics'],
			edges: [
				['orders', 'primary'],
				['reports', 'analytics'],
			] as Edge[],
			order: ['analytics', 'primary', 'orders', 'reports'],
		},
	];

	for (const fixture of fixtures) {
		it(`is installation-order independent for ${fixture.names.join('-')}`, async () => {
			const forward = await trace(
				fixture.names,
				fixture.edges,
				fixture.names,
			);
			const reversed = await trace(
				fixture.names,
				fixture.edges,
				[...fixture.names].reverse(),
			);
			expect(forward.events).toEqual(successfulTrace(fixture.order));
			expect(reversed.events).toEqual(forward.events);
		});
	}

	it('unwinds a failed middle dependency by graph stage and reverse order', async () => {
		const result = await trace(
			['a', 'b', 'c'],
			[
				['a', 'b'],
				['b', 'c'],
			],
			['a', 'c', 'b'],
			'b',
		);
		expect(result.error).toEqual(new Error('setup:b'));
		expect(result.events).toEqual([
			'initialize:c',
			'initialize:b',
			'initialize:a',
			'setup:c',
			'setup:b',
			'teardown:b',
			'teardown:c',
			'shutdown:a',
			'shutdown:b',
			'shutdown:c',
			'cleanup:a',
			'cleanup:b',
			'cleanup:c',
		]);
	});
});
