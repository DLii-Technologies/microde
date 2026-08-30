import { rm } from 'node:fs/promises';

await rm(new URL('../packages/application/dist', import.meta.url), {
	force: true,
	recursive: true,
});
