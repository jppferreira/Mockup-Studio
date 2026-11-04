/**
 * Android USB screen mirror via ADB screencap.
 *
 * Prototype strategy (prioritised for Pixel + Samsung):
 * - Live preview: repeated `adb exec-out screencap -p`, downscaled JPEG over IPC
 * - Snapshot: full-resolution PNG data URL
 *
 * Requires platform-tools `adb` on PATH (or Android SDK), USB debugging enabled,
 * and the Mac authorised on the phone. Tested first against Samsung SM-S928B (S24 Ultra).
 */

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { nativeImage } = require('electron');

const PREFERRED_BRANDS = ['google', 'samsung', 'pixel'];
const LIVE_MAX_WIDTH = 720;
const LIVE_JPEG_QUALITY = 62;
const LIVE_MIN_INTERVAL_MS = 350;

/** @type {{ serial: string, timer: NodeJS.Timeout | null, running: boolean, inFlight: boolean, sender: Electron.WebContents | null } | null} */
let session = null;

function execFileAsync(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 40 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr && String(stderr).trim()) || err.message;
        reject(new Error(detail));
        return;
      }
      resolve(stdout);
    });
  });
}

function candidateAdbPaths() {
  const home = process.env.HOME || '';
  return [
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb'),
    process.env.ANDROID_SDK_ROOT && path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb'),
    home && path.join(home, 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
    '/opt/homebrew/bin/adb',
    '/usr/local/bin/adb',
    'adb',
  ].filter(Boolean);
}

let resolvedAdb = null;

async function resolveAdb() {
  if (resolvedAdb) return resolvedAdb;
  for (const candidate of candidateAdbPaths()) {
    try {
      if (candidate !== 'adb' && !fs.existsSync(candidate)) continue;
      await execFileAsync(candidate, ['version']);
      resolvedAdb = candidate;
      return candidate;
    } catch {
      /* try next */
    }
  }
  throw new Error(
    'Android Debug Bridge (adb) was not found. Install Android platform-tools (e.g. brew install android-platform-tools), enable USB debugging on the phone, then retry.',
  );
}

/**
 * Rank devices for Mirror auto-pick.
 * 0 = Pixel / Google, 1 = Samsung, 2 = everything else.
 * Matches real getprop values: manufacturer "Google", brand "google",
 * model "Pixel 8 Pro", and adb devices -l model:Pixel_8_Pro.
 */
function brandPriority(manufacturer = '', model = '', brand = '', product = '') {
  const hay = `${manufacturer} ${brand} ${model} ${product}`.toLowerCase().replace(/_/g, ' ');
  if (/\b(google|pixel)\b/.test(hay)) return 0;
  // Common Pixel product codenames when model label is missing from `adb devices -l`
  if (/\b(husky|shiba|akita|tokay|caiman|komodo|felix|lynx|panther|cheetah|oriole|raven|bluejay|ripcurrent|tangorpro)\b/.test(hay)) {
    return 0;
  }
  if (/\bsamsung\b/.test(hay) || /\bsm[- ]?[a-z]?\d/i.test(model) || /\bgalaxy\b/.test(hay)) return 1;
  return 2;
}

function friendlyLabel(manufacturer, model, serial) {
  const mfr = (manufacturer || '').trim();
  const mod = (model || '').trim();
  if (mfr && mod) return `${mfr} ${mod}`;
  if (mod) return mod;
  return serial;
}

async function getprop(adb, serial, key) {
  try {
    const out = await execFileAsync(adb, ['-s', serial, 'shell', 'getprop', key]);
    return String(out || '').trim();
  } catch {
    return '';
  }
}

async function listAndroidDevices() {
  const adb = await resolveAdb();
  const out = await execFileAsync(adb, ['devices', '-l']);
  const lines = String(out).split('\n').slice(1);
  const devices = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const serial = parts[0];
    const state = parts[1];
    if (!serial || serial === 'List') continue;

    const modelFromList = (trimmed.match(/\bmodel:(\S+)/) || [])[1] || '';
    const productFromList = (trimmed.match(/\bproduct:(\S+)/) || [])[1] || '';

    let manufacturer = '';
    let brand = '';
    let model = modelFromList.replace(/_/g, ' ');
    let release = '';
    let sdk = '';
    let preferred = false;
    let brandRank = 2;

    if (state === 'device') {
      manufacturer = await getprop(adb, serial, 'ro.product.manufacturer');
      brand = await getprop(adb, serial, 'ro.product.brand');
      model = (await getprop(adb, serial, 'ro.product.model')) || model;
      release = await getprop(adb, serial, 'ro.build.version.release');
      sdk = await getprop(adb, serial, 'ro.build.version.sdk');
      brandRank = brandPriority(manufacturer, model, brand, productFromList);
      preferred = brandRank < 2;
    } else {
      brandRank = brandPriority('', modelFromList.replace(/_/g, ' '), '', productFromList);
      preferred = brandRank < 2;
    }

    devices.push({
      serial,
      state,
      manufacturer,
      brand,
      model,
      product: productFromList,
      release,
      sdk,
      label: state === 'device'
        ? friendlyLabel(manufacturer || brand, model, serial)
        : `${serial} (${state})`,
      preferred,
      brandRank,
    });
  }

  devices.sort((a, b) => {
    if (a.state !== b.state) return a.state === 'device' ? -1 : 1;
    if (a.brandRank !== b.brandRank) return a.brandRank - b.brandRank;
    return a.label.localeCompare(b.label);
  });

  return { adb, devices };
}

function isPng(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length > 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47;
}

function screencap(adb, serial) {
  return new Promise((resolve, reject) => {
    const child = spawn(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    const errChunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => errChunks.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      const buffer = Buffer.concat(chunks);
      if (code !== 0 || !isPng(buffer)) {
        const errText = Buffer.concat(errChunks).toString('utf8').trim();
        reject(new Error(errText || `screencap failed (code ${code})`));
        return;
      }
      resolve(buffer);
    });
  });
}

function pngToLiveJpeg(pngBuffer) {
  const image = nativeImage.createFromBuffer(pngBuffer);
  if (image.isEmpty()) throw new Error('Could not decode Android screencap');
  const { width, height } = image.getSize();
  let next = image;
  if (width > LIVE_MAX_WIDTH) {
    const scaledH = Math.max(1, Math.round((height * LIVE_MAX_WIDTH) / width));
    next = image.resize({ width: LIVE_MAX_WIDTH, height: scaledH, quality: 'better' });
  }
  return {
    jpeg: next.toJPEG(LIVE_JPEG_QUALITY),
    width: next.getSize().width,
    height: next.getSize().height,
    sourceWidth: width,
    sourceHeight: height,
  };
}

async function captureLiveFrame(adb, serial) {
  const png = await screencap(adb, serial);
  const live = pngToLiveJpeg(png);
  return {
    mime: 'image/jpeg',
    base64: live.jpeg.toString('base64'),
    width: live.width,
    height: live.height,
    sourceWidth: live.sourceWidth,
    sourceHeight: live.sourceHeight,
  };
}

async function captureSnapshot(serial) {
  const adb = await resolveAdb();
  const png = await screencap(adb, serial);
  return {
    mime: 'image/png',
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    byteLength: png.length,
  };
}

function stopAndroidMirrorSession() {
  if (!session) return { stopped: true };
  session.running = false;
  if (session.timer) {
    clearTimeout(session.timer);
    session.timer = null;
  }
  const serial = session.serial;
  session = null;
  return { stopped: true, serial };
}

async function startAndroidMirrorSession(webContents, serial) {
  stopAndroidMirrorSession();
  const { adb, devices } = await listAndroidDevices();
  const ready = devices.filter((d) => d.state === 'device');
  if (!ready.length) {
    throw new Error(
      'No Android device ready. Plug in a Pixel or Samsung over USB, enable USB debugging, and accept the RSA prompt.',
    );
  }

  const preferredReady = ready.filter((d) => d.preferred);
  const pool = preferredReady.length ? preferredReady : ready;
  const selected = serial
    ? ready.find((d) => d.serial === serial) || pool[0]
    : pool[0];

  if (!selected || selected.state !== 'device') {
    throw new Error('Selected Android device is not authorised. Unlock the phone and allow USB debugging.');
  }

  session = {
    serial: selected.serial,
    timer: null,
    running: true,
    inFlight: false,
    sender: webContents,
  };

  const tick = async () => {
    if (!session || !session.running || session.serial !== selected.serial) return;
    if (session.inFlight) {
      session.timer = setTimeout(tick, LIVE_MIN_INTERVAL_MS);
      return;
    }
    session.inFlight = true;
    const started = Date.now();
    try {
      const frame = await captureLiveFrame(adb, selected.serial);
      if (session && session.running && session.serial === selected.serial && !webContents.isDestroyed()) {
        webContents.send('android:mirrorFrame', {
          serial: selected.serial,
          ...frame,
        });
      }
    } catch (err) {
      if (session && session.running && session.serial === selected.serial && !webContents.isDestroyed()) {
        webContents.send('android:mirrorError', {
          serial: selected.serial,
          message: err instanceof Error ? err.message : 'Android mirror frame failed',
        });
      }
      stopAndroidMirrorSession();
      return;
    } finally {
      if (session && session.serial === selected.serial) session.inFlight = false;
    }
    if (!session || !session.running) return;
    const elapsed = Date.now() - started;
    const wait = Math.max(80, LIVE_MIN_INTERVAL_MS - elapsed);
    session.timer = setTimeout(tick, wait);
  };

  // Kick first frame immediately.
  void tick();

  return {
    serial: selected.serial,
    label: selected.label,
    manufacturer: selected.manufacturer,
    model: selected.model,
    release: selected.release,
    preferred: selected.preferred,
    brandRank: selected.brandRank,
  };
}

function registerAndroidMirrorIpc(ipcMain) {
  ipcMain.handle('android:status', async () => {
    try {
      const { adb, devices } = await listAndroidDevices();
      return {
        ok: true,
        adb,
        devices,
        mirroringSerial: session?.serial || null,
      };
    } catch (err) {
      return {
        ok: false,
        adb: null,
        devices: [],
        mirroringSerial: session?.serial || null,
        error: err instanceof Error ? err.message : 'ADB unavailable',
      };
    }
  });

  ipcMain.handle('android:startMirror', async (event, { serial } = {}) => {
    const device = await startAndroidMirrorSession(event.sender, serial);
    return { ok: true, device };
  });

  ipcMain.handle('android:stopMirror', async () => stopAndroidMirrorSession());

  ipcMain.handle('android:snapshot', async (_event, { serial } = {}) => {
    const target = serial || session?.serial;
    if (!target) {
      const { devices } = await listAndroidDevices();
      const preferred = devices.find((d) => d.state === 'device' && d.preferred) || devices.find((d) => d.state === 'device');
      if (!preferred) {
        throw new Error('No Android device available for snapshot');
      }
      return captureSnapshot(preferred.serial);
    }
    return captureSnapshot(target);
  });
}

module.exports = {
  registerAndroidMirrorIpc,
  stopAndroidMirrorSession,
  listAndroidDevices,
  brandPriority,
  PREFERRED_BRANDS,
};
