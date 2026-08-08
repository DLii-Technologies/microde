import { rm } from 'node:fs/promises';

await rm(new URL('../docs/api-reference', import.meta.url), {
	force: true,
	recursive: true,
});
