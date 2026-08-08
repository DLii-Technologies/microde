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

export enum MicroserviceState {
	Idle,
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
}

export class Microservice {
	private readonly modules: InstalledModule[] = [];
	private currentState = MicroserviceState.Idle;

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
		const module = factory(this);
		this.modules.push({
			module,
			stage: ModuleStage.Installed,
		});
		return module;
	}

	async run(): Promise<MicroserviceExecutionResult> {
		if (this.currentState !== MicroserviceState.Idle) {
			throw new Error(
				`Cannot run microservice more than once. Current state: ${MicroserviceState[this.currentState]}`,
			);
		}

		this.currentState = MicroserviceState.Initialization;

		let result: MicroserviceExecutionResult = { exitCode: 0 };
		let hasError = false;
		const recordError = (error: unknown): void => {
			if (!hasError) {
				hasError = true;
				result = {
					exitCode: 1,
					error,
				};
			}
		};

		try {
			await this.initializeModules();

			this.currentState = MicroserviceState.Setup;
			await this.setupModules();

			this.currentState = MicroserviceState.Running;
			await this.executeModules(recordError);
		} catch (error) {
			recordError(error);
		}

		this.currentState = MicroserviceState.TearDown;
		await this.teardownModules(recordError);

		this.currentState = MicroserviceState.Shutdown;
		await this.shutdownModules(recordError);

		this.currentState = MicroserviceState.CleanUp;
		await this.cleanupModules(recordError);

		if (hasError) {
			this.currentState = MicroserviceState.Failed;
		} else {
			this.currentState = MicroserviceState.Finished;
		}

		return result;
	}

	private async initializeModules(): Promise<void> {
		for (const installedModule of this.modules) {
			installedModule.stage = ModuleStage.Initializing;
			await installedModule.module.initialize();
			installedModule.stage = ModuleStage.Initialized;
		}
	}

	private async setupModules(): Promise<void> {
		for (const installedModule of this.modules) {
			installedModule.stage = ModuleStage.SettingUp;
			await installedModule.module.setup();
			installedModule.stage = ModuleStage.SetUp;
		}
	}

	private async executeModules(
		recordError: (error: unknown) => void,
	): Promise<void> {
		const activeRuns: Array<{
			module: ActiveMicroserviceModule;
			completion: Promise<ModuleExecutionOutcome>;
		}> = [];
		const passiveRuns: Promise<ModuleExecutionOutcome>[] = [];

		for (const installedModule of this.modules) {
			const completion = this.startModuleExecution(
				installedModule,
				recordError,
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
			for (const { completion } of activeRuns) {
				void completion.then(() => resolve());
			}
			for (const completion of passiveRuns) {
				void completion.then((outcome) => {
					if (outcome.status === 'rejected') resolve();
				});
			}
		});

		const stopResults = await Promise.allSettled(
			activeRuns.map(({ module }) =>
				Promise.resolve().then(() => module.stop()),
			),
		);
		for (const stopResult of stopResults) {
			if (stopResult.status === 'rejected') {
				recordError(stopResult.reason);
			}
		}

		await Promise.all(activeRuns.map(({ completion }) => completion));
		await Promise.all(passiveRuns);
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
