/**
 * Bake dark-mode clay device thumbs (transparent PNG, no product textures).
 *
 * Usage:
 *   VITE_DEV_SERVER_URL=http://127.0.0.1:5175 electron scripts/bake-device-thumbs.cjs [--all] [id ...]
 *
 * Writes to both src/assets/device-thumbs and public/device-thumbs.
 */
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');
const thumbsDirs = [
  path.join(root, 'public/device-thumbs-samples'),
];
const devicesPath = path.join(root, 'src/lib/devices.ts');
const base = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5175';
const argv = process.argv.slice(2);
const forceAll = argv.includes('--all');
const only = argv.filter((a) => a !== '--all');

function parseDevices() {
  const source = fs.readFileSync(devicesPath, 'utf8');
  const start = source.indexOf('export const DEVICE_MODELS');
  const end = source.indexOf('\n];', start);
  const body = source.slice(start, end + 3);
  const entries = [];
  // Split on top-level device objects so procedural entries can't steal the next url.
  const chunks = body.split(/\n  \{\n/).slice(1);
  for (const chunk of chunks) {
    const id = chunk.match(/^\s*id:\s*'([^']+)'/)?.[1];
    const kind = chunk.match(/\bkind:\s*'([^']+)'/)?.[1];
    const url = chunk.match(/\burl:\s*'(\.\/models\/[^']+)'/)?.[1];
    const rotRaw = chunk.match(/\brot:\s*\[([^\]]+)\]/)?.[1];
    if (!id || kind !== 'gltf' || !url || !rotRaw) continue;
    const rot = rotRaw.split(',').map((s) => s.trim()).map((e) => {
      if (e === '0') return 0;
      return Function(`"use strict"; return (${e});`)();
    });
    entries.push({ id, url, rot });
  }
  // listedVariant('sourceId', 'variantId', ...) — copy clay thumb from source after bake
  const variants = [];
  const vre = /listedVariant\(\s*'([^']+)'\s*,\s*'([^']+)'/g;
  let m;
  while ((m = vre.exec(source))) {
    variants.push({ sourceId: m[1], id: m[2] });
  }
  return { entries, variants };
}

function queueEntries() {
  const { entries, variants } = parseDevices();
  let bake = entries;
  if (only.length) bake = entries.filter((entry) => only.includes(entry.id));
  else if (!forceAll) {
    const have = new Set(
      fs.readdirSync(thumbsDirs[0])
        .filter((f) => /\.(png|webp|jpe?g)$/i.test(f))
        .map((f) => f.replace(/\.(png|webp|jpe?g)$/i, '')),
    );
    bake = entries.filter((entry) => !have.has(entry.id));
  }
  return { bake, variants: forceAll || only.length === 0 ? variants : variants.filter((v) => only.includes(v.id)) };
}

function copyVariantThumbs(variants) {
  let copied = 0;
  for (const { sourceId, id } of variants) {
    const src = path.join(thumbsDirs[0], `${sourceId}.png`);
    if (!fs.existsSync(src)) {
      console.error(`✗ variant ${id}: missing source ${sourceId}.png`);
      continue;
    }
    const buf = fs.readFileSync(src);
    for (const dir of thumbsDirs) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${id}.png`), buf);
    }
    copied += 1;
    console.log(`⇢ ${id} ← ${sourceId}`);
  }
  return copied;
}

async function bakeOne(win, entry) {
  const rot = entry.rot.map((n) => Number(n) || 0).join(',');
  const target = `${base}/bake-device-thumbs.html?id=${encodeURIComponent(entry.id)}&url=${encodeURIComponent(entry.url)}&rot=${encodeURIComponent(rot)}`;
  await win.loadURL(target);
  const value = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const thumb = window.__thumb || {};
        if (thumb.error) return resolve({ error: String(thumb.error) });
        if (thumb.ready && thumb.dataUrl) return resolve({ dataUrl: thumb.dataUrl });
        if (Date.now() - start > 60000) return resolve({ error: 'timeout' });
        setTimeout(tick, 200);
      };
      tick();
    })
  `);
  if (value?.error) throw new Error(value.error);
  if (!value?.dataUrl?.startsWith('data:')) throw new Error('no dataUrl');
  const buf = Buffer.from(value.dataUrl.split(',')[1], 'base64');
  for (const dir of thumbsDirs) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${entry.id}.png`), buf);
  }
  return buf.length;
}

app.whenReady().then(async () => {
  const { bake, variants } = queueEntries();
  if (!bake.length && !variants.length) {
    console.log('Nothing to bake. Pass --all to rebuild every device.');
    app.quit();
    return;
  }
  console.log(`Baking ${bake.length} clay thumbs from ${base}`);
  const win = new BrowserWindow({
    width: 1100,
    height: 1100,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  let ok = 0;
  for (const entry of bake) {
    try {
      const bytes = await bakeOne(win, entry);
      ok += 1;
      console.log(`✓ ${entry.id} (${Math.round(bytes / 1024)}kb)`);
    } catch (error) {
      console.error(`✗ ${entry.id}:`, error instanceof Error ? error.message : error);
    }
  }
  const copied = copyVariantThumbs(variants);
  console.log(`Done. ${ok}/${bake.length} baked, ${copied} variants copied.`);
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
