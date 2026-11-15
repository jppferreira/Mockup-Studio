/**
 * Convert dropped .blend files to GLB via a local Blender install.
 * Web builds cannot do this — only the desktop shell exposes the IPC.
 */

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const MAX_BLEND_BYTES = 80 * 1024 * 1024;
const CONVERT_TIMEOUT_MS = 180_000;

function execFileAsync(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { maxBuffer: 16 * 1024 * 1024, timeout: CONVERT_TIMEOUT_MS, ...opts },
      (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr && String(stderr).trim())
            || (stdout && String(stdout).trim())
            || err.message;
          reject(new Error(detail));
          return;
        }
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      },
    );
  });
}

function listAppBlenderBinaries() {
  const roots = ['/Applications'];
  const home = process.env.HOME || '';
  if (home) roots.push(path.join(home, 'Applications'));
  const found = [];
  for (const root of roots) {
    let names = [];
    try {
      names = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/^blender/i.test(name) || !name.endsWith('.app')) continue;
      found.push(path.join(root, name, 'Contents', 'MacOS', 'Blender'));
    }
  }
  return found;
}

function candidateBlenderPaths() {
  return [
    process.env.BLENDER_PATH,
    ...listAppBlenderBinaries(),
    '/Applications/Blender.app/Contents/MacOS/Blender',
    '/opt/homebrew/bin/blender',
    '/usr/local/bin/blender',
    'blender',
  ].filter(Boolean);
}

let resolvedBlender = null;

async function resolveBlender() {
  if (resolvedBlender) return resolvedBlender;
  for (const candidate of candidateBlenderPaths()) {
    try {
      if (candidate !== 'blender' && !fs.existsSync(candidate)) continue;
      await execFileAsync(candidate, ['--version'], { timeout: 15_000 });
      resolvedBlender = candidate;
      return candidate;
    } catch {
      /* try next */
    }
  }
  throw new Error(
    'Blender was not found. Install Blender (https://www.blender.org) or set BLENDER_PATH, then drop the .blend again.',
  );
}

function scriptPath() {
  return path.join(__dirname, 'blend-to-glb.py');
}

/** Prevent path traversal when recreating drop-relative texture folders. */
function safeRelativePath(raw, fallbackName) {
  const cleaned = String(raw || fallbackName || 'file').replace(/\\/g, '/');
  const parts = cleaned.split('/').filter((part) => part && part !== '.' && part !== '..');
  const joined = parts.join('/');
  return joined || (fallbackName || 'file');
}

/**
 * Place a sidecar next to the .blend, preserving relative folders from the drop
 * so Blender `//textures/...` links still resolve.
 */
async function writeSidecar(tmpRoot, blendRelDir, sidecar) {
  const fileName = typeof sidecar?.fileName === 'string' ? sidecar.fileName : '';
  const dataBase64 = typeof sidecar?.dataBase64 === 'string' ? sidecar.dataBase64 : '';
  if (!fileName || !dataBase64) return 0;
  let bytes;
  try {
    bytes = Buffer.from(dataBase64, 'base64');
  } catch {
    return 0;
  }
  if (!bytes.length) return 0;

  const relRaw = typeof sidecar.relativePath === 'string' && sidecar.relativePath
    ? sidecar.relativePath
    : fileName;
  const rel = safeRelativePath(relRaw, fileName);
  let targetRel = rel;
  if (blendRelDir) {
    const prefix = `${blendRelDir}/`;
    if (rel.toLowerCase().startsWith(prefix.toLowerCase())) {
      targetRel = rel.slice(prefix.length);
    } else if (rel.includes('/')) {
      // Different folder tree — still keep basename next to the blend.
      targetRel = path.posix.basename(rel);
    }
  } else if (rel.includes('/')) {
    // Keep nested texture folders under the temp root.
    targetRel = rel.includes('/') ? rel.replace(/^[^/]+\//, '') : rel;
    if (!targetRel || targetRel === rel) targetRel = rel;
  }

  const target = path.join(tmpRoot, ...safeRelativePath(targetRel, fileName).split('/'));
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, bytes);
  // Also drop a basename copy next to the blend for absolute / loose refs.
  const baseCopy = path.join(tmpRoot, path.basename(fileName));
  if (path.resolve(baseCopy) !== path.resolve(target)) {
    try {
      await fsp.writeFile(baseCopy, bytes);
    } catch {
      /* ignore duplicate basename write */
    }
  }
  return bytes.byteLength;
}

/**
 * @param {{
 *   fileName?: string,
 *   dataBase64?: string,
 *   relativePath?: string,
 *   sidecars?: Array<{ fileName?: string, relativePath?: string, dataBase64?: string }>,
 * }} payload
 * @returns {Promise<{ ok: true, dataBase64: string, fileName: string } | { ok: false, error: string }>}
 */
async function convertBlendToGlb(payload) {
  const fileName = typeof payload?.fileName === 'string' ? payload.fileName : 'model.blend';
  const dataBase64 = typeof payload?.dataBase64 === 'string' ? payload.dataBase64 : '';
  const blendRel = safeRelativePath(
    typeof payload?.relativePath === 'string' && payload.relativePath
      ? payload.relativePath
      : fileName,
    fileName,
  );
  const blendRelDir = blendRel.includes('/')
    ? blendRel.slice(0, blendRel.lastIndexOf('/'))
    : '';
  if (!dataBase64) return { ok: false, error: 'No Blender file data received.' };
  if (!/\.blend$/i.test(fileName)) {
    return { ok: false, error: 'Only .blend files can be converted this way.' };
  }

  let buffer;
  try {
    buffer = Buffer.from(dataBase64, 'base64');
  } catch {
    return { ok: false, error: 'Could not read the dropped .blend file.' };
  }
  if (!buffer.length) return { ok: false, error: 'The .blend file is empty.' };
  if (buffer.byteLength > MAX_BLEND_BYTES) {
    return { ok: false, error: 'Blender file is too large (max 80 MB).' };
  }

  const sidecars = Array.isArray(payload?.sidecars) ? payload.sidecars : [];
  let sidecarBytes = 0;
  for (const side of sidecars) {
    const b64 = typeof side?.dataBase64 === 'string' ? side.dataBase64 : '';
    // Rough size from base64 length before decoding everything.
    sidecarBytes += Math.floor((b64.length * 3) / 4);
  }
  if (buffer.byteLength + sidecarBytes > MAX_BLEND_BYTES * 1.5) {
    return { ok: false, error: 'Blender file and textures are too large together (max ~120 MB).' };
  }

  const py = scriptPath();
  if (!fs.existsSync(py)) {
    return { ok: false, error: 'Blender convert script is missing from this build.' };
  }

  let blender;
  try {
    blender = await resolveBlender();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Blender was not found.' };
  }

  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mockup-blend-'));
  const safeStem = path.basename(fileName, path.extname(fileName)).replace(/[^\w.-]+/g, '_').slice(0, 64) || 'model';
  const inputPath = path.join(tmpRoot, `${safeStem}.blend`);
  const outputPath = path.join(tmpRoot, `${safeStem}.glb`);

  try {
    await fsp.writeFile(inputPath, buffer);
    for (const side of sidecars.slice(0, 64)) {
      await writeSidecar(tmpRoot, blendRelDir, side);
    }
    await execFileAsync(blender, [
      '--background',
      '--python',
      py,
      '--',
      '--input',
      inputPath,
      '--output',
      outputPath,
    ]);
    const glb = await fsp.readFile(outputPath);
    if (glb.byteLength < 12) {
      return { ok: false, error: 'Blender did not produce a valid GLB.' };
    }
    return {
      ok: true,
      dataBase64: glb.toString('base64'),
      fileName: `${safeStem}.glb`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Blender convert failed.';
    const clipped = message.length > 600 ? `${message.slice(0, 600)}…` : message;
    return {
      ok: false,
      error: clipped.includes('Blender was not found')
        ? clipped
        : `Could not extract this .blend with Blender. ${clipped}`,
    };
  } finally {
    try {
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore cleanup */
    }
  }
}

function registerBlendConvertIpc(ipcMain) {
  ipcMain.handle('blend:convert', async (_event, payload) => convertBlendToGlb(payload || {}));
}

module.exports = {
  registerBlendConvertIpc,
  convertBlendToGlb,
  resolveBlender,
};
