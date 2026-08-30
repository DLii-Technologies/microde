import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
	MicrodeApplication,
	type MicrodeContext,
	MicrodeModule,
	MicrodeApplicationState,
	ModuleKind,
} from '@microde/application';

import { PassiveModule } from './fixtures/passive-module.js';
import { ActiveModule } from './fixtures/active-module.js';
import { FailingInitializationModule } from './fixtures/failing-initialization-module.js';
import { FailingSetupModule } from './fixtures/failing-setup-module.js';
import { FailingExecutionModule } from './fixtures/failing-execution-module.js';
import { FailingSynchronousExecutionModule } from './fixtures/failing-synchronous-execution-module.js';
import { FailingLifecycleModule } from './fixtures/failing-lifecycle-module.js';

describe('MicrodeApplication Execution', () => {
	it('runs to successful completion when no modules are installed', async () => {
		const application = new MicrodeApplication();

		await expect(application.serve()).resolves.toEqual({
			exitCode: 0,
		});
	});

	it('runs an application main after module setup and then shuts down', async () => {
		const application = new MicrodeApplication();
		const events: string[] = [];
		let finishRun!: () => void;
		const running = new Promise<void>((resolve) => {
			finishRun = resolve;
		});
		application.install(
			(context) =>
				new ActiveModule(
					context,
					events,
					undefined,
					running,
					() => {},
					() => finishRun(),
				),
		);

		await expect(
			application.run((context) => {
				expect(context.requestStop).toEqual(expect.any(Function));
				events.push('main');
			}),
		).resolves.toEqual({ exitCode: 0 });

		expect(events).toEqual([
			'initialize',
			'setup',
			'run',
			'main',
			'stop',
			'teardown',
			'shutdown',
			'cleanup',
		]);
	});

	it('records an application main failure and still unwinds', async () => {
		const application = new MicrodeApplication();
		const failure = new Error('main failed');

		await expect(
			application.run(() => {
				throw failure;
			}),
		).resolves.toEqual({ exitCode: 1, error: failure });
		expect(application.state).toBe(MicrodeApplicationState.Failed);
	});

	it('installs a module through a factory', () => {
		const application = new MicrodeApplication();
		let receivedContext!: MicrodeContext;

		const installedModule = application.install((instance) => {
			receivedContext = instance;
			return new PassiveModule(instance, []);
		});

		expectTypeOf(installedModule).toEqualTypeOf<PassiveModule>();
		expect(installedModule).toBeInstanceOf(PassiveModule);
		expect(receivedContext).not.toBe(application);
		expect(receivedContext.requestStop).toEqual(expect.any(Function));
		expect(receivedContext.panic).toEqual(expect.any(Function));
	});

	it('prevents starts and stops while a module is installing', async () => {
		const application = new MicrodeApplication();
		let runAttempt!: Promise<unknown>;

		application.install((context) => {
			expect(application.state).toBe(MicrodeApplicationState.Installing);
			runAttempt = application.serve();
			expect(() => application.stop()).toThrow(
				'Cannot stop application before it has started. Current state: Installing',
			);
			return new PassiveModule(context, []);
		});

		await expect(runAttempt).rejects.toThrow(
			'Cannot start application more than once. Current state: Installing',
		);
		expect(application.state).toBe(MicrodeApplicationState.Idle);
		await expect(application.serve()).resolves.toEqual({ exitCode: 0 });
	});

	it('returns to idle when a module factory fails', () => {
		const failure = new Error('installation failed');
		const application = new MicrodeApplication();

		expect(() =>
			application.install(() => {
				throw failure;
			}),
		).toThrow(failure);
		expect(application.state).toBe(MicrodeApplicationState.Idle);
	});

	it('rejects module installation after the application has started', async () => {
		const application = new MicrodeApplication();

		await application.serve();

		expect(() => {
			application.install((instance) => {
				return new PassiveModule(instance, []);
			});
		}).toThrow(
			'Cannot install module after application has started. Current state: Finished',
		);
	});

	it('rejects concurrent runs without duplicating module lifecycles', async () => {
		const events: string[] = [];
		const application = new MicrodeApplication();
		application.install((instance) => {
			return new (class extends PassiveModule {
				override async stop(): Promise<void> {
					this.record('stop');
				}
			})(instance, events);
		});

		const firstRun = application.serve();

		await expect(application.serve()).rejects.toThrow(
			'Cannot start application more than once. Current state: Initialization',
		);
		await expect(firstRun).resolves.toEqual({ exitCode: 0 });
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

	it('rejects a repeated run after completion', async () => {
		const application = new MicrodeApplication();

		await application.serve();

		await expect(application.serve()).rejects.toThrow(
			'Cannot start application more than once. Current state: Finished',
		);
	});

	it('exposes lifecycle state as read-only', () => {
		const application = new MicrodeApplication();

		expect(
			Reflect.set(application, 'state', MicrodeApplicationState.Finished),
		).toBe(false);
		expect(application.state).toBe(MicrodeApplicationState.Idle);
	});

	it('runs a passive module and exits cleanly', async () => {
		const events: string[] = [];

		const application = new MicrodeApplication();
		application.install((instance) => {
			return new PassiveModule(instance, events);
		});

		await expect(application.serve()).resolves.toEqual({
			exitCode: 0,
		});
		expect(application.state).toBe(MicrodeApplicationState.Finished);
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

		const application = new MicrodeApplication();
		application.install((instance) => {
			return new ActiveModule(instance, events);
		});

		await expect(application.serve()).resolves.toEqual({
			exitCode: 0,
		});
		expect(application.state).toBe(MicrodeApplicationState.Finished);
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

	it('classifies active modules by kind rather than class identity', async () => {
		const events: string[] = [];
		const application = new MicrodeApplication();
		application.install(
			(context) =>
				new (class extends MicrodeModule {
					readonly kind = ModuleKind.Active;

					async run(): Promise<void> {
						events.push('run');
					}

					async stop(): Promise<void> {
						events.push('stop');
					}
				})(context),
		);

		await expect(application.serve()).resolves.toEqual({ exitCode: 0 });
		expect(events).toEqual(['run', 'stop']);
	});

	it('runs modules in installation order and tears them down in reverse order', async () => {
		const events: string[] = [];
		const application = new MicrodeApplication();

		const install = (name: string) => {
			application.install((instance) => {
				events.push(`${name}:create`);
				return new PassiveModule(instance, events, name);
			});
		};

		install('first');
		install('second');

		await expect(application.serve()).resolves.toEqual({
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
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new ActiveModule(instance, events, 'first', firstCompletion);
		});
		application.install((instance) => {
			return new ActiveModule(
				instance,
				events,
				'second',
				Promise.resolve(),
				releaseFirst,
			);
		});

		await expect(application.serve()).resolves.toEqual({
			exitCode: 0,
		});
		expect(events).toEqual([
			'first:initialize',
			'second:initialize',
			'first:setup',
			'second:setup',
			'first:run',
			'second:run',
			'second:stop',
			'first:stop',
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
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new FailingInitializationModule(
				instance,
				events,
				'first',
				failure,
			);
		});
		application.install((instance) => {
			return new PassiveModule(instance, events, 'second');
		});

		const result = await application.serve();

		expect(result.error).toBe(failure);
		expect(events).not.toContain('second:initialize');
	});

	it('skips setup, execution, and teardown after an initialization error', async () => {
		const events: string[] = [];
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new FailingInitializationModule(
				instance,
				events,
				'only',
				new Error('initialization failed'),
			);
		});

		await application.serve();

		expect(events).toEqual([
			'only:initialize',
			'only:shutdown',
			'only:cleanup',
		]);
	});

	it('shuts down modules that reached initialization and cleans up all installed modules', async () => {
		const events: string[] = [];
		const application = new MicrodeApplication();

		application.install((instance) => {
			events.push('first:create');
			return new PassiveModule(instance, events, 'first');
		});
		application.install((instance) => {
			events.push('second:create');
			return new FailingInitializationModule(
				instance,
				events,
				'second',
				new Error('initialization failed'),
			);
		});
		application.install((instance) => {
			events.push('third:create');
			return new PassiveModule(instance, events, 'third');
		});

		await application.serve();

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
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new FailingInitializationModule(
				instance,
				[],
				'only',
				failure,
			);
		});

		await expect(application.serve()).resolves.toEqual({
			exitCode: 1,
			error: failure,
		});
		expect(application.state).toBe(MicrodeApplicationState.Failed);
	});

	it('treats an undefined rejection reason as a failure', async () => {
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new FailingInitializationModule(
				instance,
				[],
				'only',
				undefined,
			);
		});

		await expect(application.serve()).resolves.toEqual({
			exitCode: 1,
			error: undefined,
		});
		expect(application.state).toBe(MicrodeApplicationState.Failed);
	});

	it('stops setup after the first setup error and unwinds reached setup stages', async () => {
		const events: string[] = [];
		const failure = new Error('setup failed');
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new PassiveModule(instance, events, 'first');
		});
		application.install((instance) => {
			return new FailingSetupModule(instance, events, 'second', failure);
		});
		application.install((instance) => {
			return new PassiveModule(instance, events, 'third');
		});

		await expect(application.serve()).resolves.toEqual({
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
		expect(application.state).toBe(MicrodeApplicationState.Failed);
	});

	it('starts all modules before handling an execution error', async () => {
		const events: string[] = [];
		const failure = new Error('execution failed');
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new FailingExecutionModule(
				instance,
				events,
				'first',
				failure,
			);
		});
		application.install((instance) => {
			return new PassiveModule(instance, events, 'second');
		});

		await expect(application.serve()).resolves.toEqual({
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
		expect(application.state).toBe(MicrodeApplicationState.Failed);
	});

	it('starts all modules before handling a synchronous execution error', async () => {
		const events: string[] = [];
		const failure = new Error('synchronous execution failed');
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new FailingSynchronousExecutionModule(
				instance,
				events,
				'first',
				failure,
			);
		});
		application.install((instance) => {
			return new PassiveModule(instance, events, 'second');
		});

		await expect(application.serve()).resolves.toEqual({
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
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new FailingLifecycleModule(
				instance,
				events,
				'first',
				'teardown',
				firstFailure,
			);
		});
		application.install((instance) => {
			return new FailingLifecycleModule(
				instance,
				events,
				'second',
				'teardown',
				secondFailure,
			);
		});

		await expect(application.serve()).resolves.toEqual({
			exitCode: 1,
			error: secondFailure,
			errors: [secondFailure, firstFailure],
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
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new PassiveModule(instance, events, 'first');
		});
		application.install((instance) => {
			return new FailingLifecycleModule(
				instance,
				events,
				'second',
				'shutdown',
				failure,
			);
		});

		await expect(application.serve()).resolves.toEqual({
			exitCode: 1,
			error: failure,
		});
		expect(events).toContain('first:shutdown');
		expect(events).toContain('first:cleanup');
	});

	it('continues cleanup after a cleanup error', async () => {
		const events: string[] = [];
		const failure = new Error('cleanup failed');
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new PassiveModule(instance, events, 'first');
		});
		application.install((instance) => {
			return new FailingLifecycleModule(
				instance,
				events,
				'second',
				'cleanup',
				failure,
			);
		});

		await expect(application.serve()).resolves.toEqual({
			exitCode: 1,
			error: failure,
		});
		expect(events).toContain('first:cleanup');
	});

	it('preserves a primary error when teardown also fails', async () => {
		const events: string[] = [];
		const primaryFailure = new Error('execution failed');
		const teardownFailure = new Error('teardown failed');
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new FailingExecutionModule(
				instance,
				events,
				'first',
				primaryFailure,
			);
		});
		application.install((instance) => {
			return new FailingLifecycleModule(
				instance,
				events,
				'second',
				'teardown',
				teardownFailure,
			);
		});

		await expect(application.serve()).resolves.toEqual({
			exitCode: 1,
			error: primaryFailure,
			errors: [primaryFailure, teardownFailure],
		});
	});

	it('does not stop when an asynchronous passive module finishes', async () => {
		let releaseActive!: () => void;
		const activeCompletion = new Promise<void>((resolve) => {
			releaseActive = resolve;
		});
		let executionFinished = false;
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new PassiveModule(instance, [], 'passive');
		});
		application.install((instance) => {
			return new ActiveModule(instance, [], 'active', activeCompletion);
		});

		const execution = application.serve().finally(() => {
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
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new ActiveModule(
				instance,
				events,
				'active',
				activeCompletion,
				() => {},
				releaseActive,
			);
		});
		application.install((instance) => {
			return new FailingExecutionModule(
				instance,
				events,
				'passive',
				failure,
			);
		});

		await expect(application.serve()).resolves.toEqual({
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
		const application = new MicrodeApplication();

		application.install((instance) => {
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
		application.install((instance) => {
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

		await expect(application.serve()).resolves.toEqual({ exitCode: 0 });

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
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new ActiveModule(instance, [], 'first');
		});
		application.install((instance) => {
			return new ActiveModule(
				instance,
				[],
				'second',
				secondCompletion,
				() => {},
				() => rejectSecond(failure),
			);
		});

		await expect(application.serve()).resolves.toEqual({
			exitCode: 1,
			error: failure,
		});
		expect(application.state).toBe(MicrodeApplicationState.Failed);
	});

	it('continues stopping active modules after a stop error', async () => {
		const events: string[] = [];
		const failure = new Error('stop failed');
		const application = new MicrodeApplication();

		application.install((instance) => {
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
		application.install((instance) => {
			return new ActiveModule(instance, events, 'second');
		});

		await expect(application.serve()).resolves.toEqual({
			exitCode: 1,
			error: failure,
		});
		expect(events).toContain('first:stop');
		expect(events).toContain('second:stop');
	});

	it('handles a synchronous active module stop error', async () => {
		const events: string[] = [];
		const failure = new Error('synchronous stop failed');
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new (class extends ActiveModule {
				override stop(): Promise<void> {
					this.record('stop');
					throw failure;
				}
			})(instance, events, 'active');
		});

		await expect(application.serve()).resolves.toEqual({
			exitCode: 1,
			error: failure,
		});
		expect(events).toContain('active:teardown');
	});
});

describe('MicrodeApplication Stopping', () => {
	it('rejects stopping before the application has started', () => {
		const application = new MicrodeApplication();

		expect(() => application.stop()).toThrow(
			'Cannot stop application before it has started. Current state: Idle',
		);
	});

	it('returns the execution promise and handles repeated stop requests once', async () => {
		const events: string[] = [];
		let releaseRun!: () => void;
		const runCompletion = new Promise<void>((resolve) => {
			releaseRun = resolve;
		});
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new ActiveModule(
				instance,
				events,
				'active',
				runCompletion,
				() => {},
				releaseRun,
			);
		});

		const execution = application.serve();
		await vi.waitFor(() => expect(events).toContain('active:run'));

		const firstStop = application.stop();
		const secondStop = application.stop();

		expect(firstStop).toBe(execution);
		expect(secondStop).toBe(execution);
		await expect(execution).resolves.toEqual({ exitCode: 0 });
		expect(events.filter((event) => event === 'active:stop')).toHaveLength(
			1,
		);
	});

	it('does not deadlock when a module requests a stop', async () => {
		const application = new MicrodeApplication();
		application.install((instance) => {
			return new (class extends PassiveModule {
				override async run(): Promise<void> {
					this.context.requestStop();
				}
			})(instance, [], 'passive');
		});

		await expect(application.serve()).resolves.toEqual({ exitCode: 0 });
	});

	it('stops with an explicit exit code', async () => {
		const application = new MicrodeApplication();
		application.install((instance) => new ActiveModule(instance, []));

		const execution = application.serve();
		expect(application.stop(42)).toBe(execution);
		await expect(execution).resolves.toEqual({ exitCode: 42 });
		expect(application.state).toBe(MicrodeApplicationState.Failed);
	});

	it('stops with an explicit error', async () => {
		const failure = new Error('stop requested');
		const application = new MicrodeApplication();
		application.install((instance) => new ActiveModule(instance, []));

		const execution = application.serve();
		expect(application.stop(failure)).toBe(execution);
		await expect(execution).resolves.toEqual({
			exitCode: 1,
			error: failure,
		});
	});

	it('stops with an explicit exit code and error', async () => {
		const failure = new Error('restart requested');
		const application = new MicrodeApplication();
		application.install((instance) => new ActiveModule(instance, []));

		const execution = application.serve();
		expect(application.stop(75, failure)).toBe(execution);
		await expect(execution).resolves.toEqual({
			exitCode: 75,
			error: failure,
		});
	});

	it('uses the values from the first repeated stop request', async () => {
		const firstFailure = new Error('first request');
		const application = new MicrodeApplication();
		application.install((instance) => new ActiveModule(instance, []));

		const execution = application.serve();
		const firstStop = application.stop(2, firstFailure);
		const secondStop = application.stop(3, new Error('second request'));

		expect(firstStop).toBe(execution);
		expect(secondStop).toBe(execution);
		await expect(execution).resolves.toEqual({
			exitCode: 2,
			error: firstFailure,
		});
	});

	it('finishes the current initialization and skips remaining forward work', async () => {
		const events: string[] = [];
		let releaseInitialization!: () => void;
		const initializationCompletion = new Promise<void>((resolve) => {
			releaseInitialization = resolve;
		});
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new (class extends PassiveModule {
				override async initialize(): Promise<void> {
					this.record('initialize');
					await initializationCompletion;
				}
			})(instance, events, 'first');
		});
		application.install((instance) => {
			return new PassiveModule(instance, events, 'second');
		});

		const execution = application.serve();
		await vi.waitFor(() => expect(events).toContain('first:initialize'));
		application.stop();
		releaseInitialization();

		await expect(execution).resolves.toEqual({ exitCode: 0 });
		expect(events).toEqual([
			'first:initialize',
			'first:shutdown',
			'second:cleanup',
			'first:cleanup',
		]);
	});

	it('finishes the current setup and skips remaining setup and execution', async () => {
		const events: string[] = [];
		let releaseSetup!: () => void;
		const setupCompletion = new Promise<void>((resolve) => {
			releaseSetup = resolve;
		});
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new (class extends PassiveModule {
				override async setup(): Promise<void> {
					this.record('setup');
					await setupCompletion;
				}
			})(instance, events, 'first');
		});
		application.install((instance) => {
			return new PassiveModule(instance, events, 'second');
		});

		const execution = application.serve();
		await vi.waitFor(() => expect(events).toContain('first:setup'));
		application.stop();
		releaseSetup();

		await expect(execution).resolves.toEqual({ exitCode: 0 });
		expect(events).toEqual([
			'first:initialize',
			'second:initialize',
			'first:setup',
			'first:teardown',
			'second:shutdown',
			'first:shutdown',
			'second:cleanup',
			'first:cleanup',
		]);
	});

	it('invokes active module stops immediately in reverse installation order', async () => {
		const events: string[] = [];
		let releaseFirstRun!: () => void;
		let releaseSecondRun!: () => void;
		let releaseSecondStop!: () => void;
		const firstRun = new Promise<void>((resolve) => {
			releaseFirstRun = resolve;
		});
		const secondRun = new Promise<void>((resolve) => {
			releaseSecondRun = resolve;
		});
		const secondStop = new Promise<void>((resolve) => {
			releaseSecondStop = resolve;
		});
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new ActiveModule(
				instance,
				events,
				'first',
				firstRun,
				() => {},
				releaseFirstRun,
			);
		});
		application.install((instance) => {
			return new ActiveModule(
				instance,
				events,
				'second',
				secondRun,
				() => {},
				releaseSecondRun,
				secondStop,
			);
		});

		const execution = application.serve();
		await vi.waitFor(() => expect(events).toContain('second:run'));
		application.stop();
		await vi.waitFor(() => expect(events).toContain('first:stop'));

		expect(events.indexOf('second:stop')).toBeLessThan(
			events.indexOf('first:stop'),
		);
		expect(events).not.toContain('second:teardown');

		releaseSecondStop();
		await expect(execution).resolves.toEqual({ exitCode: 0 });
	});

	it('waits for stop operations before draining pending runs', async () => {
		const events: string[] = [];
		let releaseRun!: () => void;
		let releaseStop!: () => void;
		const runCompletion = new Promise<void>((resolve) => {
			releaseRun = resolve;
		});
		const stopCompletion = new Promise<void>((resolve) => {
			releaseStop = resolve;
		});
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new ActiveModule(
				instance,
				events,
				'active',
				runCompletion,
				() => {},
				() => {},
				stopCompletion,
				() => events.push('active:run-complete'),
			);
		});

		const execution = application.serve();
		await vi.waitFor(() => expect(events).toContain('active:run'));
		application.stop();
		await vi.waitFor(() => expect(events).toContain('active:stop'));
		releaseRun();
		await vi.waitFor(() => expect(events).toContain('active:run-complete'));

		expect(events).not.toContain('active:teardown');
		releaseStop();
		await execution;
		expect(events.indexOf('active:run-complete')).toBeLessThan(
			events.indexOf('active:teardown'),
		);
	});

	it('prioritizes a stop error over an execution error and retains both', async () => {
		const executionFailure = new Error('execution failed');
		const stopFailure = new Error('stop failed');
		let rejectRun!: (reason: unknown) => void;
		const runCompletion = new Promise<void>((_resolve, reject) => {
			rejectRun = reject;
		});
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new ActiveModule(
				instance,
				[],
				'active',
				runCompletion,
				() => {},
				() => {
					rejectRun(executionFailure);
					throw stopFailure;
				},
			);
		});

		const execution = application.serve();
		await vi.waitFor(() =>
			expect(application.state).toBe(MicrodeApplicationState.Running),
		);
		application.stop();
		const result = await execution;

		expect(result).toMatchObject({
			exitCode: 1,
			error: stopFailure,
		});
		expect(result.errors).toEqual([stopFailure, executionFailure]);
	});

	it('keeps multiple stop errors in deterministic reverse module order', async () => {
		const firstFailure = new Error('first stop failed');
		const secondFailure = new Error('second stop failed');
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new ActiveModule(
				instance,
				[],
				'first',
				Promise.resolve(),
				() => {},
				() => {
					throw firstFailure;
				},
			);
		});
		application.install((instance) => {
			return new ActiveModule(
				instance,
				[],
				'second',
				Promise.resolve(),
				() => {},
				() => {
					throw secondFailure;
				},
			);
		});

		const result = await application.serve();

		expect(result.error).toBe(secondFailure);
		expect(result.errors).toEqual([secondFailure, firstFailure]);
	});

	it('joins shutdown when stop is called after execution has ended', async () => {
		const events: string[] = [];
		let releaseShutdown!: () => void;
		const shutdownCompletion = new Promise<void>((resolve) => {
			releaseShutdown = resolve;
		});
		const application = new MicrodeApplication();

		application.install((instance) => {
			return new (class extends PassiveModule {
				override async shutdown(): Promise<void> {
					this.record('shutdown');
					await shutdownCompletion;
				}
			})(instance, events, 'passive');
		});

		const execution = application.serve();
		await vi.waitFor(() =>
			expect(application.state).toBe(MicrodeApplicationState.Shutdown),
		);
		expect(application.stop()).toBe(execution);

		releaseShutdown();
		await expect(execution).resolves.toEqual({ exitCode: 0 });
	});
});

describe('MicrodeApplication Panic', () => {
	it('delegates context panic to the runtime panic behavior', () => {
		const exitFailure = new Error('process exited');
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const trace = vi.spyOn(console, 'trace').mockImplementation(() => {});
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw exitFailure;
		});
		const failure = new Error('context panic');
		const application = new MicrodeApplication();
		let receivedContext!: MicrodeContext;
		application.install((context) => {
			receivedContext = context;
			return new PassiveModule(context, []);
		});

		try {
			expect(() => receivedContext.panic(failure)).toThrow(exitFailure);
			expect(error).toHaveBeenCalledWith(failure);
			expect(exit).toHaveBeenCalledWith(1);
		} finally {
			error.mockRestore();
			trace.mockRestore();
			exit.mockRestore();
		}
	});

	it('prints a stack trace and immediately exits with code 1', () => {
		const exitFailure = new Error('process exited');
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const trace = vi.spyOn(console, 'trace').mockImplementation(() => {});
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw exitFailure;
		});

		try {
			expect(() => new MicrodeApplication().panic()).toThrow(exitFailure);
			expect(error).not.toHaveBeenCalled();
			expect(trace).toHaveBeenCalledOnce();
			expect(exit).toHaveBeenCalledWith(1);
			expect(trace.mock.invocationCallOrder[0]).toBeLessThan(
				exit.mock.invocationCallOrder[0],
			);
		} finally {
			error.mockRestore();
			trace.mockRestore();
			exit.mockRestore();
		}
	});

	it('prints a supplied error before the stack trace', () => {
		const failure = new Error('panic failure');
		const exitFailure = new Error('process exited');
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const trace = vi.spyOn(console, 'trace').mockImplementation(() => {});
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw exitFailure;
		});

		try {
			expect(() => new MicrodeApplication().panic(failure)).toThrow(
				exitFailure,
			);
			expect(error).toHaveBeenCalledWith(failure);
			expect(trace).toHaveBeenCalledOnce();
			expect(error.mock.invocationCallOrder[0]).toBeLessThan(
				trace.mock.invocationCallOrder[0],
			);
			expect(trace.mock.invocationCallOrder[0]).toBeLessThan(
				exit.mock.invocationCallOrder[0],
			);
		} finally {
			error.mockRestore();
			trace.mockRestore();
			exit.mockRestore();
		}
	});
});
