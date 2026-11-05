const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app, dialog, BrowserWindow } = require('electron');

const LIBRARY_FOLDER_NAME = 'Mockup Studio';
const CONFIG_NAME = 'cloud-library.json';
const MAX_BYTES = 45_000_000;
const PREVIEW_LIMIT = 280_000;
const SLIM_MEDIA_LIMIT = 180_000;

function home() {
  return os.homedir();
}

function icloudRoot() {
  return path.join(home(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
}

async function existsDir(dirPath) {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function findGoogleDriveRoots() {
  const found = [];
  const cloud = path.join(home(), 'Library', 'CloudStorage');
  const preferred = ['My Drive', 'Mon Drive', 'Mi unidad', 'Meine Ablage', 'Il mio Drive', 'Mijn Drive'];
  if (await existsDir(cloud)) {
    let names = [];
    try {
      names = await fs.readdir(cloud);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!name.startsWith('GoogleDrive')) continue;
      const root = path.join(cloud, name);
      let picked = null;
      for (const label of preferred) {
        const candidate = path.join(root, label);
        if (await existsDir(candidate)) {
          picked = candidate;
          break;
        }
      }
      // The account folder can exist while macOS hides its contents until the user picks it.
      found.push({ path: picked || root, readable: Boolean(picked) });
    }
  }
  const legacy = path.join(home(), 'Google Drive');
  if (await existsDir(legacy)) found.push({ path: legacy, readable: true });
  return found;
}

function configFile() {
  return path.join(app.getPath('userData'), CONFIG_NAME);
}

async function readConfig() {
  try {
    const parsed = JSON.parse(await fs.readFile(configFile(), 'utf8'));
    if (!parsed || typeof parsed.dir !== 'string' || !parsed.dir) return null;
    const provider = parsed.provider === 'icloud' || parsed.provider === 'google-drive' || parsed.provider === 'folder'
      ? parsed.provider
      : 'folder';
    return { provider, dir: parsed.dir };
  } catch {
    return null;
  }
}

async function writeConfig(config) {
  await fs.mkdir(path.dirname(configFile()), { recursive: true });
  let dir;
  try {
    dir = await fs.realpath(config.dir);
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      throw new Error('macOS blocked that folder. Choose My Drive again, or use iCloud Drive.');
    }
    throw error;
  }
  await fs.writeFile(configFile(), JSON.stringify({ provider: config.provider, dir }), 'utf8');
  return dir;
}

function providerLabel(provider) {
  if (provider === 'icloud') return 'iCloud Drive';
  if (provider === 'google-drive') return 'Google Drive';
  return 'your folder';
}

function folderLabel(provider, dir) {
  if (provider === 'icloud') return 'iCloud Drive/Mockup Studio';
  if (provider === 'google-drive') return 'Google Drive/Mockup Studio';
  const homeDir = home();
  if (dir.startsWith(homeDir + path.sep)) return dir.slice(homeDir.length + 1);
  return dir;
}

async function locationStatus() {
  const icloudAvailable = await existsDir(icloudRoot());
  const googleRoots = await findGoogleDriveRoots();
  return {
    icloud: {
      available: icloudAvailable,
      detail: icloudAvailable
        ? 'Projects save into iCloud Drive and sync to your other Apple devices.'
        : 'Turn on iCloud Drive in System Settings, then try again.',
    },
    googleDrive: {
      available: googleRoots.length > 0,
      root: googleRoots[0]?.path || null,
      readable: googleRoots[0]?.readable === true,
      detail: googleRoots.length === 0
        ? 'Install Google Drive for desktop and sign in, then try again.'
        : googleRoots[0]?.readable
          ? 'Projects save into Google Drive and sync with Drive for desktop.'
          : 'Google Drive is installed. macOS will ask you to choose the My Drive folder.',
    },
  };
}

async function status() {
  const locations = await locationStatus();
  const config = await readConfig();
  const base = {
    icloud: { available: locations.icloud.available, detail: locations.icloud.detail },
    googleDrive: {
      available: locations.googleDrive.available,
      detail: locations.googleDrive.detail,
      readable: locations.googleDrive.readable === true,
    },
  };
  if (!config) {
    return {
      configured: false,
      provider: null,
      label: null,
      folderLabel: null,
      path: null,
      missing: false,
      ...base,
    };
  }
  const missing = !(await existsDir(config.dir));
  return {
    configured: true,
    provider: config.provider,
    label: providerLabel(config.provider),
    folderLabel: folderLabel(config.provider, config.dir),
    path: config.dir,
    missing,
    ...base,
  };
}

async function getLibraryDir() {
  const config = await readConfig();
  if (!config) return null;
  return (await existsDir(config.dir)) ? config.dir : null;
}

async function useProvider(provider) {
  const locations = await locationStatus();
  let dir;
  if (provider === 'icloud') {
    if (!locations.icloud.available) throw new Error(locations.icloud.detail);
    dir = path.join(icloudRoot(), LIBRARY_FOLDER_NAME);
  } else if (provider === 'google-drive') {
    if (!locations.googleDrive.root) throw new Error(locations.googleDrive.detail);
    if (!locations.googleDrive.readable) return pickFolder(locations.googleDrive.root);
    dir = path.join(locations.googleDrive.root, LIBRARY_FOLDER_NAME);
  } else {
    throw new Error('Unknown sync location');
  }
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    if (provider === 'google-drive' && (error?.code === 'EPERM' || error?.code === 'EACCES')) {
      return pickFolder(locations.googleDrive.root);
    }
    throw error;
  }
  await writeConfig({ provider, dir });
  await restartWatch();
  return { canceled: false, status: await status() };
}

async function providerForPath(dir) {
  const resolved = await fs.realpath(dir);
  const icloud = await fs.realpath(icloudRoot()).catch(() => icloudRoot());
  if (resolved === icloud || resolved.startsWith(icloud + path.sep)) return 'icloud';
  const googleRoots = await findGoogleDriveRoots();
  for (const root of googleRoots) {
    const candidate = root.path;
    if (!candidate) continue;
    const real = await fs.realpath(candidate).catch(() => candidate);
    if (resolved === real || resolved.startsWith(real + path.sep)) return 'google-drive';
  }
  return 'folder';
}

async function pickFolder(defaultDir) {
  const current = typeof defaultDir === 'string' && defaultDir ? defaultDir : await getLibraryDir();
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Choose a folder that syncs',
    message: 'Pick a folder in iCloud Drive, Google Drive, Dropbox, or another drive.',
    defaultPath: current || undefined,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths[0]) return { canceled: true, status: await status() };
  await fs.mkdir(filePaths[0], { recursive: true });
  const provider = await providerForPath(filePaths[0]);
  await writeConfig({ provider, dir: filePaths[0] });
  await restartWatch();
  return { canceled: false, status: await status() };
}

async function clearLibrary() {
  stopWatch();
  try {
    await fs.unlink(configFile());
  } catch {
    /* already clear */
  }
  return status();
}

function sanitizeName(name) {
  return String(name || 'Mockup').replace(/[^\w .-]/g, '').trim().slice(0, 80) || 'Mockup';
}

async function resolveInside(libraryDir, target) {
  const root = await fs.realpath(libraryDir);
  const file = path.resolve(target);
  const base = path.basename(file);
  if (!base.endsWith('.mockup.json') || base.includes('..')) {
    throw new Error('Invalid project file');
  }
  let parentReal;
  try {
    parentReal = await fs.realpath(path.dirname(file));
  } catch {
    throw new Error('That folder is not available.');
  }
  if (parentReal !== root && !parentReal.startsWith(root + path.sep)) {
    throw new Error('That file is outside the sync folder.');
  }
  const resolved = path.join(parentReal, base);
  try {
    const realFile = await fs.realpath(resolved);
    if (realFile !== root && !realFile.startsWith(root + path.sep)) {
      throw new Error('That file is outside the sync folder.');
    }
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  return resolved;
}

async function allocatePath(dir, name) {
  const base = sanitizeName(name);
  let candidate = path.join(dir, `${base}.mockup.json`);
  for (let i = 2; i < 200; i += 1) {
    try {
      await fs.stat(candidate);
      candidate = path.join(dir, `${base}-${i}.mockup.json`);
    } catch {
      return candidate;
    }
  }
  return path.join(dir, `${base}-${Date.now()}.mockup.json`);
}

function shrinkMedia(value) {
  if (typeof value !== 'string') return value ?? null;
  if (value.startsWith('data:') && value.length > SLIM_MEDIA_LIMIT) return null;
  return value;
}

function slimCopy(json) {
  const clone = JSON.parse(JSON.stringify(json));
  clone.screenshot = shrinkMedia(clone.screenshot);
  clone.soundtrackData = null;
  clone.reflectionMapImage = shrinkMedia(clone.reflectionMapImage);
  if (Array.isArray(clone.devices)) {
    clone.devices = clone.devices.map((device) => (
      device && typeof device === 'object'
        ? { ...device, screenshot: shrinkMedia(device.screenshot) }
        : device
    ));
  }
  return JSON.stringify(clone);
}

async function listProjects() {
  const config = await readConfig();
  if (!config || !(await existsDir(config.dir))) return [];
  const names = await fs.readdir(config.dir);
  const entries = [];
  for (const name of names) {
    if (name.endsWith('.tmp')) {
      try {
        const tmpPath = path.join(config.dir, name);
        const tmpStat = await fs.stat(tmpPath);
        if (Date.now() - tmpStat.mtimeMs > 60_000) await fs.unlink(tmpPath);
      } catch {
        /* ignore */
      }
      continue;
    }
    if (!name.endsWith('.mockup.json') || name.startsWith('.')) continue;
    const filePath = path.join(config.dir, name);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_BYTES || stat.size === 0) continue;
      if (stat.size > 12_000_000) {
        entries.push({
          path: filePath,
          name: name.replace(/\.mockup\.json$/i, ''),
          updatedAt: stat.mtimeMs,
          deviceId: 'iphone-17-pro',
          deviceCount: 1,
          preview: null,
          slim: null,
        });
        continue;
      }
      let projectName = name.replace(/\.mockup\.json$/i, '');
      let deviceId = 'iphone-17-pro';
      let deviceCount = 1;
      let preview = null;
      let slim = null;
      const text = await fs.readFile(filePath, 'utf8');
      try {
        const json = JSON.parse(text);
        if (typeof json.name === 'string' && json.name.trim()) projectName = json.name.trim().slice(0, 100);
        if (typeof json.deviceId === 'string') deviceId = json.deviceId;
        if (Array.isArray(json.devices) && json.devices.length > 0) {
          deviceCount = json.devices.length;
          const first = json.devices[0];
          if (first && typeof first.deviceId === 'string') deviceId = first.deviceId;
        }
        const shot = typeof json.screenshot === 'string' && json.screenshot.startsWith('data:image/')
          ? json.screenshot
          : null;
        if (shot && shot.length <= PREVIEW_LIMIT) preview = shot;
        slim = slimCopy(json);
      } catch {
        slim = null;
      }
      entries.push({
        path: filePath,
        name: projectName,
        updatedAt: stat.mtimeMs,
        deviceId,
        deviceCount,
        preview,
        slim,
      });
    } catch {
      /* skip unreadable files */
    }
  }
  entries.sort((a, b) => b.updatedAt - a.updatedAt);
  return entries.slice(0, 40);
}

async function readProject(filePath) {
  const config = await readConfig();
  if (!config) throw new Error('Choose a sync folder first.');
  const target = await resolveInside(config.dir, filePath);
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Project exceeds maximum file size');
  const contents = await fs.readFile(target, 'utf8');
  return { path: target, contents, updatedAt: stat.mtimeMs };
}

async function writeProject({ filePath, contents, name }) {
  if (typeof contents !== 'string' || !contents || contents.length > MAX_BYTES) {
    throw new Error('Invalid project size');
  }
  const config = await readConfig();
  if (!config) throw new Error('Choose a sync folder first.');
  await fs.mkdir(config.dir, { recursive: true });
  const root = await fs.realpath(config.dir);
  let target = typeof filePath === 'string' && filePath
    ? await resolveInside(root, filePath)
    : null;
  const preferred = path.join(root, `${sanitizeName(name)}.mockup.json`);
  if (!target) {
    target = await allocatePath(root, name);
  } else if (path.resolve(target) !== path.resolve(preferred)) {
    let taken = false;
    try {
      taken = (await fs.stat(preferred)).isFile();
    } catch {
      taken = false;
    }
    if (!taken) {
      try {
        await fs.stat(target);
        await fs.rename(target, preferred);
      } catch {
        /* previous file is already gone */
      }
      target = preferred;
    }
  }
  target = await resolveInside(root, target);
  let unchanged = false;
  try {
    unchanged = (await fs.readFile(target, 'utf8')) === contents;
  } catch {
    unchanged = false;
  }
  if (!unchanged) {
    const tmp = path.join(root, `.${path.basename(target)}.${process.pid}.tmp`);
    await fs.writeFile(tmp, contents, 'utf8');
    await fs.rename(tmp, target);
  }
  const stat = await fs.stat(target);
  return { path: target, updatedAt: stat.mtimeMs, unchanged };
}

async function removeProject(filePath) {
  const config = await readConfig();
  if (!config) throw new Error('Choose a sync folder first.');
  const target = await resolveInside(config.dir, filePath);
  await fs.unlink(target);
  return { ok: true };
}

let watchers = [];
let watchTimer = null;

function stopWatch() {
  for (const watcher of watchers) {
    try { watcher.close(); } catch { /* already closed */ }
  }
  watchers = [];
  if (watchTimer) clearTimeout(watchTimer);
  watchTimer = null;
}

function notifyChanged() {
  if (watchTimer) clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    watchTimer = null;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('cloud:changed');
    }
  }, 600);
}

async function restartWatch() {
  stopWatch();
  const config = await readConfig();
  if (!config || !(await existsDir(config.dir))) return;
  try {
    const watcher = fsSync.watch(config.dir, { persistent: true }, () => notifyChanged());
    watcher.on('error', () => { /* folder disappeared */ });
    watchers.push(watcher);
  } catch {
    /* folder may appear later */
  }
}

function registerCloudLibraryIpc(ipcMain) {
  ipcMain.handle('cloud:status', () => status());
  ipcMain.handle('cloud:use', (_event, provider) => useProvider(provider));
  ipcMain.handle('cloud:pick', () => pickFolder());
  ipcMain.handle('cloud:clear', () => clearLibrary());
  ipcMain.handle('cloud:list', () => listProjects());
  ipcMain.handle('cloud:read', (_event, filePath) => readProject(filePath));
  ipcMain.handle('cloud:write', (_event, payload) => writeProject(payload || {}));
  ipcMain.handle('cloud:remove', (_event, filePath) => removeProject(filePath));
  void restartWatch();
}

async function rememberFolder(dir, provider = 'folder') {
  await fs.mkdir(dir, { recursive: true });
  await writeConfig({ provider, dir });
  await restartWatch();
  return status();
}

module.exports = {
  registerCloudLibraryIpc,
  getLibraryDir,
  status,
  rememberFolder,
  listProjects,
  readProject,
  writeProject,
  removeProject,
  clearLibrary,
  sanitizeCloudName: sanitizeName,
};
