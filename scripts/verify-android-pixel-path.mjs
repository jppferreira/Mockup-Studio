/**
 * Verify Android Mirror Pixel/Google handling without a physical Pixel.
 * Also re-checks the live Samsung device if one is authorised.
 *
 * Usage: node scripts/verify-android-pixel-path.mjs
 */
import { createRequire } from 'node:module';
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// brandPriority is pure — load without initializing Electron IPC.
const androidMirrorPath = path.join(__dirname, '../electron/androidMirror.cjs');
let brandPriority;
try {
  // electron nativeImage import fails outside Electron; extract via vm of the function source instead.
  const src = await fs.readFile(androidMirrorPath, 'utf8');
  const match = src.match(/function brandPriority\([\s\S]*?\n\}/);
  if (!match) throw new Error('brandPriority not found');
  // eslint-disable-next-line no-new-func
  brandPriority = new Function(`${match[0]}; return brandPriority;`)();
} catch (err) {
  console.error('Could not load brandPriority:', err.message);
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const cases = [
  // Real-ish Pixel getprop / adb devices -l shapes
  { name: 'Pixel 9 Pro (Google manufacturer)', args: ['Google', 'Pixel 9 Pro', 'google', 'caiman'], expect: 0 },
  { name: 'Pixel 8 (brand only)', args: ['', 'Pixel 8', 'google', 'shiba'], expect: 0 },
  { name: 'Pixel 7a model list form', args: ['', 'Pixel_7a', '', 'lynx'], expect: 0 },
  { name: 'Pixel tablet', args: ['Google', 'Pixel Tablet', 'google', 'tangorpro'], expect: 0 },
  { name: 'Pixel codename only (husky)', args: ['', '', '', 'husky'], expect: 0 },
  // Samsung
  { name: 'Samsung S24 Ultra', args: ['samsung', 'SM-S928B', 'samsung', 'e3qxeea'], expect: 1 },
  { name: 'Galaxy model text', args: ['samsung', 'Galaxy S23', 'samsung', ''], expect: 1 },
  // Other
  { name: 'OnePlus', args: ['OnePlus', 'CPH2449', 'OnePlus', ''], expect: 2 },
  { name: 'Xiaomi', args: ['Xiaomi', '23078PND5G', 'Xiaomi', ''], expect: 2 },
];

console.log('=== Pixel / brandPriority unit checks ===');
for (const item of cases) {
  const rank = brandPriority(...item.args);
  assert(rank === item.expect, `${item.name}: expected ${item.expect}, got ${rank}`);
  console.log(`PASS  rank=${rank}  ${item.name}`);
}

// Simulated multi-device sort: Pixel must win over Samsung and OnePlus
const simulated = [
  { serial: 'OP1', manufacturer: 'OnePlus', brand: 'OnePlus', model: 'CPH2449', product: '', state: 'device' },
  { serial: 'SAM1', manufacturer: 'samsung', brand: 'samsung', model: 'SM-S928B', product: 'e3q', state: 'device' },
  { serial: 'PIX1', manufacturer: 'Google', brand: 'google', model: 'Pixel 8 Pro', product: 'husky', state: 'device' },
].map((d) => ({
  ...d,
  brandRank: brandPriority(d.manufacturer, d.model, d.brand, d.product),
  preferred: brandPriority(d.manufacturer, d.model, d.brand, d.product) < 2,
  label: `${d.manufacturer} ${d.model}`,
}));

simulated.sort((a, b) => {
  if (a.state !== b.state) return a.state === 'device' ? -1 : 1;
  if (a.brandRank !== b.brandRank) return a.brandRank - b.brandRank;
  return a.label.localeCompare(b.label);
});

assert(simulated[0].serial === 'PIX1', `Expected Pixel first, got ${simulated[0].serial}`);
assert(simulated[1].serial === 'SAM1', `Expected Samsung second, got ${simulated[1].serial}`);
assert(simulated[2].serial === 'OP1', `Expected OnePlus third, got ${simulated[2].serial}`);
console.log('PASS  multi-device sort → Pixel, Samsung, OnePlus');

const preferredReady = simulated.filter((d) => d.state === 'device' && d.preferred);
const autoPick = preferredReady[0];
assert(autoPick.serial === 'PIX1', 'Auto-pick should choose Pixel when Pixel + Samsung are both ready');
console.log('PASS  auto-pick prefers Pixel over Samsung');

// Live hardware: Samsung regression + note if Pixel absent
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
    const errs = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => errs.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      const buf = Buffer.concat(chunks);
      if (code !== 0 || buf[0] !== 0x89) reject(new Error(Buffer.concat(errs).toString('utf8') || `screencap ${code}`));
      else resolve(buf);
    });
  });
}

console.log('\n=== Connected USB devices ===');
const adb = String(await execFileAsync('which', ['adb'])).trim();
const out = String(await execFileAsync(adb, ['devices', '-l']));
const lines = out.split('\n').slice(1).filter((l) => l.trim());
const live = [];
for (const line of lines) {
  const parts = line.trim().split(/\s+/);
  const serial = parts[0];
  const state = parts[1];
  if (!serial || state !== 'device') {
    if (serial && state) console.log(`SKIP  ${serial} state=${state}`);
    continue;
  }
  const manufacturer = String(await execFileAsync(adb, ['-s', serial, 'shell', 'getprop', 'ro.product.manufacturer'])).trim();
  const brand = String(await execFileAsync(adb, ['-s', serial, 'shell', 'getprop', 'ro.product.brand'])).trim();
  const model = String(await execFileAsync(adb, ['-s', serial, 'shell', 'getprop', 'ro.product.model'])).trim();
  const release = String(await execFileAsync(adb, ['-s', serial, 'shell', 'getprop', 'ro.build.version.release'])).trim();
  const product = (line.match(/\bproduct:(\S+)/) || [])[1] || '';
  const rank = brandPriority(manufacturer, model, brand, product);
  const t0 = Date.now();
  const png = await screencap(adb, serial);
  const ms = Date.now() - t0;
  const result = {
    serial,
    manufacturer,
    brand,
    model,
    release,
    product,
    brandRank: rank,
    preferred: rank < 2,
    isPixel: rank === 0,
    isSamsung: rank === 1,
    screencapBytes: png.length,
    screencapMs: ms,
    pngOk: png[0] === 0x89,
  };
  live.push(result);
  console.log(
    `${result.pngOk ? 'PASS' : 'FAIL'}  ${manufacturer} ${model} · Android ${release} · rank=${rank} · ${ms}ms · ${png.length} bytes`,
  );
}

const pixels = live.filter((d) => d.isPixel);
const samsungs = live.filter((d) => d.isSamsung);

console.log('\n=== Summary ===');
console.log(`Physical Pixels tested: ${pixels.length}`);
console.log(`Physical Samsungs tested: ${samsungs.length}`);
if (!pixels.length) {
  console.log('NOTE  No Pixel USB device connected. Pixel path verified via unit/simulation only.');
  console.log('NOTE  Pixel uses the same ADB screencap -p path as Samsung (API 21+); no Pixel-only capture API.');
}
if (samsungs.length) {
  console.log('NOTE  Samsung live screencap still OK (regression).');
}

await fs.mkdir(path.join(__dirname, '../release'), { recursive: true });
await fs.writeFile(
  path.join(__dirname, '../release/android-pixel-path-verify.json'),
  JSON.stringify({ casesPassed: cases.length, simulatedOrder: simulated.map((d) => d.serial), live }, null, 2),
);
console.log('Wrote release/android-pixel-path-verify.json');
