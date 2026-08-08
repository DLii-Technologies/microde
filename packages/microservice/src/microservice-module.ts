import type { Microservice } from './microservice.js';

export abstract class MicroserviceModule {
	constructor(public readonly microservice: Microservice) {}

	abstract initialize(): Promise<void>;

	abstract setup(): Promise<void>;

	abstract run(): Promise<void> | undefined;

	abstract teardown(): Promise<void>;

	abstract shutdown(): Promise<void>;

	abstract cleanup(): Promise<void>;
}
