import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
	ActiveMicroserviceModule,
	Microservice,
	type MicroserviceContext,
	ModuleKind,
	PassiveMicroserviceModule,
} from '@microde/microservice';

describe('Microservice Modules', () => {
	it('depends only on the microservice context contract', () => {
		const context: MicroserviceContext = {
			requestStop: vi.fn(),
			panic: vi.fn(() => {
				throw new Error('panic');
			}),
		};
		const module = new (class extends PassiveMicroserviceModule {
			usesContext(candidate: MicroserviceContext): boolean {
				return this.context === candidate;
			}

			requestStop(): void {
				this.context.requestStop({ exitCode: 2 });
			}
		})(context);

		expect(module.usesContext(context)).toBe(true);
		module.requestStop();
		// @ts-expect-error Context is available to subclasses, not consumers.
		module.context;
		expect(context.requestStop).toHaveBeenCalledWith({ exitCode: 2 });
		expect(module.kind).toBe(ModuleKind.Passive);
	});

	it('keeps orchestration APIs out of installation contexts', () => {
		type Factory = Parameters<Microservice['install']>[0];
		const factory: Factory = (context) => {
			// @ts-expect-error Module contexts cannot install modules.
			context.install;
			// @ts-expect-error Module contexts cannot run the service.
			context.run;
			// @ts-expect-error Module contexts cannot await the public stop API.
			context.stop;
			// @ts-expect-error Module contexts cannot inspect global state.
			context.state;
			return new (class extends PassiveMicroserviceModule {})(context);
		};

		expectTypeOf(factory).toMatchTypeOf<Factory>();
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
		const module = microservice.install(
			(instance) =>
				new (class extends ActiveMicroserviceModule {
					async run(): Promise<void> {}

					async stop(): Promise<void> {}
				})(instance),
		);

		await expect(microservice.run()).resolves.toEqual({ exitCode: 0 });
		expect(module.kind).toBe(ModuleKind.Active);
	});
});
