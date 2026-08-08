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
		await Promise.all(this.modules.map((module) => module.initialize()));

		this.state = MicroserviceState.Setup;
		await Promise.all(this.modules.map((module) => module.setup()));

		this.state = MicroserviceState.Running;
		const activeRuns = this.modules
			.map((module) => module.run())
			.filter((run): run is Promise<void> => run !== undefined);

		if (activeRuns.length > 0) {
			await Promise.race(activeRuns);
		}

		this.state = MicroserviceState.TearDown;
		await Promise.all(this.modules.map((module) => module.teardown()));

		this.state = MicroserviceState.Shutdown;
		await Promise.all(this.modules.map((module) => module.shutdown()));

		this.state = MicroserviceState.CleanUp;
		await Promise.all(this.modules.map((module) => module.cleanup()));

		this.state = MicroserviceState.Finished;
		return { exitCode: 0 };
	}
}
