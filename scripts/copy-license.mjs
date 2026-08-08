import { cp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptsDirectory, '..');
const packageRoot = process.cwd();

await cp(resolve(workspaceRoot, 'LICENSE'), resolve(packageRoot, 'LICENSE'));
