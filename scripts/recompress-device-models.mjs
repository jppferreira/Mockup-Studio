#!/usr/bin/env node
/**
 * Recompress device GLBs with meshopt + WebP textures via @gltf-transform/cli.
 *
 *   node scripts/recompress-device-models.mjs [sourceDir] [outDir]
 *
 * Defaults: source=/tmp/mokstudio-gh-pages/app/models out=./.model-library/models-meshopt
 */
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const sourceDir = path.resolve(process.argv[2] || '/tmp/mokstudio-gh-pages/app/models');
const outDir = path.resolve(process.argv[3] || path.join(process.cwd(), '.model-library/models-meshopt'));

await mkdir(outDir, { recursive: true });
const entries = (await readdir(sourceDir)).filter((name) => name.toLowerCase().endsWith('.glb')).sort();
if (!entries.length) {
  console.error(`No .glb files in ${sourceDir}`);
  process.exit(1);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

let before = 0;
let after = 0;
for (const name of entries) {
  const input = path.join(sourceDir, name);
  const output = path.join(outDir, name);
  const inSize = (await stat(input)).size;
  before += inSize;
  console.log(`\n=== ${name} (${(inSize / 1e6).toFixed(2)} MB) ===`);
  await run('npx', [
    '--yes',
    '@gltf-transform/cli@4.1.1',
    'optimize',
    input,
    output,
    '--compress',
    'meshopt',
    '--texture-compress',
    'webp',
  ]);
  const outSize = (await stat(output)).size;
  after += outSize;
  console.log(`${name}: ${(inSize / 1e6).toFixed(2)} MB → ${(outSize / 1e6).toFixed(2)} MB (${Math.round((100 * outSize) / inSize)}%)`);
}

console.log(`\nDone ${entries.length} models: ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB (${Math.round((100 * after) / before)}%)`);
console.log(`Output: ${outDir}`);
