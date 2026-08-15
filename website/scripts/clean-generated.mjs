import { rm } from 'node:fs/promises';

await rm(new URL('../docs/api-reference', import.meta.url), {
	force: true,
	recursive: true,
});

// Remove Rustdoc output from older builds now that Rust examples are rendered
// directly in the Docusaurus Markdown pages.
await rm(new URL('../static/rustdoc', import.meta.url), {
	force: true,
	recursive: true,
});
