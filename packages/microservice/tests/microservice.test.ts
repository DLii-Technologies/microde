import { describe, expect, it } from 'vitest';

import { Microservice, MicroserviceState } from '@microde/microservice';

import { PassiveModule } from './fixtures/passive-module.js';
import { ActiveModule } from './fixtures/active-module.js';
import { FailingInitializationModule } from './fixtures/failing-initialization-module.js';
import { FailingSetupModule } from './fixtures/failing-setup-module.js';
import { FailingExecutionModule } from './fixtures/failing-execution-module.js';
import { FailingSynchronousExecutionModule } from './fixtures/failing-synchronous-execution-module.js';
import { FailingLifecycleModule } from './fixtures/failing-lifecycle-module.js';

describe('Microservice', () => {
	it('runs to successful completion when no modules are installed', async () => {
		const microservice = new Microservice();

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 0,
		});
	});

	it('installs a module through a factory', () => {
		const microservice = new Microservice();

		const installedModule = microservice.install((instance) => {
			return new PassiveModule(instance, []);
		});

		expect(installedModule).toBeInstanceOf(PassiveModule);
		expect(installedModule.microservice).toBe(microservice);
	});

	it('rejects module installation after the microservice has started', async () => {
		const microservice = new Microservice();

		await microservice.run();

		expect(() => {
			microservice.install((instance) => {
				return new PassiveModule(instance, []);
			});
		}).toThrow(
			'Cannot install module after microservice has started. Current state: Finished',
		);
	});

	it('rejects concurrent runs without duplicating module lifecycles', async () => {
		const events: string[] = [];
		const microservice = new Microservice();
		microservice.install((instance) => {
			return new PassiveModule(instance, events);
		});

		const firstRun = microservice.run();

		await expect(microservice.run()).rejects.toThrow(
			'Cannot run microservice more than once. Current state: Initialization',
		);
		await expect(firstRun).resolves.toEqual({ exitCode: 0 });
		expect(events).toEqual([
			'initialize',
			'setup',
			'run',
			'teardown',
			'shutdown',
			'cleanup',
		]);
	});

	it('rejects a repeated run after completion', async () => {
		const microservice = new Microservice();

		await microservice.run();

		await expect(microservice.run()).rejects.toThrow(
			'Cannot run microservice more than once. Current state: Finished',
		);
	});

	it('exposes lifecycle state as read-only', () => {
		const microservice = new Microservice();

		expect(
			Reflect.set(microservice, 'state', MicroserviceState.Finished),
		).toBe(false);
		expect(microservice.state).toBe(MicroserviceState.Idle);
	});

	it('runs a passive module and exits cleanly', async () => {
		const events: string[] = [];

		const microservice = new Microservice();
		microservice.install((instance) => {
			return new PassiveModule(instance, events);
		});

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 0,
		});
		expect(microservice.state).toBe(MicroserviceState.Finished);
		expect(events).toEqual([
			'initialize',
			'setup',
			'run',
			'teardown',
			'shutdown',
			'cleanup',
		]);
	});

	it('runs an active module and exits cleanly', async () => {
		const events: string[] = [];

		const microservice = new Microservice();
		microservice.install((instance) => {
			return new ActiveModule(instance, events);
		});

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 0,
		});
		expect(microservice.state).toBe(MicroserviceState.Finished);
		expect(events).toEqual([
			'initialize',
			'setup',
			'run',
			'stop',
			'teardown',
			'shutdown',
			'cleanup',
		]);
	});

	it('runs modules in installation order and tears them down in reverse order', async () => {
		const events: string[] = [];
		const microservice = new Microservice();

		const install = (name: string) => {
			microservice.install((instance) => {
				events.push(`${name}:create`);
				return new PassiveModule(instance, events, name);
			});
		};

		install('first');
		install('second');

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 0,
		});
		expect(events).toEqual([
			'first:create',
			'second:create',
			'first:initialize',
			'second:initialize',
			'first:setup',
			'second:setup',
			'first:run',
			'second:run',
			'second:teardown',
			'first:teardown',
			'second:shutdown',
			'first:shutdown',
			'second:cleanup',
			'first:cleanup',
		]);
	});

	it('starts active modules in installation order without waiting for earlier modules', async () => {
		const events: string[] = [];
		let releaseFirst!: () => void;
		const firstCompletion = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const microservice = new Microservice();

		microservice.install((instance) => {
			return new ActiveModule(instance, events, 'first', firstCompletion);
		});
		microservice.install((instance) => {
			return new ActiveModule(
				instance,
				events,
				'second',
				Promise.resolve(),
				releaseFirst,
			);
		});

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 0,
		});
		expect(events).toEqual([
			'first:initialize',
			'second:initialize',
			'first:setup',
			'second:setup',
			'first:run',
			'second:run',
			'first:stop',
			'second:stop',
			'second:teardown',
			'first:teardown',
			'second:shutdown',
			'first:shutdown',
			'second:cleanup',
			'first:cleanup',
		]);
	});

	it('stops initializing modules after the first initialization error', async () => {
		const events: string[] = [];
		const failure = new Error('initialization failed');
		const microservice = new Microservice();

		microservice.install((instance) => {
			return new FailingInitializationModule(
				instance,
				events,
				'first',
				failure,
			);
		});
		microservice.install((instance) => {
			return new PassiveModule(instance, events, 'second');
		});

		const result = await microservice.run();

		expect(result.error).toBe(failure);
		expect(events).not.toContain('second:initialize');
	});

	it('skips setup, execution, and teardown after an initialization error', async () => {
		const events: string[] = [];
		const microservice = new Microservice();

		microservice.install((instance) => {
			return new FailingInitializationModule(
				instance,
				events,
				'only',
				new Error('initialization failed'),
			);
		});

		await microservice.run();

		expect(events).toEqual([
			'only:initialize',
			'only:shutdown',
			'only:cleanup',
		]);
	});

	it('shuts down modules that reached initialization and cleans up all installed modules', async () => {
		const events: string[] = [];
		const microservice = new Microservice();

		microservice.install((instance) => {
			events.push('first:create');
			return new PassiveModule(instance, events, 'first');
		});
		microservice.install((instance) => {
			events.push('second:create');
			return new FailingInitializationModule(
				instance,
				events,
				'second',
				new Error('initialization failed'),
			);
		});
		microservice.install((instance) => {
			events.push('third:create');
			return new PassiveModule(instance, events, 'third');
		});

		await microservice.run();

		expect(events).toEqual([
			'first:create',
			'second:create',
			'third:create',
			'first:initialize',
			'second:initialize',
			'second:shutdown',
			'first:shutdown',
			'third:cleanup',
			'second:cleanup',
			'first:cleanup',
		]);
	});

	it('preserves the original initialization error after cleanup completes', async () => {
		const failure = new Error('original initialization error');
		const microservice = new Microservice();

		microservice.install((instance) => {
			return new FailingInitializationModule(
				instance,
				[],
				'only',
				failure,
			);
		});

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 1,
			error: failure,
		});
		expect(microservice.state).toBe(MicroserviceState.Failed);
	});

	it('treats an undefined rejection reason as a failure', async () => {
		const microservice = new Microservice();

		microservice.install((instance) => {
			return new FailingInitializationModule(
				instance,
				[],
				'only',
				undefined,
			);
		});

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 1,
			error: undefined,
		});
		expect(microservice.state).toBe(MicroserviceState.Failed);
	});

	it('stops setup after the first setup error and unwinds reached setup stages', async () => {
		const events: string[] = [];
		const failure = new Error('setup failed');
		const microservice = new Microservice();

		microservice.install((instance) => {
			return new PassiveModule(instance, events, 'first');
		});
		microservice.install((instance) => {
			return new FailingSetupModule(instance, events, 'second', failure);
		});
		microservice.install((instance) => {
			return new PassiveModule(instance, events, 'third');
		});

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 1,
			error: failure,
		});
		expect(events).toEqual([
			'first:initialize',
			'second:initialize',
			'third:initialize',
			'first:setup',
			'second:setup',
			'second:teardown',
			'first:teardown',
			'third:shutdown',
			'second:shutdown',
			'first:shutdown',
			'third:cleanup',
			'second:cleanup',
			'first:cleanup',
		]);
		expect(microservice.state).toBe(MicroserviceState.Failed);
	});

	it('starts all modules before handling an execution error', async () => {
		const events: string[] = [];
		const failure = new Error('execution failed');
		const microservice = new Microservice();

		microservice.install((instance) => {
			return new FailingExecutionModule(
				instance,
				events,
				'first',
				failure,
			);
		});
		microservice.install((instance) => {
			return new PassiveModule(instance, events, 'second');
		});

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 1,
			error: failure,
		});
		expect(events).toEqual([
			'first:initialize',
			'second:initialize',
			'first:setup',
			'second:setup',
			'first:run',
			'second:run',
			'second:teardown',
			'first:teardown',
			'second:shutdown',
			'first:shutdown',
			'second:cleanup',
			'first:cleanup',
		]);
		expect(microservice.state).toBe(MicroserviceState.Failed);
	});

	it('starts all modules before handling a synchronous execution error', async () => {
		const events: string[] = [];
		const failure = new Error('synchronous execution failed');
		const microservice = new Microservice();

		microservice.install((instance) => {
			return new FailingSynchronousExecutionModule(
				instance,
				events,
				'first',
				failure,
			);
		});
		microservice.install((instance) => {
			return new PassiveModule(instance, events, 'second');
		});

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 1,
			error: failure,
		});
		expect(events).toContain('first:run');
		expect(events).toContain('second:run');
	});

	it('continues teardown after an error and returns the first teardown error', async () => {
		const events: string[] = [];
		const firstFailure = new Error('first teardown failed');
		const secondFailure = new Error('second teardown failed');
		const microservice = new Microservice();

		microservice.install((instance) => {
			return new FailingLifecycleModule(
				instance,
				events,
				'first',
				'teardown',
				firstFailure,
			);
		});
		microservice.install((instance) => {
			return new FailingLifecycleModule(
				instance,
				events,
				'second',
				'teardown',
				secondFailure,
			);
		});

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 1,
			error: secondFailure,
		});
		expect(events).toContain('second:teardown');
		expect(events).toContain('first:teardown');
		expect(events).toEqual([
			'first:initialize',
			'second:initialize',
			'first:setup',
			'second:setup',
			'first:run',
			'second:run',
			'second:teardown',
			'first:teardown',
			'second:shutdown',
			'first:shutdown',
			'second:cleanup',
			'first:cleanup',
		]);
	});

	it('continues shutdown after a shutdown error', async () => {
		const events: string[] = [];
		const failure = new Error('shutdown failed');
		const microservice = new Microservice();

		microservice.install((instance) => {
			return new PassiveModule(instance, events, 'first');
		});
		microservice.install((instance) => {
			return new FailingLifecycleModule(
				instance,
				events,
				'second',
				'shutdown',
				failure,
			);
		});

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 1,
			error: failure,
		});
		expect(events).toContain('first:shutdown');
		expect(events).toContain('first:cleanup');
	});

	it('continues cleanup after a cleanup error', async () => {
		const events: string[] = [];
		const failure = new Error('cleanup failed');
		const microservice = new Microservice();

		microservice.install((instance) => {
			return new PassiveModule(instance, events, 'first');
		});
		microservice.install((instance) => {
			return new FailingLifecycleModule(
				instance,
				events,
				'second',
				'cleanup',
				failure,
			);
		});

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 1,
			error: failure,
		});
		expect(events).toContain('first:cleanup');
	});

	it('preserves a primary error when teardown also fails', async () => {
		const events: string[] = [];
		const primaryFailure = new Error('execution failed');
		const teardownFailure = new Error('teardown failed');
		const microservice = new Microservice();

		microservice.install((instance) => {
			return new FailingExecutionModule(
				instance,
				events,
				'first',
				primaryFailure,
			);
		});
		microservice.install((instance) => {
			return new FailingLifecycleModule(
				instance,
				events,
				'second',
				'teardown',
				teardownFailure,
			);
		});

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 1,
			error: primaryFailure,
		});
	});

	it('does not stop when an asynchronous passive module finishes', async () => {
		let releaseActive!: () => void;
		const activeCompletion = new Promise<void>((resolve) => {
			releaseActive = resolve;
		});
		let executionFinished = false;
		const microservice = new Microservice();

		microservice.install((instance) => {
			return new PassiveModule(instance, [], 'passive');
		});
		microservice.install((instance) => {
			return new ActiveModule(instance, [], 'active', activeCompletion);
		});

		const execution = microservice.run().finally(() => {
			executionFinished = true;
		});
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		const finishedBeforeActiveCompletion = executionFinished;

		releaseActive();
		await execution;

		expect(finishedBeforeActiveCompletion).toBe(false);
	});

	it('stops active modules when a passive module fails', async () => {
		const events: string[] = [];
		const failure = new Error('passive execution failed');
		let releaseActive!: () => void;
		const activeCompletion = new Promise<void>((resolve) => {
			releaseActive = resolve;
		});
		const microservice = new Microservice();

		microservice.install((instance) => {
			return new ActiveModule(
				instance,
				events,
				'active',
				activeCompletion,
				() => {},
				releaseActive,
			);
		});
		microservice.install((instance) => {
			return new FailingExecutionModule(
				instance,
				events,
				'passive',
				failure,
			);
		});

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 1,
			error: failure,
		});
		expect(events).toContain('active:stop');
		expect(events.indexOf('passive:run')).toBeLessThan(
			events.indexOf('active:stop'),
		);
	});

	it('stops every active module and drains their runs before teardown', async () => {
		const events: string[] = [];
		let releaseSecond!: () => void;
		const secondCompletion = new Promise<void>((resolve) => {
			releaseSecond = resolve;
		});
		const microservice = new Microservice();

		microservice.install((instance) => {
			return new ActiveModule(
				instance,
				events,
				'first',
				Promise.resolve(),
				() => {},
				() => {},
				Promise.resolve(),
				() => events.push('first:completed'),
			);
		});
		microservice.install((instance) => {
			return new ActiveModule(
				instance,
				events,
				'second',
				secondCompletion,
				() => {},
				releaseSecond,
				Promise.resolve(),
				() => events.push('second:completed'),
			);
		});

		await expect(microservice.run()).resolves.toEqual({ exitCode: 0 });

		expect(events).toContain('first:stop');
		expect(events).toContain('second:stop');
		expect(events.indexOf('second:completed')).toBeLessThan(
			events.indexOf('second:teardown'),
		);
	});

	it('reports an active run that rejects while modules are stopping', async () => {
		const failure = new Error('late active failure');
		let rejectSecond!: (reason: unknown) => void;
		const secondCompletion = new Promise<void>((_resolve, reject) => {
			rejectSecond = reject;
		});
		const microservice = new Microservice();

		microservice.install((instance) => {
			return new ActiveModule(instance, [], 'first');
		});
		microservice.install((instance) => {
			return new ActiveModule(
				instance,
				[],
				'second',
				secondCompletion,
				() => {},
				() => rejectSecond(failure),
			);
		});

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 1,
			error: failure,
		});
		expect(microservice.state).toBe(MicroserviceState.Failed);
	});

	it('continues stopping active modules after a stop error', async () => {
		const events: string[] = [];
		const failure = new Error('stop failed');
		const microservice = new Microservice();

		microservice.install((instance) => {
			return new ActiveModule(
				instance,
				events,
				'first',
				Promise.resolve(),
				() => {},
				() => {
					throw failure;
				},
			);
		});
		microservice.install((instance) => {
			return new ActiveModule(instance, events, 'second');
		});

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 1,
			error: failure,
		});
		expect(events).toContain('first:stop');
		expect(events).toContain('second:stop');
	});
});
