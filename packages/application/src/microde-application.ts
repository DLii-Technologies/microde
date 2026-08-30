import { ModuleKind, type MicrodeModule } from './microde-module.js';
import type { MicrodeContext, MicrodeStopRequest } from './microde-context.js';
import {
	createModuleHandle,
	isModuleHandleOwnedBy,
	type ModuleHandle,
	type ModuleInstanceId,
} from './composition.js';
import { DependencyGraph } from './dependency-graph.js';
import type { RelationshipHandle } from './relationship.js';
import {
	createRunContext,
	createSetupContext,
	type ResolvedRelationship,
} from './lifecycle-context.js';

class DefaultMicrodeContext implements MicrodeContext {
	constructor(
		private readonly requestStopCallback: (
			request?: MicrodeStopRequest,
		) => void,
		private readonly panicCallback: (error?: unknown) => never,
	) {}

	requestStop(request?: MicrodeStopRequest): void {
		this.requestStopCallback(request);
	}

	panic(error?: unknown): never {
		return this.panicCallback(error);
	}
}

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
	readonly id: ModuleInstanceId;
	readonly module: MicrodeModule;
	stage: ModuleStage;
}

type ModuleExecutionOutcome =
	| { readonly status: 'fulfilled' }
	| { readonly status: 'rejected'; readonly error: unknown };

interface ModuleRun {
	readonly module: MicrodeModule;
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

/** The application-level task invoked after all modules have started. */
export type MicrodeMain = (context: MicrodeContext) => void | Promise<void>;

/** The observable lifecycle state of a {@link MicrodeApplication}. */
export enum MicrodeApplicationState {
	/** The application accepts module installations and has not started. */
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

/** The outcome returned when a Microde application finishes its lifecycle. */
export interface MicrodeExecutionResult {
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
 * A Microde application can execute only once. Install all modules before calling
 * {@link MicrodeApplication.serve | serve} or {@link MicrodeApplication.run | run}.
 *
 * @example
 * ```ts
 * const service = new MicrodeApplication();
 * service.install((context) => new DatabaseModule(context));
 *
 * const result = await service.run();
 * process.exitCode = result.exitCode;
 * ```
 */
export class MicrodeApplication {
	private readonly modules: InstalledModule[] = [];
	private readonly moduleIds = new Set<ModuleInstanceId>();
	private readonly compositionOwner = {};
	private readonly bindings = new Map<
		RelationshipHandle,
		{ readonly owner: ModuleInstanceId; readonly target: ModuleInstanceId }
	>();
	private resolutions: ReadonlyMap<RelationshipHandle, ResolvedRelationship> =
		new Map();
	private readonly context: MicrodeContext;
	private readonly stopRequest: Promise<void>;
	private resolveStopRequest!: () => void;
	private currentState = MicrodeApplicationState.Idle;
	private execution?: Promise<MicrodeExecutionResult>;
	private stopRequested = false;
	private stopExitCode?: number;
	private stopError?: unknown;
	private compositionSealed = false;

	constructor() {
		this.stopRequest = new Promise<void>((resolve) => {
			this.resolveStopRequest = resolve;
		});
		this.context = new DefaultMicrodeContext(
			(request) => this.requestStop(request),
			(error) => this.panic(error),
		);
	}

	/** The application's current lifecycle state. */
	public get state(): MicrodeApplicationState {
		return this.currentState;
	}

	/**
	 * Creates and installs a module.
	 *
	 * @param factory A synchronous factory that receives the module-facing context.
	 * @returns The installed module.
	 * @throws If called after execution has started, or if another installation is in progress.
	 */
	install<Module extends MicrodeModule>(
		id: ModuleInstanceId,
		factory: (context: MicrodeContext) => Module,
	): ModuleHandle<Module>;
	install<Module extends MicrodeModule>(
		factory: (context: MicrodeContext) => Module,
	): Module;
	install<Module extends MicrodeModule>(
		idOrFactory: ModuleInstanceId | ((context: MicrodeContext) => Module),
		maybeFactory?: (context: MicrodeContext) => Module,
	): Module | ModuleHandle<Module> {
		if (this.state !== MicrodeApplicationState.Idle) {
			throw new Error(
				`Cannot install module after application has started. Current state: ${MicrodeApplicationState[this.state]}`,
			);
		}
		if (this.compositionSealed) {
			throw new Error(
				'Cannot install module after composition is sealed.',
			);
		}
		const named = typeof idOrFactory === 'string';
		const id = named ? idOrFactory : `@installation/${this.modules.length}`;
		if (this.moduleIds.has(id)) {
			throw new Error(`Module instance ID "${id}" is already installed.`);
		}
		const factory = named ? maybeFactory! : idOrFactory;

		this.currentState = MicrodeApplicationState.Installing;
		try {
			const module = factory(this.context);
			this.modules.push({
				id,
				module,
				stage: ModuleStage.Installed,
			});
			this.moduleIds.add(id);
			return named
				? createModuleHandle<Module>(id, this.compositionOwner)
				: module;
		} finally {
			this.currentState = MicrodeApplicationState.Idle;
		}
	}

	/** Binds one declared relationship slot to an exact installed module. */
	bind<Consumer extends MicrodeModule, Provider extends MicrodeModule>(
		consumer: ModuleHandle<Consumer>,
		slotName: string,
		target: ModuleHandle<Provider>,
	): void {
		if (
			this.compositionSealed ||
			this.state !== MicrodeApplicationState.Idle
		) {
			throw new Error(
				'Cannot bind relationships after composition is sealed.',
			);
		}
		this.ensureOwnedHandle(consumer);
		this.ensureOwnedHandle(target);
		const installed = this.modules.find(({ id }) => id === consumer.id)!;
		const slot = installed.module.relationships.find(
			(relationship) => relationship.name === slotName,
		);
		if (!slot) {
			throw new Error(
				`Unknown relationship "${consumer.id}.${slotName}".`,
			);
		}
		if (this.bindings.has(slot)) {
			throw new Error(
				`Relationship "${consumer.id}.${slotName}" is already bound.`,
			);
		}
		const provider = this.modules.find(({ id }) => id === target.id)!;
		if (
			slot.port.moduleType &&
			!(provider.module instanceof slot.port.moduleType)
		) {
			throw new Error(
				`Module "${target.id}" does not satisfy concrete module requirement "${slot.port.moduleType.name}".`,
			);
		}
		if (
			!provider.module.providers.some(
				({ port }) => port.key === slot.port.key,
			)
		) {
			throw new Error(
				`Module "${target.id}" does not provide port "${slot.port.description}".`,
			);
		}
		this.bindings.set(slot, { owner: consumer.id, target: target.id });
	}

	private ensureOwnedHandle(handle: ModuleHandle<MicrodeModule>): void {
		if (!isModuleHandleOwnedBy(handle, this.compositionOwner)) {
			throw new Error(
				`Module handle "${handle.id}" belongs to another application.`,
			);
		}
	}

	private wireComposition(): void {
		const graph = new DependencyGraph(this.modules.map(({ id }) => id));
		for (const installed of this.modules) {
			for (const slot of installed.module.relationships) {
				const binding = this.bindings.get(slot);
				if (!binding) {
					throw new Error(
						`Missing binding for relationship "${installed.id}.${slot.name}".`,
					);
				}
				if (slot.kind === 'dependency') {
					graph.addDependency(binding.owner, binding.target);
				}
			}
		}
		const order = graph.order();
		const staged = new Map<RelationshipHandle, ResolvedRelationship>();
		const providerValues = new Map<object, unknown>();
		for (const installed of this.modules) {
			for (const slot of installed.module.relationships) {
				const binding = this.bindings.get(slot)!;
				const provider = this.modules.find(
					({ id }) => id === binding.target,
				)!;
				const exported = provider.module.providers.find(
					({ port }) => port.key === slot.port.key,
				)!;
				if (!providerValues.has(exported)) {
					providerValues.set(exported, exported.resolve());
				}
				staged.set(slot, {
					owner: installed.id,
					value: providerValues.get(exported),
				});
			}
		}
		const byId = new Map(this.modules.map((module) => [module.id, module]));
		const ordered = order.map((id) => byId.get(id)!);
		this.modules.splice(0, this.modules.length, ...ordered);
		this.resolutions = staged;
	}

	/**
	 * Serves the application using module completion and stop requests to control its lifetime.
	 *
	 * Lifecycle failures are represented in the resolved result so cleanup can
	 * finish before the caller receives the outcome. Starting an application more than once
	 * returns a rejected promise.
	 */
	serve(): Promise<MicrodeExecutionResult> {
		return this.start();
	}

	/**
	 * Runs an application-level task after all modules have started.
	 *
	 * Completion or failure of the task begins orderly application shutdown.
	 */
	run(main: MicrodeMain): Promise<MicrodeExecutionResult> {
		return this.start(main);
	}

	private start(main?: MicrodeMain): Promise<MicrodeExecutionResult> {
		if (this.currentState !== MicrodeApplicationState.Idle) {
			return Promise.reject(
				new Error(
					`Cannot start application more than once. Current state: ${MicrodeApplicationState[this.currentState]}`,
				),
			);
		}
		if (this.compositionSealed) {
			return Promise.reject(
				new Error(
					'Cannot start application more than once. Composition is sealed.',
				),
			);
		}
		this.compositionSealed = true;
		try {
			this.wireComposition();
		} catch (error) {
			return Promise.reject(error);
		}

		this.currentState = MicrodeApplicationState.Initialization;
		let resolveExecution!: (result: MicrodeExecutionResult) => void;
		let rejectExecution!: (error: unknown) => void;
		this.execution = new Promise<MicrodeExecutionResult>(
			(resolve, reject) => {
				resolveExecution = resolve;
				rejectExecution = reject;
			},
		);
		void this.executeLifecycle(main).then(
			resolveExecution,
			rejectExecution,
		);
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

	/** Requests an orderly stop. */
	stop(): Promise<MicrodeExecutionResult>;
	/** Requests an orderly stop with a specific exit code. */
	stop(exitCode: number): Promise<MicrodeExecutionResult>;
	/** Requests an orderly stop caused by an error. */
	stop(error: unknown): Promise<MicrodeExecutionResult>;
	/** Requests an orderly stop with both an exit code and error. */
	stop(exitCode: number, error: unknown): Promise<MicrodeExecutionResult>;
	stop(
		exitCodeOrError?: number | unknown,
		error?: unknown,
	): Promise<MicrodeExecutionResult> {
		const request =
			typeof exitCodeOrError === 'number'
				? { exitCode: exitCodeOrError, error }
				: { error: exitCodeOrError };
		this.requestStop(request);
		return this.execution!;
	}

	private requestStop(request: MicrodeStopRequest = {}): void {
		if (
			this.currentState === MicrodeApplicationState.Idle ||
			this.currentState === MicrodeApplicationState.Installing
		) {
			throw new Error(
				`Cannot stop application before it has started. Current state: ${MicrodeApplicationState[this.currentState]}`,
			);
		}

		if (!this.stopRequested) {
			this.stopRequested = true;
			this.stopExitCode = request.exitCode;
			this.stopError = request.error;
			this.resolveStopRequest();
		}
	}

	private async executeLifecycle(
		main?: MicrodeMain,
	): Promise<MicrodeExecutionResult> {
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
				this.currentState = MicrodeApplicationState.Setup;
				await this.setupModules();
			}

			if (!this.stopRequested) {
				this.currentState = MicrodeApplicationState.Running;
				await this.executeModules(recordError, main);
			}
		} catch (error) {
			recordError(error);
		}

		this.currentState = MicrodeApplicationState.TearDown;
		await this.teardownModules(recordError);

		this.currentState = MicrodeApplicationState.Shutdown;
		await this.shutdownModules(recordError);

		this.currentState = MicrodeApplicationState.CleanUp;
		await this.cleanupModules(recordError);

		if (this.stopError !== undefined) {
			recordError(this.stopError, ErrorPriority.StopRequest);
		}

		if (
			recordedErrors.length > 0 ||
			(this.stopExitCode !== undefined && this.stopExitCode !== 0)
		) {
			this.currentState = MicrodeApplicationState.Failed;
		} else {
			this.currentState = MicrodeApplicationState.Finished;
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
			await installedModule.module.setup(
				createSetupContext(installedModule.id, this.resolutions),
			);
			installedModule.stage = ModuleStage.SetUp;
		}
	}

	private async executeModules(
		recordError: (error: unknown, priority?: ErrorPriority) => void,
		main?: MicrodeMain,
	): Promise<void> {
		const activeRuns: ModuleRun[] = [];
		const passiveRuns: Promise<ModuleExecutionOutcome>[] = [];
		const moduleRuns: ModuleRun[] = [];

		for (const installedModule of this.modules) {
			const completion = this.startModuleExecution(
				installedModule,
				(error) => recordError(error, ErrorPriority.Execution),
			);

			const moduleRun = { module: installedModule.module, completion };
			moduleRuns.push(moduleRun);
			if (installedModule.module.kind === ModuleKind.Active) {
				activeRuns.push(moduleRun);
			} else {
				passiveRuns.push(completion);
			}
		}

		const mainCompletion = main
			? Promise.resolve()
					.then(() => main(this.context))
					.then<ModuleExecutionOutcome, ModuleExecutionOutcome>(
						() => ({ status: 'fulfilled' }),
						(error: unknown) => {
							recordError(error, ErrorPriority.Execution);
							return { status: 'rejected', error };
						},
					)
			: undefined;

		if (activeRuns.length === 0) {
			const completionSignals: Promise<unknown>[] = [
				this.stopRequest,
				...passiveRuns.map(
					(completion) =>
						new Promise<void>((resolve) => {
							void completion.then((outcome) => {
								if (outcome.status === 'rejected') resolve();
							});
						}),
				),
			];
			if (mainCompletion) {
				completionSignals.push(mainCompletion);
			} else {
				completionSignals.push(Promise.all(passiveRuns));
			}
			await Promise.race(completionSignals);
			await this.stopModules(moduleRuns, recordError);
			await Promise.all(passiveRuns);
			return;
		}

		await new Promise<void>((resolve) => {
			void this.stopRequest.then(() => resolve());
			if (mainCompletion) void mainCompletion.then(() => resolve());
			for (const { completion } of activeRuns) {
				void completion.then(() => resolve());
			}
			for (const completion of passiveRuns) {
				void completion.then((outcome) => {
					if (outcome.status === 'rejected') resolve();
				});
			}
		});

		const stoppedRuns = await this.stopModules(moduleRuns, recordError);

		await Promise.all(
			stoppedRuns
				.filter(({ module }) => module.kind === ModuleKind.Active)
				.map(({ completion }) => completion),
		);
		await Promise.all(passiveRuns);
	}

	private async stopModules(
		moduleRuns: readonly ModuleRun[],
		recordError: (error: unknown, priority?: ErrorPriority) => void,
	): Promise<ModuleRun[]> {
		const reversedRuns = [...moduleRuns].reverse();
		const stopPromises = reversedRuns.map(({ module }) =>
			this.stopModule(module),
		);
		const stopResults = await Promise.allSettled(stopPromises);
		const stoppedRuns: ModuleRun[] = [];

		for (const [index, stopResult] of stopResults.entries()) {
			if (stopResult.status === 'rejected') {
				recordError(stopResult.reason, ErrorPriority.Stop);
			} else {
				stoppedRuns.push(reversedRuns[index]);
			}
		}

		return stoppedRuns;
	}

	private stopModule(module: MicrodeModule): Promise<void> {
		return Promise.resolve().then(() => module.stop());
	}

	private createExecutionResult(
		recordedErrors: readonly RecordedError[],
		exitCode?: number,
	): MicrodeExecutionResult {
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
			.then(() =>
				installedModule.module.run(
					createRunContext(installedModule.id, this.resolutions),
				),
			)
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
