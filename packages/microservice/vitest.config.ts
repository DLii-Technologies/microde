import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			'@microde/microservice': fileURLToPath(
				new URL('./src', import.meta.url),
			),
		},
	},

	test: {
		name: '@microde/microservice',
	},
});
