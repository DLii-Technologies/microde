import {
	ActiveMicroserviceModule,
	type PassiveMicroserviceModule,
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

type MicroserviceModule = ActiveMicroserviceModule | PassiveMicroserviceModule;

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

export enum MicroserviceState {
	Idle,
	Installing,
	Initialization,
	Setup,
	Running,
	TearDown,
	Shutdown,
	CleanUp,
	Finished,
	Failed,
}

export interface MicroserviceExecutionResult {
	exitCode: number;
	error?: unknown;
	errors?: readonly unknown[];
}

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

	public get state(): MicroserviceState {
		return this.currentState;
	}

	install(
		factory: (microservice: Microservice) => MicroserviceModule,
	): MicroserviceModule {
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

	stop(): Promise<MicroserviceExecutionResult>;
	stop(exitCode: number): Promise<MicroserviceExecutionResult>;
	stop(error: unknown): Promise<MicroserviceExecutionResult>;
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
