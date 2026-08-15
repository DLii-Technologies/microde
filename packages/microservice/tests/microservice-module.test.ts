import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
	ActiveMicroserviceModule,
	Microservice,
	type MicroserviceContext,
	PassiveMicroserviceModule,
} from '@microde/microservice';

describe('Microservice Modules', () => {
	it('depends only on the microservice context contract', () => {
		const context: MicroserviceContext = {
			stop: vi.fn(() => Promise.resolve({ exitCode: 0 })),
			panic: vi.fn(() => {
				throw new Error('panic');
			}),
		};
		const module = new (class extends PassiveMicroserviceModule {})(
			context,
		);

		expect(module.context).toBe(context);
		expectTypeOf<Microservice>().toExtend<MicroserviceContext>();
	});

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
