import { describe, expect, it } from 'vitest';

import {
	ActiveMicroserviceModule,
	Microservice,
	PassiveMicroserviceModule,
} from '@microde/microservice';

describe('Microservice Modules', () => {
	it('provides a default no-op lifecycle for passive modules', async () => {
		const microservice = new Microservice();
		microservice.install(
			(instance) =>
				new (class extends PassiveMicroserviceModule {})(instance),
		);

		await expect(microservice.run()).resolves.toEqual({ exitCode: 0 });
	});

	it('only requires run and stop for active modules', async () => {
		const microservice = new Microservice();
		microservice.install(
			(instance) =>
				new (class extends ActiveMicroserviceModule {
					async run(): Promise<void> {}

					async stop(): Promise<void> {}
				})(instance),
		);

		await expect(microservice.run()).resolves.toEqual({ exitCode: 0 });
	});
});
