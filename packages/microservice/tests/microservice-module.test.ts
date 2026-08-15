import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
	Microservice,
	type MicroserviceContext,
	MicroserviceModule,
	ModuleKind,
} from '@microde/microservice';

class NoOpModule extends MicroserviceModule {
	readonly kind = ModuleKind.Passive;
}

describe('Microservice Modules', () => {
	it('depends only on the microservice context contract', () => {
		const context: MicroserviceContext = {
			requestStop: vi.fn(),
			panic: vi.fn(() => {
				throw new Error('panic');
			}),
		};
		const module = new (class extends NoOpModule {
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
			return new NoOpModule(context);
		};

		expectTypeOf(factory).toMatchTypeOf<Factory>();
	});

	it('requires modules to declare their kind and defaults run and stop to no-ops', async () => {
		const microservice = new Microservice();
		const module = microservice.install(
			(context) =>
				new (class extends MicroserviceModule {
					readonly kind = ModuleKind.Active;
				})(context),
		);

		await expect(microservice.run()).resolves.toEqual({ exitCode: 0 });
		expect(module.kind).toBe(ModuleKind.Active);
	});
});
