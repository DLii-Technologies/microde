import { describe, expect, it } from 'vitest';

import { Microservice, MicroserviceState } from '@microde/microservice';

import { PassiveModule } from './fixtures/passive-module.js';
import { ActiveModule } from './fixtures/active-module.js';

describe('Microservice', () => {
	it('runs to successful completion when no modules are installed', async () => {
		const microservice = new Microservice();

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 0,
		});
	});

	it('installs a module through a factory', () => {
		const microservice = new Microservice();

		const installedModule = microservice.install((instance) => {
			return new PassiveModule(instance, []);
		});

		expect(installedModule).toBeInstanceOf(PassiveModule);
		expect(installedModule.microservice).toBe(microservice);
	});

	it('runs modules in installation order and tears them down in reverse order', async () => {
		const events: string[] = [];
		const microservice = new Microservice();

		const install = (name: string) => {
			microservice.install((instance) => {
				events.push(`${name}:create`);
				return new PassiveModule(instance, events, name);
			});
		};

		install('first');
		install('second');

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 0,
		});
		expect(events).toEqual([
			'first:create',
			'second:create',
			'first:initialize',
			'second:initialize',
			'first:setup',
			'second:setup',
			'first:run',
			'second:run',
			'second:teardown',
			'first:teardown',
			'second:shutdown',
			'first:shutdown',
			'second:cleanup',
			'first:cleanup',
		]);
	});

	it('runs a passive module and exits cleanly', async () => {
		const events: string[] = [];

		const microservice = new Microservice();
		microservice.install((instance) => {
			return new PassiveModule(instance, events);
		});

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 0,
		});
		expect(microservice.state).toBe(MicroserviceState.Finished);
		expect(events).toEqual([
			'initialize',
			'setup',
			'run',
			'teardown',
			'shutdown',
			'cleanup',
		]);
	});

	it('runs an active module and exits cleanly', async () => {
		const events: string[] = [];

		const microservice = new Microservice();
		microservice.install((instance) => {
			return new ActiveModule(instance, events);
		});

		await expect(microservice.run()).resolves.toEqual({
			exitCode: 0,
		});
		expect(microservice.state).toBe(MicroserviceState.Finished);
		expect(events).toEqual([
			'initialize',
			'setup',
			'run',
			'teardown',
			'shutdown',
			'cleanup',
		]);
	});
});
