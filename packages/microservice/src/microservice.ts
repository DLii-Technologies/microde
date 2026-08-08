import type { MicroserviceModule } from './microservice-module.js';

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
	private readonly modules: MicroserviceModule[] = [];

	public state = MicroserviceState.Idle;

	install(
		factory: (microservice: Microservice) => MicroserviceModule,
	): MicroserviceModule {
		const module = factory(this);
		this.modules.push(module);
		return module;
	}

	async run(): Promise<MicroserviceExecutionResult> {
		this.state = MicroserviceState.Initialization;
		await this.initializeModules();

		this.state = MicroserviceState.Setup;
		await this.setupModules();

		this.state = MicroserviceState.Running;
		await this.executeModules();

		this.state = MicroserviceState.TearDown;
		await this.teardownModules();

		this.state = MicroserviceState.Shutdown;
		await this.shutdownModules();

		this.state = MicroserviceState.CleanUp;
		await this.cleanupModules();

		this.state = MicroserviceState.Finished;
		return { exitCode: 0 };
	}

	private async initializeModules(): Promise<void> {
		for (const module of this.modules) {
			await module.initialize();
		}
	}

	private async setupModules(): Promise<void> {
		for (const module of this.modules) {
			await module.setup();
		}
	}

	private async executeModules(): Promise<void> {
		for (const module of this.modules) {
			await module.run();
		}
	}

	private async teardownModules(): Promise<void> {
		for (let index = this.modules.length - 1; index >= 0; index--) {
			await this.modules[index].teardown();
		}
	}

	private async shutdownModules(): Promise<void> {
		for (let index = this.modules.length - 1; index >= 0; index--) {
			await this.modules[index].shutdown();
		}
	}

	private async cleanupModules(): Promise<void> {
		for (let index = this.modules.length - 1; index >= 0; index--) {
			await this.modules[index].cleanup();
		}
	}
}
