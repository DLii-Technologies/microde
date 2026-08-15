import { ModuleKind, type MicroserviceModule } from './microservice-module.js';
import type {
	MicroserviceContext,
	MicroserviceStopRequest,
} from './microservice-context.js';
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

class DefaultMicroserviceContext implements MicroserviceContext {
	constructor(
		private readonly requestStopCallback: (
			request?: MicroserviceStopRequest,
		) => void,
		private readonly panicCallback: (error?: unknown) => never,
	) {}

	requestStop(request?: MicroserviceStopRequest): void {
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
	readonly module: MicroserviceModule;
	stage: ModuleStage;
}

type ModuleExecutionOutcome =
	| { readonly status: 'fulfilled' }
	| { readonly status: 'rejected'; readonly error: unknown };

interface ModuleRun {
	readonly module: MicroserviceModule;
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
 * service.install((context) => new DatabaseModule(context));
 *
 * const result = await service.run();
 * process.exitCode = result.exitCode;
 * ```
 */
export class Microservice {
	private readonly modules: InstalledModule[] = [];
	private readonly moduleIds = new Set<ModuleInstanceId>();
	private readonly compositionOwner = {};
	private readonly bindings = new Map<
		RelationshipHandle,
		{ readonly owner: ModuleInstanceId; readonly target: ModuleInstanceId }
	>();
	private resolutions: ReadonlyMap<RelationshipHandle, ResolvedRelationship> =
		new Map();
	private readonly context: MicroserviceContext;
	private readonly stopRequest: Promise<void>;
	private resolveStopRequest!: () => void;
	private currentState = MicroserviceState.Idle;
	private execution?: Promise<MicroserviceExecutionResult>;
	private stopRequested = false;
	private stopExitCode?: number;
	private stopError?: unknown;
	private compositionSealed = false;

	constructor() {
		this.stopRequest = new Promise<void>((resolve) => {
			this.resolveStopRequest = resolve;
		});
		this.context = new DefaultMicroserviceContext(
			(request) => this.requestStop(request),
			(error) => this.panic(error),
		);
	}

	/** The service's current lifecycle state. */
	public get state(): MicroserviceState {
		return this.currentState;
	}

	/**
	 * Creates and installs a module.
	 *
	 * @param factory A synchronous factory that receives the module-facing context.
	 * @returns The installed module.
	 * @throws If called after execution has started, or if another installation is in progress.
	 */
	install<Module extends MicroserviceModule>(
		id: ModuleInstanceId,
		factory: (context: MicroserviceContext) => Module,
	): ModuleHandle<Module>;
	install<Module extends MicroserviceModule>(
		factory: (context: MicroserviceContext) => Module,
	): Module;
	install<Module extends MicroserviceModule>(
		idOrFactory:
			ModuleInstanceId | ((context: MicroserviceContext) => Module),
		maybeFactory?: (context: MicroserviceContext) => Module,
	): Module | ModuleHandle<Module> {
		if (this.state !== MicroserviceState.Idle) {
			throw new Error(
				`Cannot install module after microservice has started. Current state: ${MicroserviceState[this.state]}`,
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

		this.currentState = MicroserviceState.Installing;
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
			this.currentState = MicroserviceState.Idle;
		}
	}

	/** Binds one declared relationship slot to an exact installed module. */
	bind<
		Consumer extends MicroserviceModule,
		Provider extends MicroserviceModule,
	>(
		consumer: ModuleHandle<Consumer>,
		slotName: string,
		target: ModuleHandle<Provider>,
	): void {
		if (this.compositionSealed || this.state !== MicroserviceState.Idle) {
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

	private ensureOwnedHandle(handle: ModuleHandle<MicroserviceModule>): void {
		if (!isModuleHandleOwnedBy(handle, this.compositionOwner)) {
			throw new Error(
				`Module handle "${handle.id}" belongs to another microservice.`,
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
		if (this.compositionSealed) {
			return Promise.reject(
				new Error(
					'Cannot run microservice more than once. Composition is sealed.',
				),
			);
		}
		this.compositionSealed = true;
		try {
			this.wireComposition();
		} catch (error) {
			return Promise.reject(error);
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

	/** Requests an orderly stop. */
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
		const request =
			typeof exitCodeOrError === 'number'
				? { exitCode: exitCodeOrError, error }
				: { error: exitCodeOrError };
		this.requestStop(request);
		return this.execution!;
	}

	private requestStop(request: MicroserviceStopRequest = {}): void {
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
			this.stopExitCode = request.exitCode;
			this.stopError = request.error;
			this.resolveStopRequest();
		}
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
			await installedModule.module.setup(
				createSetupContext(installedModule.id, this.resolutions),
			);
			installedModule.stage = ModuleStage.SetUp;
		}
	}

	private async executeModules(
		recordError: (error: unknown, priority?: ErrorPriority) => void,
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

		if (activeRuns.length === 0) {
			await Promise.race([
				this.stopRequest,
				Promise.all(passiveRuns),
				...passiveRuns.map(
					(completion) =>
						new Promise<void>((resolve) => {
							void completion.then((outcome) => {
								if (outcome.status === 'rejected') resolve();
							});
						}),
				),
			]);
			await this.stopModules(moduleRuns, recordError);
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

	private stopModule(module: MicroserviceModule): Promise<void> {
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
