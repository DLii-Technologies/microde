import { PassiveModule } from './passive-module.js';

export class ActiveModule extends PassiveModule {
	override async run(): Promise<void> {
		this.record('run');
	}
}
