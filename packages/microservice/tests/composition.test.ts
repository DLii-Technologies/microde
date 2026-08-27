import { describe, expect, expectTypeOf, it } from 'vitest';

import {
	dependency,
	concretePort,
	MicrodeApplication,
	type MicrodeContext,
	MicrodeModule,
	type ModuleHandle,
	ModuleKind,
	port,
	provide,
	provideFactory,
	reference,
	type RunContext,
	type RelationshipHandle,
	type SetupContext,
} from '@microde/microservice';

import { PassiveModule } from './fixtures/passive-module.js';

describe('module composition identity', () => {
	it('returns an opaque handle for a stable named installation', () => {
		const service = new MicrodeApplication();
		const handle = service.install(
			'worker',
			(context) => new PassiveModule(context, []),
		);

		expectTypeOf(handle).toEqualTypeOf<ModuleHandle<PassiveModule>>();
		expect(handle.id).toBe('worker');
		expect(handle).not.toBeInstanceOf(PassiveModule);
		expect(Object.keys(handle)).toEqual(['id']);
	});

	it('rejects duplicate stable IDs without evaluating the second factory', () => {
		const service = new MicrodeApplication();
		service.install('worker', (context) => new PassiveModule(context, []));
		let evaluated = false;

		expect(() =>
			service.install('worker', (context) => {
				evaluated = true;
				return new PassiveModule(context, []);
			}),
		).toThrow('Module instance ID "worker" is already installed.');
		expect(evaluated).toBe(false);
		expect(service.state).toBe(0);
	});

	it('allows multiple named instances of the same module type', () => {
		const service = new MicrodeApplication();
		const first = service.install(
			'first',
			(context) => new PassiveModule(context, []),
		);
		const second = service.install(
			'second',
			(context) => new PassiveModule(context, []),
		);

		expect(first.id).toBe('first');
		expect(second.id).toBe('second');
	});
});

describe('relationship binding and wiring', () => {
	interface Database {
		readonly name: string;
	}
	const databasePort = port<Database>('database-binding');

	class ProviderModule extends MicrodeModule {
		readonly kind = ModuleKind.Passive;
		readonly providers;

		constructor(context: MicrodeContext, name: string) {
			super(context);
			this.providers = [provide(databasePort, { name })];
		}
	}

	class ConsumerModule extends MicrodeModule {
		readonly kind = ModuleKind.Passive;
		readonly database = dependency('database', databasePort);
		override readonly relationships = [this.database];

		constructor(
			context: MicrodeContext,
			private readonly events: string[],
		) {
			super(context);
		}

		override async initialize(): Promise<void> {
			this.events.push('consumer');
		}
	}

	class ReferenceConsumerModule extends MicrodeModule {
		readonly kind = ModuleKind.Passive;
		readonly database = reference('database', databasePort);
		override readonly relationships = [this.database];
	}

	class AccessModule extends MicrodeModule {
		readonly kind = ModuleKind.Passive;
		readonly database = dependency('database', databasePort);
		readonly peer = reference('peer', databasePort);
		override readonly relationships = [this.database, this.peer];

		constructor(
			context: MicrodeContext,
			private readonly values: string[],
		) {
			super(context);
		}

		override async setup(context: SetupContext): Promise<void> {
			this.values.push(`setup:${context.use(this.database).name}`);
		}

		override async run(context: RunContext): Promise<void> {
			this.values.push(`run:${context.use(this.database).name}`);
			this.values.push(`reference:${context.use(this.peer).name}`);
		}
	}

	it('binds an exact provider and applies dependency-first lifecycle order', async () => {
		const events: string[] = [];
		const service = new MicrodeApplication();
		const consumer = service.install(
			'consumer',
			(context) => new ConsumerModule(context, events),
		);
		const provider = service.install(
			'provider',
			(context) =>
				new (class extends ProviderModule {
					override async initialize(): Promise<void> {
						events.push('provider');
					}
				})(context, 'primary'),
		);
		service.bind(consumer, 'database', provider);

		await expect(service.serve()).resolves.toEqual({ exitCode: 0 });
		expect(events).toEqual(['provider', 'consumer']);
	});

	it('rejects duplicate, unknown, incompatible, and foreign bindings', () => {
		const service = new MicrodeApplication();
		const consumer = service.install(
			'consumer',
			(context) => new ConsumerModule(context, []),
		);
		const provider = service.install(
			'provider',
			(context) => new ProviderModule(context, 'primary'),
		);
		service.bind(consumer, 'database', provider);
		expect(() => service.bind(consumer, 'database', provider)).toThrow(
			'Relationship "consumer.database" is already bound.',
		);
		expect(() => service.bind(consumer, 'missing', provider)).toThrow(
			'Unknown relationship "consumer.missing".',
		);

		const empty = service.install(
			'empty',
			(context) =>
				new (class extends MicrodeModule {
					readonly kind = ModuleKind.Passive;
				})(context),
		);
		const second = new MicrodeApplication();
		const foreign = second.install(
			'provider',
			(context) => new ProviderModule(context, 'foreign'),
		);
		expect(() => service.bind(consumer, 'database', foreign)).toThrow(
			'Module handle "provider" belongs to another application.',
		);

		const another = service.install(
			'another',
			(context) => new ConsumerModule(context, []),
		);
		expect(() => service.bind(another, 'database', empty)).toThrow(
			'Module "empty" does not provide port "database-binding".',
		);
	});

	it('rejects missing bindings atomically before lifecycle starts', async () => {
		const events: string[] = [];
		const service = new MicrodeApplication();
		service.install(
			'consumer',
			(context) => new ConsumerModule(context, events),
		);

		await expect(service.serve()).rejects.toThrow(
			'Missing binding for relationship "consumer.database".',
		);
		expect(events).toEqual([]);
	});

	it('seals binding mutations when lifecycle execution starts', async () => {
		const service = new MicrodeApplication();
		const provider = service.install(
			'provider',
			(context) => new ProviderModule(context, 'primary'),
		);
		await service.serve();
		expect(() => service.bind(provider, 'anything', provider)).toThrow(
			'Cannot bind relationships after composition is sealed.',
		);
	});

	it('wires references without adding dependency graph edges', async () => {
		const service = new MicrodeApplication();
		const consumer = service.install(
			'a-consumer',
			(context) => new ReferenceConsumerModule(context),
		);
		const provider = service.install(
			'z-provider',
			(context) => new ProviderModule(context, 'primary'),
		);
		service.bind(consumer, 'database', provider);
		await expect(service.serve()).resolves.toEqual({ exitCode: 0 });
	});

	it('exposes dependencies in setup and both relationship kinds in run', async () => {
		const values: string[] = [];
		const service = new MicrodeApplication();
		const consumer = service.install(
			'consumer',
			(context) => new AccessModule(context, values),
		);
		const provider = service.install(
			'provider',
			(context) => new ProviderModule(context, 'primary'),
		);
		service.bind(consumer, 'database', provider);
		service.bind(consumer, 'peer', provider);

		await expect(service.serve()).resolves.toEqual({ exitCode: 0 });
		expect(values).toEqual([
			'setup:primary',
			'run:primary',
			'reference:primary',
		]);
	});

	it('rejects reference access during setup at runtime when types are bypassed', async () => {
		class InvalidSetupModule extends AccessModule {
			override async setup(context: SetupContext): Promise<void> {
				context.use(this.peer as never);
			}
		}
		const service = new MicrodeApplication();
		const consumer = service.install(
			'consumer',
			(context) => new InvalidSetupModule(context, []),
		);
		const provider = service.install(
			'provider',
			(context) => new ProviderModule(context, 'primary'),
		);
		service.bind(consumer, 'database', provider);
		service.bind(consumer, 'peer', provider);

		const result = await service.serve();
		expect(result.error).toEqual(
			new Error(
				'Relationship "consumer.peer" is not available during setup.',
			),
		);
	});

	it('rejects relationship slots owned by another module', async () => {
		const victimSlot = dependency('victim-database', databasePort);
		class VictimModule extends MicrodeModule {
			readonly kind = ModuleKind.Passive;
			override readonly relationships = [victimSlot];
		}
		class IntruderModule extends ConsumerModule {
			override async setup(context: SetupContext): Promise<void> {
				context.use(victimSlot);
			}
		}
		const service = new MicrodeApplication();
		const victim = service.install(
			'victim',
			(context) => new VictimModule(context),
		);
		const intruder = service.install(
			'intruder',
			(context) => new IntruderModule(context, []),
		);
		const provider = service.install(
			'provider',
			(context) => new ProviderModule(context, 'primary'),
		);
		service.bind(victim, 'victim-database', provider);
		service.bind(intruder, 'database', provider);

		const result = await service.serve();
		expect(result.error).toEqual(
			new Error(
				'Relationship "intruder.victim-database" is not resolved for this module.',
			),
		);
	});

	it('rejects dependency cycles while allowing reference cycles', async () => {
		const cyclePort = port<string>('cycle');
		class GraphModule extends MicrodeModule {
			readonly kind = ModuleKind.Passive;
			override readonly providers;
			constructor(
				context: MicrodeContext,
				override readonly relationships: readonly RelationshipHandle[],
				value: string,
			) {
				super(context);
				this.providers = [provide(cyclePort, value)];
			}
		}

		const aDependency = dependency('peer', cyclePort);
		const bDependency = dependency('peer', cyclePort);
		const cyclic = new MicrodeApplication();
		const a = cyclic.install('a', (context) => {
			return new GraphModule(context, [aDependency], 'a');
		});
		const b = cyclic.install('b', (context) => {
			return new GraphModule(context, [bDependency], 'b');
		});
		cyclic.bind(a, 'peer', b);
		cyclic.bind(b, 'peer', a);
		await expect(cyclic.serve()).rejects.toThrow(
			'Dependency cycle detected: a -> b -> a.',
		);

		const aReference = reference('peer', cyclePort);
		const bReference = reference('peer', cyclePort);
		const referenced = new MicrodeApplication();
		const referenceA = referenced.install('a', (context) => {
			return new GraphModule(context, [aReference], 'a');
		});
		const referenceB = referenced.install('b', (context) => {
			return new GraphModule(context, [bReference], 'b');
		});
		referenced.bind(referenceA, 'peer', referenceB);
		referenced.bind(referenceB, 'peer', referenceA);
		await expect(referenced.serve()).resolves.toEqual({ exitCode: 0 });
	});

	it('keeps provider creation atomic and permanently seals composition', async () => {
		const events: string[] = [];
		class FactoryProvider extends MicrodeModule {
			readonly kind = ModuleKind.Passive;
			override readonly providers = [
				provideFactory(databasePort, () => {
					events.push('create');
					throw new Error('provider creation failed');
				}),
			];
		}
		const service = new MicrodeApplication();
		const consumer = service.install(
			'consumer',
			(context) => new ConsumerModule(context, events),
		);
		const provider = service.install(
			'provider',
			(context) => new FactoryProvider(context),
		);
		service.bind(consumer, 'database', provider);

		await expect(service.serve()).rejects.toThrow(
			'provider creation failed',
		);
		expect(events).toEqual(['create']);
		expect(() => service.bind(consumer, 'database', provider)).toThrow(
			'Cannot bind relationships after composition is sealed.',
		);
		expect(() =>
			service.install(
				'late',
				(context) => new ProviderModule(context, 'late'),
			),
		).toThrow('Cannot install module after composition is sealed.');
		await expect(service.serve()).rejects.toThrow(
			'Cannot start application more than once. Composition is sealed.',
		);
	});

	it('validates concrete-module requirements without exposing module objects', async () => {
		const concreteDatabase = concretePort<ProviderModule, Database>(
			ProviderModule,
			'concrete-database',
		);
		class ConcreteConsumer extends MicrodeModule {
			readonly kind = ModuleKind.Passive;
			readonly database = dependency('database', concreteDatabase);
			override readonly relationships = [this.database];
		}
		class Impostor extends MicrodeModule {
			readonly kind = ModuleKind.Passive;
			override readonly providers = [
				provide(concreteDatabase, { name: 'impostor' }),
			];
		}

		const valid = new MicrodeApplication();
		const consumer = valid.install(
			'consumer',
			(context) => new ConcreteConsumer(context),
		);
		const provider = valid.install('provider', (context) => {
			const module = new ProviderModule(context, 'primary');
			Reflect.set(module, 'providers', [
				provide(concreteDatabase, { name: 'primary' }),
			]);
			return module;
		});
		valid.bind(consumer, 'database', provider);
		await expect(valid.serve()).resolves.toEqual({ exitCode: 0 });

		const invalid = new MicrodeApplication();
		const invalidConsumer = invalid.install(
			'consumer',
			(context) => new ConcreteConsumer(context),
		);
		const impostor = invalid.install(
			'impostor',
			(context) => new Impostor(context),
		);
		expect(() =>
			invalid.bind(invalidConsumer, 'database', impostor),
		).toThrow(
			'Module "impostor" does not satisfy concrete module requirement "ProviderModule".',
		);
	});
});

describe('relationship declarations', () => {
	it('creates independent dependency and reference slots for runtime ports', () => {
		interface Database {
			query(): void;
		}
		const database = port<Database>('database');
		const first = dependency('database', database);
		const second = dependency('database', database);
		const peer = reference('peer', database);

		expect(first).not.toBe(second);
		expect(first).toMatchObject({
			name: 'database',
			kind: 'dependency',
			port: database,
		});
		expect(peer).toMatchObject({
			name: 'peer',
			kind: 'reference',
			port: database,
		});
		expect(database.description).toBe('database');
	});
});
