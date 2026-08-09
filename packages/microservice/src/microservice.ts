import {
	ActiveMicroserviceModule,
	type MicroserviceModule,
} from './microservice-module.js';

enum ModuleStage {
	Installed,
	Initializing,
	Initialized,
	SettingUp,
	SetUp,
	Executing,
	Executed,
	TearingDown,
	TornDown,
	ShuttingDown,
	Shutdown,
	CleaningUp,
	CleanedUp,
}

interface InstalledModule {
	readonly module: MicroserviceModule;
	stage: ModuleStage;
}

type ModuleExecutionOutcome =
	| { readonly status: 'fulfilled' }
	| { readonly status: 'rejected'; readonly error: unknown };

interface ActiveModuleRun {
	readonly module: ActiveMicroserviceModule;
	readonly completion: Promise<ModuleExecutionOutcome>;
}

enum ErrorPriority {
	Lifecycle,
	Execution,
	Stop,
	StopRequest,
}

interface RecordedError {
	readonly error: unknown;
	readonly priority: ErrorPriority;
	readonly sequence: number;
}

/** The observable lifecycle state of a {@link Microservice}. */
export enum MicroserviceState {
	/** The service accepts module installations and has not started. */
	Idle,
	/** A module factory is currently being evaluated. */
	Installing,
	/** Installed modules are being initialized. */
	Initialization,
	/** Initialized modules are being set up. */
	Setup,
	/** Modules are running. */
	Running,
	/** Setup is being reversed. */
	TearDown,
	/** Initialized resources are being released. */
	Shutdown,
	/** Final module cleanup is running. */
	CleanUp,
	/** Execution completed without an error or non-zero requested exit code. */
	Finished,
	/** Execution completed with an error or non-zero requested exit code. */
	Failed,
}

/** The outcome returned when a microservice finishes its lifecycle. */
export interface MicroserviceExecutionResult {
	/** The suggested process exit code. */
	exitCode: number;
	/** The highest-priority error encountered, when execution failed. */
	error?: unknown;
	/** All errors in priority order when more than one error was encountered. */
	errors?: readonly unknown[];
}

/**
 * Composes modules and coordinates their complete lifecycle.
 *
 * A microservice instance can run only once. Install all modules before calling
 * {@link Microservice.run | run}.
 *
 * @example
 * ```ts
 * const service = new Microservice();
 * service.install((microservice) => new DatabaseModule(microservice));
 *
 * const result = await service.run();
 * process.exitCode = result.exitCode;
 * ```
 */
export class Microservice {
	private readonly modules: InstalledModule[] = [];
	private readonly stopRequest: Promise<void>;
	private resolveStopRequest!: () => void;
	private currentState = MicroserviceState.Idle;
	private execution?: Promise<MicroserviceExecutionResult>;
	private stopRequested = false;
	private stopExitCode?: number;
	private stopError?: unknown;

	constructor() {
		this.stopRequest = new Promise<void>((resolve) => {
			this.resolveStopRequest = resolve;
		});
	}

	/** The service's current lifecycle state. */
	public get state(): MicroserviceState {
		return this.currentState;
	}

	/**
	 * Creates and installs a module.
	 *
	 * @param factory A synchronous factory that receives this microservice.
	 * @returns The installed module.
	 * @throws If called after execution has started, or if another installation is in progress.
	 */
	install<Template extends MicroserviceModule>(
		factory: (microservice: Microservice) => Template,
	): Template {
		if (this.state !== MicroserviceState.Idle) {
			throw new Error(
				`Cannot install module after microservice has started. Current state: ${MicroserviceState[this.state]}`,
			);
		}

		this.currentState = MicroserviceState.Installing;
		try {
			const module = factory(this);
			this.modules.push({
				module,
				stage: ModuleStage.Installed,
			});
			return module;
		} finally {
			this.currentState = MicroserviceState.Idle;
		}
	}

	/**
	 * Runs the module lifecycle once.
	 *
	 * Lifecycle failures are represented in the resolved result so cleanup can
	 * finish before the caller receives the outcome. Calling `run` more than once
	 * returns a rejected promise.
	 */
	run(): Promise<MicroserviceExecutionResult> {
		if (this.currentState !== MicroserviceState.Idle) {
			return Promise.reject(
				new Error(
					`Cannot run microservice more than once. Current state: ${MicroserviceState[this.currentState]}`,
				),
			);
		}

		this.currentState = MicroserviceState.Initialization;
		let resolveExecution!: (result: MicroserviceExecutionResult) => void;
		let rejectExecution!: (error: unknown) => void;
		this.execution = new Promise<MicroserviceExecutionResult>(
			(resolve, reject) => {
				resolveExecution = resolve;
				rejectExecution = reject;
			},
		);
		void this.executeLifecycle().then(resolveExecution, rejectExecution);
		return this.execution;
	}

	/**
	 * Logs an optional fatal error and terminates the process immediately.
	 *
	 * This bypasses the normal module shutdown lifecycle.
	 */
	panic(error?: unknown): never {
		if (error !== undefined) {
			console.error(error);
		}
		console.trace();
		process.exit(1);
	}

	/** Requests an orderly stop and resolves with the existing execution result. */
	stop(): Promise<MicroserviceExecutionResult>;
	/** Requests an orderly stop with a specific exit code. */
	stop(exitCode: number): Promise<MicroserviceExecutionResult>;
	/** Requests an orderly stop caused by an error. */
	stop(error: unknown): Promise<MicroserviceExecutionResult>;
	/** Requests an orderly stop with both an exit code and error. */
	stop(
		exitCode: number,
		error: unknown,
	): Promise<MicroserviceExecutionResult>;
	stop(
		exitCodeOrError?: number | unknown,
		error?: unknown,
	): Promise<MicroserviceExecutionResult> {
		if (
			this.currentState === MicroserviceState.Idle ||
			this.currentState === MicroserviceState.Installing
		) {
			throw new Error(
				`Cannot stop microservice before it has started. Current state: ${MicroserviceState[this.currentState]}`,
			);
		}

		if (!this.stopRequested) {
			this.stopRequested = true;
			if (typeof exitCodeOrError === 'number') {
				this.stopExitCode = exitCodeOrError;
				this.stopError = error;
			} else {
				this.stopError = exitCodeOrError;
			}
			this.resolveStopRequest();
		}

		return this.execution!;
	}

	private async executeLifecycle(): Promise<MicroserviceExecutionResult> {
		const recordedErrors: RecordedError[] = [];
		let errorSequence = 0;
		const recordError = (
			error: unknown,
			priority = ErrorPriority.Lifecycle,
		): void => {
			recordedErrors.push({
				error,
				priority,
				sequence: errorSequence++,
			});
		};

		try {
			await this.initializeModules();

			if (!this.stopRequested) {
				this.currentState = MicroserviceState.Setup;
				await this.setupModules();
			}

			if (!this.stopRequested) {
				this.currentState = MicroserviceState.Running;
				await this.executeModules(recordError);
			}
		} catch (error) {
			recordError(error);
		}

		this.currentState = MicroserviceState.TearDown;
		await this.teardownModules(recordError);

		this.currentState = MicroserviceState.Shutdown;
		await this.shutdownModules(recordError);

		this.currentState = MicroserviceState.CleanUp;
		await this.cleanupModules(recordError);

		if (this.stopError !== undefined) {
			recordError(this.stopError, ErrorPriority.StopRequest);
		}

		if (
			recordedErrors.length > 0 ||
			(this.stopExitCode !== undefined && this.stopExitCode !== 0)
		) {
			this.currentState = MicroserviceState.Failed;
		} else {
			this.currentState = MicroserviceState.Finished;
		}

		return this.createExecutionResult(recordedErrors, this.stopExitCode);
	}

	private async initializeModules(): Promise<void> {
		for (const installedModule of this.modules) {
			if (this.stopRequested) {
				break;
			}
			installedModule.stage = ModuleStage.Initializing;
			await installedModule.module.initialize();
			installedModule.stage = ModuleStage.Initialized;
		}
	}

	private async setupModules(): Promise<void> {
		for (const installedModule of this.modules) {
			if (this.stopRequested) break;
			installedModule.stage = ModuleStage.SettingUp;
			await installedModule.module.setup();
			installedModule.stage = ModuleStage.SetUp;
		}
	}

	private async executeModules(
		recordError: (error: unknown, priority?: ErrorPriority) => void,
	): Promise<void> {
		const activeRuns: ActiveModuleRun[] = [];
		const passiveRuns: Promise<ModuleExecutionOutcome>[] = [];

		for (const installedModule of this.modules) {
			const completion = this.startModuleExecution(
				installedModule,
				(error) => recordError(error, ErrorPriority.Execution),
			);

			if (installedModule.module instanceof ActiveMicroserviceModule) {
				activeRuns.push({
					module: installedModule.module,
					completion,
				});
			} else {
				passiveRuns.push(completion);
			}
		}

		if (activeRuns.length === 0) {
			await Promise.all(passiveRuns);
			return;
		}

		await new Promise<void>((resolve) => {
			void this.stopRequest.then(() => resolve());
			for (const { completion } of activeRuns) {
				void completion.then(() => resolve());
			}
			for (const completion of passiveRuns) {
				void completion.then((outcome) => {
					if (outcome.status === 'rejected') resolve();
				});
			}
		});

		const stoppedRuns = await this.stopActiveModules(
			activeRuns,
			recordError,
		);

		await Promise.all(stoppedRuns.map(({ completion }) => completion));
		await Promise.all(passiveRuns);
	}

	private async stopActiveModules(
		activeRuns: readonly ActiveModuleRun[],
		recordError: (error: unknown, priority?: ErrorPriority) => void,
	): Promise<ActiveModuleRun[]> {
		const reversedRuns = [...activeRuns].reverse();
		const stopPromises = reversedRuns.map(({ module }) =>
			this.stopModule(module),
		);
		const stopResults = await Promise.allSettled(stopPromises);
		const stoppedRuns: ActiveModuleRun[] = [];

		for (const [index, stopResult] of stopResults.entries()) {
			if (stopResult.status === 'rejected') {
				recordError(stopResult.reason, ErrorPriority.Stop);
			} else {
				stoppedRuns.push(reversedRuns[index]);
			}
		}

		return stoppedRuns;
	}

	private stopModule(module: ActiveMicroserviceModule): Promise<void> {
		return Promise.resolve().then(() => module.stop());
	}

	private createExecutionResult(
		recordedErrors: readonly RecordedError[],
		exitCode?: number,
	): MicroserviceExecutionResult {
		if (recordedErrors.length === 0) return { exitCode: exitCode ?? 0 };

		const errors = [...recordedErrors]
			.sort((left, right) => {
				return (
					right.priority - left.priority ||
					left.sequence - right.sequence
				);
			})
			.map(({ error }) => error);

		return {
			exitCode: exitCode ?? 1,
			error: errors[0],
			...(errors.length > 1 ? { errors } : {}),
		};
	}

	private startModuleExecution(
		installedModule: InstalledModule,
		recordError: (error: unknown) => void,
	): Promise<ModuleExecutionOutcome> {
		installedModule.stage = ModuleStage.Executing;

		return Promise.resolve()
			.then(() => installedModule.module.run())
			.then<ModuleExecutionOutcome, ModuleExecutionOutcome>(
				() => ({ status: 'fulfilled' }),
				(error) => {
					recordError(error);
					return { status: 'rejected', error };
				},
			)
			.finally(() => {
				installedModule.stage = ModuleStage.Executed;
			});
	}

	private async teardownModules(
		recordError: (error: unknown) => void,
	): Promise<void> {
		for (let index = this.modules.length - 1; index >= 0; index--) {
			const installedModule = this.modules[index];
			if (
				installedModule.stage < ModuleStage.SettingUp ||
				installedModule.stage >= ModuleStage.TearingDown
			) {
				continue;
			}
			installedModule.stage = ModuleStage.TearingDown;
			try {
				await installedModule.module.teardown();
			} catch (error) {
				recordError(error);
			} finally {
				installedModule.stage = ModuleStage.TornDown;
			}
		}
	}

	private async shutdownModules(
		recordError: (error: unknown) => void,
	): Promise<void> {
		for (let index = this.modules.length - 1; index >= 0; index--) {
			const installedModule = this.modules[index];
			if (
				installedModule.stage < ModuleStage.Initializing ||
				installedModule.stage >= ModuleStage.ShuttingDown
			) {
				continue;
			}
			installedModule.stage = ModuleStage.ShuttingDown;
			try {
				await installedModule.module.shutdown();
			} catch (error) {
				recordError(error);
			} finally {
				installedModule.stage = ModuleStage.Shutdown;
			}
		}
	}

	private async cleanupModules(
		recordError: (error: unknown) => void,
	): Promise<void> {
		for (let index = this.modules.length - 1; index >= 0; index--) {
			const installedModule = this.modules[index];
			installedModule.stage = ModuleStage.CleaningUp;
			try {
				await installedModule.module.cleanup();
			} catch (error) {
				recordError(error);
			} finally {
				installedModule.stage = ModuleStage.CleanedUp;
			}
		}
	}
}
