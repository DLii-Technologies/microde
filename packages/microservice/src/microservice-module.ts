import type { Microservice } from './microservice.js';

export abstract class MicroserviceModule {
	constructor(public readonly microservice: Microservice) {}

	abstract initialize(): Promise<void>;

	abstract setup(): Promise<void>;

	abstract run(): Promise<void>;

	abstract teardown(): Promise<void>;

	abstract shutdown(): Promise<void>;

	abstract cleanup(): Promise<void>;
}

export abstract class PassiveMicroserviceModule extends MicroserviceModule {}

export abstract class ActiveMicroserviceModule extends MicroserviceModule {
	abstract stop(): Promise<void>;
}
