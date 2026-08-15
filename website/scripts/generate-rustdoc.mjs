import { cp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(websiteRoot, '..');

await new Promise((resolvePromise, reject) => {
	const cargo = spawn(
		'cargo',
		['doc', '-p', 'microde-microservice', '--no-deps'],
		{
			cwd: repositoryRoot,
			stdio: 'inherit',
		},
	);
	cargo.once('error', reject);
	cargo.once('close', (code) => {
		if (code === 0) resolvePromise();
		else reject(new Error(`cargo doc exited with status ${code}`));
	});
});

await cp(
	resolve(repositoryRoot, 'target/doc/microde_microservice'),
	resolve(websiteRoot, 'static/rustdoc'),
	{ recursive: true },
);
