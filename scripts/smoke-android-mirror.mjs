/**
 * Smoke-test Android ADB mirror against a connected Pixel/Samsung.
 * Usage: node scripts/smoke-android-mirror.mjs
 * (Uses system adb; does not need Electron UI.)
 */
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '../release');

function execFileAsync(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 40 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr && String(stderr).trim()) || err.message));
      else resolve(stdout);
    });
  });
}

function screencap(adb, serial) {
  return new Promise((resolve, reject) => {
    const child = spawn(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    const errChunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => errChunks.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      const buffer = Buffer.concat(chunks);
      if (code !== 0 || buffer[0] !== 0x89) {
        reject(new Error(Buffer.concat(errChunks).toString('utf8') || `screencap failed (${code})`));
        return;
      }
      resolve(buffer);
    });
  });
}

function brandRank(manufacturer, model) {
  const hay = `${manufacturer} ${model}`.toLowerCase();
  if (/\b(google|pixel)\b/.test(hay)) return 0;
  if (/\bsamsung\b/.test(hay) || /\bsm[-_]/.test(model.toLowerCase())) return 1;
  return 2;
}

const adb = (await execFileAsync('which', ['adb'])).toString().trim() || 'adb';
const devicesOut = await execFileAsync(adb, ['devices', '-l']);
const lines = String(devicesOut).split('\n').slice(1).filter((l) => l.trim());
const devices = [];
for (const line of lines) {
  const parts = line.trim().split(/\s+/);
  const serial = parts[0];
  const state = parts[1];
  if (!serial || state !== 'device') continue;
  const manufacturer = String(await execFileAsync(adb, ['-s', serial, 'shell', 'getprop', 'ro.product.manufacturer'])).trim();
  const model = String(await execFileAsync(adb, ['-s', serial, 'shell', 'getprop', 'ro.product.model'])).trim();
  const release = String(await execFileAsync(adb, ['-s', serial, 'shell', 'getprop', 'ro.build.version.release'])).trim();
  devices.push({ serial, manufacturer, model, release, brandRank: brandRank(manufacturer, model) });
}
devices.sort((a, b) => a.brandRank - b.brandRank || a.model.localeCompare(b.model));

if (!devices.length) {
  console.error('No authorised Android device found.');
  process.exit(1);
}

const preferred = devices.filter((d) => d.brandRank < 2);
const selected = (preferred[0] || devices[0]);
console.log('Selected:', `${selected.manufacturer} ${selected.model}`, `(Android ${selected.release})`, selected.serial);
console.log('Priority pool:', preferred.map((d) => d.model).join(', ') || '(none — falling back)');

const t0 = Date.now();
const png = await screencap(adb, selected.serial);
const ms = Date.now() - t0;
await fs.mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, `android-mirror-smoke-${selected.model.replace(/\W+/g, '_')}.png`);
await fs.writeFile(outPath, png);
console.log(`Snapshot OK · ${png.length} bytes · ${ms}ms`);
console.log(`Wrote ${outPath}`);
