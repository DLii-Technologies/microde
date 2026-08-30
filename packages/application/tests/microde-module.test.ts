import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
	MicrodeApplication,
	type MicrodeContext,
	MicrodeModule,
	ModuleKind,
} from '@microde/application';

class NoOpModule extends MicrodeModule {
	readonly kind = ModuleKind.Passive;
}

describe('MicrodeApplication Modules', () => {
	it('depends only on the application context contract', () => {
		const context: MicrodeContext = {
			requestStop: vi.fn(),
			panic: vi.fn(() => {
				throw new Error('panic');
			}),
		};
		const module = new (class extends NoOpModule {
			usesContext(candidate: MicrodeContext): boolean {
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
		type Factory = Parameters<MicrodeApplication['install']>[0];
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
		const application = new MicrodeApplication();
		const module = application.install(
			(context) =>
				new (class extends MicrodeModule {
					readonly kind = ModuleKind.Active;
				})(context),
		);

		await expect(application.serve()).resolves.toEqual({ exitCode: 0 });
		expect(module.kind).toBe(ModuleKind.Active);
	});
});
