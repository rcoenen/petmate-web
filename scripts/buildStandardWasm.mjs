import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const entryFile = resolve(repoRoot, 'wasm', 'truskiiStandardKernel.ts');
const outFile = resolve(repoRoot, 'src', 'utils', 'importers', 'truskiiStandardKernel.wasm');
const ascBinary = resolve(repoRoot, 'node_modules', '.bin', 'asc');

await mkdir(dirname(outFile), { recursive: true });
await execFileAsync(ascBinary, [
  entryFile,
  '-O3',
  '--noAssert',
  '--runtime', 'stub',
  '--enable', 'simd',
  '--outFile', outFile,
]);
