const { app, BrowserWindow, Menu, clipboard, ipcMain, dialog, nativeImage, safeStorage, shell, session, systemPreferences } = require('electron');
const fs = require('node:fs/promises');
const { existsSync, appendFileSync } = require('node:fs');
const path = require('node:path');

const isDevRuntime = Boolean(process.env.VITE_DEV_SERVER_URL);
const APP_NAME = isDevRuntime ? 'mokstudio Dev' : 'mokstudio';
const AUTH_PROTOCOL = 'mokstudio';
app.setName(APP_NAME);

const { setupAutoUpdater, isMasBuild } = require('./updater.cjs');

/** Separate app data so MAS and direct-download installs do not clobber each other. */
function distributionChannel() {
  if (isMasBuild()) return 'mac_mas';
  if (process.env.MOCKUP_DISTRIBUTION === 'web') return 'web';
  return 'mac_direct';
}

(() => {
  const channel = distributionChannel();
  const base = app.getPath('userData');
  // Dev Electron must not share the installed app's single-instance lock / userData.
  if (isDevRuntime && !base.endsWith('-Dev')) {
    app.setPath('userData', `${base}-Dev`);
  } else if (channel === 'mac_mas' && !base.endsWith('MAS')) {
    app.setPath('userData', `${base}-MAS`);
  } else if (channel === 'mac_direct' && !base.endsWith('-Direct') && process.env.MOCKUP_FORCE_DIRECT_USERDATA === '1') {
    app.setPath('userData', `${base}-Direct`);
  }
})();

const { decodeProjectFile, encodeProjectFile, isProjectFileName } = require('./projectFile.cjs');

/** Absolute path Finder/Explorer asked us to open (macOS can fire before ready). */
let pendingOpenPath = null;
/** OAuth deep-link that arrived before the renderer was ready. */
let pendingAuthCallbackUrl = null;
/** @type {Electron.BrowserWindow | null} */
let mainWindow = null;

function isAuthCallbackUrl(raw) {
  if (typeof raw !== 'string' || !raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === `${AUTH_PROTOCOL}:`
      && (parsed.hostname === 'auth' || parsed.pathname.startsWith('//auth') || parsed.pathname.includes('auth'));
  } catch {
    return raw.startsWith(`${AUTH_PROTOCOL}://`);
  }
}

function notifyRendererAuthCallback(url) {
  const win = focusMainWindow();
  if (!win) {
    pendingAuthCallbackUrl = url;
    return;
  }
  if (win.webContents.isLoadingMainFrame()) {
    pendingAuthCallbackUrl = url;
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) win.webContents.send('auth:callback', url);
    });
    return;
  }
  pendingAuthCallbackUrl = null;
  win.webContents.send('auth:callback', url);
}

function queueAuthCallback(url) {
  if (!isAuthCallbackUrl(url)) return;
  pendingAuthCallbackUrl = url;
  if (app.isReady()) notifyRendererAuthCallback(url);
}

// Register before ready so cold-start deep links resolve to this app.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(AUTH_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(AUTH_PROTOCOL);
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  queueAuthCallback(url);
});

function isOpenableProjectPath(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  if (!path.isAbsolute(filePath)) return false;
  return isProjectFileName(path.basename(filePath));
}

function projectPathFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv) {
    if (typeof arg !== 'string' || !arg || arg.startsWith('-')) continue;
    // Electron / Chromium flags and the app entry path are not project files.
    if (arg === '.' || arg.endsWith('electron') || arg.endsWith('electron.exe')) continue;
    if (arg.endsWith('main.cjs') || arg.endsWith('package.json')) continue;
    const resolved = path.resolve(arg);
    if (isOpenableProjectPath(resolved) && existsSync(resolved)) return resolved;
  }
  return null;
}

function focusMainWindow() {
  const win = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow
    : BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) return null;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}

function notifyRendererOpen(filePath) {
  const win = focusMainWindow();
  if (!win || win.webContents.isLoadingMainFrame()) return;
  win.webContents.send('project:open-from-os', filePath);
}

function queueOpenPath(filePath) {
  if (!isOpenableProjectPath(filePath)) return;
  pendingOpenPath = filePath;
  if (app.isReady()) notifyRendererOpen(filePath);
}

// macOS: double-click / Open With can arrive before app.whenReady().
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  queueOpenPath(filePath);
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const authUrl = Array.isArray(argv)
      ? argv.find((arg) => typeof arg === 'string' && isAuthCallbackUrl(arg))
      : null;
    if (authUrl) {
      queueAuthCallback(authUrl);
      return;
    }
    const fromArgv = projectPathFromArgv(argv);
    if (fromArgv) queueOpenPath(fromArgv);
    else focusMainWindow();
  });
}

const CRASH_LOG = path.join(app.getPath('userData'), 'main-crash.log');
function logCrash(label, err) {
  const line = `[${new Date().toISOString()}] ${label} ${err && err.stack ? err.stack : String(err)}\n`;
  try { appendFileSync(CRASH_LOG, line); } catch { /* ignore */ }
  console.error(label, err);
}
process.on('uncaughtException', (err) => logCrash('uncaughtException', err));
process.on('unhandledRejection', (err) => logCrash('unhandledRejection', err));

function installAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
          label: APP_NAME,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [{ role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }] : [
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' },
        ]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function appIconFile() {
  const candidates = [
    path.join(__dirname, '../build/icon.png'),
    path.join(process.resourcesPath || '', 'icon.png'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || '';
}
const { registerAndroidMirrorIpc, stopAndroidMirrorSession } = require('./androidMirror.cjs');
const { registerBlendConvertIpc } = require('./blendConvert.cjs');
const { registerCloudLibraryIpc, getLibraryDir } = require('./cloudLibrary.cjs');

function createWindow() {
  const iconFile = appIconFile();
  const win = new BrowserWindow({
    title: APP_NAME,
    icon: iconFile || undefined,
    width: 1510,
    height: 960,
    minWidth: 1040,
    minHeight: 690,
    backgroundColor: '#0c0d0f',
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 17, y: 15 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  let failRetries = 0;
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    console.error('[mockup-studio] did-fail-load', code, desc, url);
    if (!isMainFrame || !devUrl) return;
    // Dev server briefly offline → blank #0c0d0f window. Retry, then show a recovery page.
    if (failRetries < 8) {
      failRetries += 1;
      setTimeout(() => {
        if (!win.isDestroyed()) win.loadURL(devUrl);
      }, 600 * failRetries);
      return;
    }
    const safeDev = JSON.stringify(devUrl);
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"/><title>mokstudio</title>
<style>
  html,body{margin:0;height:100%;background:#0c0d0f;color:#f6f7fb;font:15px/1.45 -apple-system,BlinkMacSystemFont,sans-serif}
  main{min-height:100%;display:grid;place-content:center;gap:14px;padding:32px;text-align:center}
  button{appearance:none;border:0;border-radius:10px;padding:10px 16px;background:#b794ff;color:#12141a;font-weight:600;cursor:pointer}
  p{margin:0;color:#a0a7b6} code{color:#e8ecef}
</style></head><body><main>
  <h1 style="margin:0;font-size:22px">Dev server is offline</h1>
  <p>Could not reach <code>${devUrl.replace(/</g, '')}</code> (${desc}).</p>
  <p>Start it with <code>npm run dev</code>, then retry.</p>
  <button id="retry">Retry</button>
  <script>
    const target = ${safeDev};
    document.getElementById('retry').onclick = () => location.href = target;
    setTimeout(() => { location.href = target; }, 2500);
  </script>
</main></body></html>`)}`);
  });
  win.webContents.on('did-finish-load', () => {
    failRetries = 0;
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[mockup-studio] render-process-gone', details);
  });
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error('[renderer]', message, sourceId, line);
  });
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '../dist/index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return win;
}

function allowMediaPermission(permission) {
  return permission === 'media'
    || permission === 'mediaKeySystem'
    || permission === 'display-capture'
    || permission === 'clipboard-read'
    || permission === 'clipboard-sanitized-write';
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;

  installAppMenu();
  const iconFile = appIconFile();
  if (iconFile) {
    const image = nativeImage.createFromPath(iconFile);
    if (process.platform === 'darwin' && app.dock && !image.isEmpty()) app.dock.setIcon(image);
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      iconPath: iconFile,
    });
  }

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowMediaPermission(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowMediaPermission(permission));

  ipcMain.handle('media:ensureCameraAccess', async () => {
    if (process.platform !== 'darwin') {
      return { granted: true };
    }
    try {
      const status = systemPreferences.getMediaAccessStatus('camera');
      if (status === 'granted') return { granted: true, status };
      if (status === 'denied' || status === 'restricted') {
        return {
          granted: false,
          status,
          reason: 'Camera access is blocked. Open System Settings → Privacy & Security → Camera and enable mokstudio.',
        };
      }
      const granted = await systemPreferences.askForMediaAccess('camera');
      return {
        granted,
        status: granted ? 'granted' : 'denied',
        reason: granted
          ? undefined
          : 'Camera access was not granted. Enable it in System Settings → Privacy & Security → Camera.',
      };
    } catch (err) {
      return {
        granted: false,
        reason: err instanceof Error ? err.message : 'Could not request camera access',
      };
    }
  });

  ipcMain.handle('project:save', async (_event, { contents, proposedName }) => {
    if (typeof contents !== 'string' || contents.length > 45_000_000) throw new Error('Invalid project size');
    const libraryDir = await getLibraryDir();
    const baseName = `${sanitizeName(proposedName)}.mockup`;
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save mokstudio project',
      defaultPath: libraryDir ? path.join(libraryDir, baseName) : baseName,
      filters: [
        { name: 'mokstudio Project', extensions: ['mockup'] },
        { name: 'Legacy JSON', extensions: ['json'] },
      ],
    });
    if (canceled || !filePath) return { canceled: true };
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.mockup.json') || (lower.endsWith('.json') && !lower.endsWith('.mockup'))) {
      await fs.writeFile(filePath, contents, 'utf8');
    } else {
      const target = lower.endsWith('.mockup') ? filePath : `${filePath}.mockup`;
      await fs.writeFile(target, encodeProjectFile(contents));
      return { canceled: false, path: target };
    }
    return { canceled: false, path: filePath };
  });

  ipcMain.handle('project:open', async () => {
    const libraryDir = await getLibraryDir();
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Open mokstudio project',
      defaultPath: libraryDir || undefined,
      properties: ['openFile'],
      filters: [
        { name: 'mokstudio Project', extensions: ['mockup', 'json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (canceled || !filePaths[0]) return { canceled: true };
    const stat = await fs.stat(filePaths[0]);
    if (stat.size > 45_000_000) throw new Error('Project exceeds maximum file size');
    const raw = await fs.readFile(filePaths[0]);
    const contents = decodeProjectFile(raw);
    return { canceled: false, contents, path: filePaths[0] };
  });

  ipcMain.handle('project:openPath', async (_event, filePath) => {
    if (!isOpenableProjectPath(filePath)) throw new Error('Not a mokstudio project file');
    const resolved = path.resolve(filePath);
    if (!existsSync(resolved)) throw new Error('That project file no longer exists');
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) throw new Error('That path is not a file');
    if (stat.size > 45_000_000) throw new Error('Project exceeds maximum file size');
    const raw = await fs.readFile(resolved);
    const contents = decodeProjectFile(raw);
    if (pendingOpenPath === resolved || pendingOpenPath === filePath) pendingOpenPath = null;
    return { contents, path: resolved };
  });

  ipcMain.handle('project:takePendingOpen', () => {
    const next = pendingOpenPath;
    pendingOpenPath = null;
    return next;
  });

  ipcMain.handle('image:save', async (_event, { dataUrl, proposedName }) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) throw new Error('Expected an image');
    const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(dataUrl);
    if (!match) throw new Error('Expected a PNG, JPEG, or WebP image');
    const ext = match[1].toLowerCase() === 'jpeg' || match[1].toLowerCase() === 'jpg' ? 'jpg' : match[1].toLowerCase();
    const base64 = match[2];
    if (base64.length > 100_000_000) throw new Error('Image is too large');
    const label = ext === 'webp' ? 'WebP Image' : ext === 'jpg' ? 'JPEG Image' : 'PNG Image';
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: `Export ${ext.toUpperCase()} image`,
      defaultPath: `${sanitizeName(proposedName)}.${ext}`,
      filters: [{ name: label, extensions: [ext] }],
    });
    if (canceled || !filePath) return { canceled: true };
    await fs.writeFile(filePath, Buffer.from(base64, 'base64'));
    return { canceled: false, path: filePath };
  });

  ipcMain.handle('media:save', async (_event, { dataBase64, proposedName, extension, mimeType }) => {
    if (typeof dataBase64 !== 'string' || dataBase64.length > 220_000_000) throw new Error('Export is too large');
    const ext = sanitizeExt(extension);
    const filters = mediaFilters(ext, mimeType);
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: `Export ${ext.toUpperCase()}`,
      defaultPath: `${sanitizeName(proposedName)}.${ext}`,
      filters,
    });
    if (canceled || !filePath) return { canceled: true };
    await fs.writeFile(filePath, Buffer.from(dataBase64, 'base64'));
    return { canceled: false, path: filePath };
  });

  ipcMain.handle('clipboard:readImage', async () => {
    // Figma “Copy as PNG” often lands as public.png / image/png rather than NSImage.
    // Try nativeImage first, then raw pasteboard buffers.
    let image = clipboard.readImage();
    if (image.isEmpty()) {
      const formats = [
        'public.png',
        'image/png',
        'public.jpeg',
        'public.jpg',
        'image/jpeg',
        'public.tiff',
        'image/tiff',
      ];
      for (const format of formats) {
        try {
          const buffer = clipboard.readBuffer(format);
          if (!buffer || !buffer.length) continue;
          const candidate = nativeImage.createFromBuffer(buffer);
          if (!candidate.isEmpty()) {
            image = candidate;
            break;
          }
        } catch {
          /* format not on pasteboard */
        }
      }
    }
    if (image.isEmpty()) return { ok: false };
    const { width, height } = image.getSize();
    if (!width || !height) return { ok: false };
    if (width * height > 40_000_000) throw new Error('Use an image under 20 MB.');
    return { ok: true, dataUrl: image.toDataURL(), name: 'pasted.png' };
  });

  // Figma ⌘C puts proprietary HTML (figmeta/figma), not a PNG.
  ipcMain.handle('clipboard:readHtml', async () => {
    try {
      let html = '';
      try { html = clipboard.readHTML() || ''; } catch { /* ignore */ }
      if (!html) {
        try { html = clipboard.read('text/html') || ''; } catch { /* ignore */ }
      }
      if (!html) {
        for (const format of ['public.html', 'Apple HTML pasteboard type', 'text/html']) {
          try {
            const buffer = clipboard.readBuffer(format);
            if (buffer?.length) {
              html = buffer.toString('utf8');
              if (html) break;
            }
          } catch { /* format missing */ }
        }
      }
      if (!html || typeof html !== 'string') return { ok: false };
      return { ok: true, html };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('shell:openExternal', async (_event, rawUrl) => {
    if (typeof rawUrl !== 'string' || rawUrl.length > 2048) throw new Error('Invalid URL');
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error('Invalid URL');
    }
    if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) {
      throw new Error('Only http(s) and mailto links are allowed');
    }
    await shell.openExternal(parsed.toString());
    return { ok: true };
  });

  ipcMain.handle('auth:takePendingCallback', async () => {
    const url = pendingAuthCallbackUrl;
    pendingAuthCallbackUrl = null;
    return url;
  });

  /** One encrypted PAT file per signed-in account id (never plaintext on disk). */
  function sanitizeFigmaAccountId(userId) {
    if (typeof userId !== 'string') return null;
    const safe = userId.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
    return safe || null;
  }

  function figmaTokenFilePath(userId) {
    const safe = sanitizeFigmaAccountId(userId);
    if (!safe) return null;
    return path.join(app.getPath('userData'), `figma-token-${safe}.enc`);
  }

  function legacyFigmaTokenFilePath() {
    return path.join(app.getPath('userData'), 'figma-token.enc');
  }

  async function unlinkIfExists(target) {
    if (target && existsSync(target)) await fs.unlink(target);
  }

  /** Encrypted Figma PAT via OS safeStorage — scoped to the signed-in account. */
  ipcMain.handle('figma:tokenGet', async (_event, userId) => {
    const target = figmaTokenFilePath(userId);
    if (!target) return { ok: false, error: 'Sign in required to load a Figma token' };
    const legacyPath = legacyFigmaTokenFilePath();
    // Migrate pre-account shared file into this account once, then delete it.
    if (!existsSync(target) && existsSync(legacyPath) && safeStorage.isEncryptionAvailable()) {
      try {
        const legacyBuf = await fs.readFile(legacyPath);
        const legacyToken = safeStorage.decryptString(legacyBuf);
        if (typeof legacyToken === 'string' && legacyToken.trim()) {
          await fs.writeFile(target, safeStorage.encryptString(legacyToken.trim()));
          await unlinkIfExists(legacyPath);
        }
      } catch {
        /* leave legacy in place for a later retry */
      }
    } else if (existsSync(target) && existsSync(legacyPath)) {
      try { await unlinkIfExists(legacyPath); } catch { /* ignore */ }
    }
    if (!existsSync(target)) return { ok: true, token: null };
    if (!safeStorage.isEncryptionAvailable()) {
      return { ok: false, error: 'Secure storage is unavailable on this system' };
    }
    try {
      const buf = await fs.readFile(target);
      const token = safeStorage.decryptString(buf);
      if (typeof token !== 'string' || !token.trim()) return { ok: true, token: null };
      return { ok: true, token };
    } catch {
      return { ok: false, error: 'Could not decrypt the stored Figma token' };
    }
  });

  ipcMain.handle('figma:tokenSet', async (_event, userId, token) => {
    const target = figmaTokenFilePath(userId);
    if (!target) return { ok: false, error: 'Sign in required to save a Figma token' };
    if (typeof token !== 'string' || token.trim().length < 8 || token.length > 512) {
      return { ok: false, error: 'Invalid Figma token' };
    }
    if (!safeStorage.isEncryptionAvailable()) {
      return { ok: false, error: 'Secure storage is unavailable — cannot save the Figma token on this system' };
    }
    try {
      const sealed = safeStorage.encryptString(token.trim());
      await fs.writeFile(target, sealed);
      try { await unlinkIfExists(legacyFigmaTokenFilePath()); } catch { /* ignore */ }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Could not save Figma token' };
    }
  });

  ipcMain.handle('figma:tokenClear', async (_event, userId) => {
    const target = figmaTokenFilePath(userId);
    try {
      await unlinkIfExists(target);
      try { await unlinkIfExists(legacyFigmaTokenFilePath()); } catch { /* ignore */ }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Could not clear Figma token' };
    }
  });

  ipcMain.handle('figma:request', async (_event, { apiPath, token }) => {
    if (typeof token !== 'string' || token.length < 8 || token.length > 512) {
      throw new Error('Invalid Figma token');
    }
    if (typeof apiPath !== 'string' || !apiPath.startsWith('/') || apiPath.length > 2048) {
      throw new Error('Invalid Figma path');
    }
    if (apiPath.includes('://') || apiPath.includes('..')) {
      throw new Error('Invalid Figma path');
    }
    const url = `https://api.figma.com/v1${apiPath}`;
    const response = await fetch(url, {
      headers: {
        'X-Figma-Token': token,
        Accept: 'application/json',
      },
    });
    const body = await response.text();
    if (body.length > 40_000_000) throw new Error('Figma response is too large');
    return { status: response.status, body };
  });

  registerAndroidMirrorIpc(ipcMain);
  registerBlendConvertIpc(ipcMain);
  registerCloudLibraryIpc(ipcMain);

  ipcMain.handle('distribution:channel', () => distributionChannel());
  ipcMain.on('distribution:channel-sync', (event) => {
    event.returnValue = distributionChannel();
  });
  ipcMain.handle('device:installId', async () => {
    const file = path.join(app.getPath('userData'), 'install-device-id.txt');
    try {
      const existing = (await fs.readFile(file, 'utf8')).trim();
      if (existing.length >= 16) return existing;
    } catch {
      /* create */
    }
    const { randomUUID } = require('node:crypto');
    const next = randomUUID();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, next, 'utf8');
    return next;
  });
  /** StoreKit bridge lands with the MAS native helper; stub keeps UI wired. */
  ipcMain.handle('iap:restore', async () => ({
    ok: false,
    error: 'StoreKit restore requires the Mac App Store build with the native IAP bridge configured.',
  }));

  setupAutoUpdater();

  /** DEV-only: read src/data/shippedTemplates.json so successive promotes accumulate. */
  ipcMain.handle('dev:readShippedTemplates', async () => {
    if (app.isPackaged) {
      return { ok: false, reason: 'Modeling promote is only available in development builds' };
    }
    const target = path.join(__dirname, '../src/data/shippedTemplates.json');
    try {
      const contents = await fs.readFile(target, 'utf8');
      if (contents.length > 8_000_000) {
        return { ok: false, reason: 'Template pack is too large' };
      }
      return { ok: true, path: target, contents, missing: false };
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return { ok: true, path: target, contents: null, missing: true };
      }
      return { ok: false, reason: error instanceof Error ? error.message : 'Could not read shipped templates' };
    }
  });

  /** DEV-only: promote compositions into src/data/shippedTemplates.json for the next build. */
  ipcMain.handle('dev:writeShippedTemplates', async (_event, contents) => {
    if (app.isPackaged) {
      return { ok: false, reason: 'Modeling promote is only available in development builds' };
    }
    if (typeof contents !== 'string' || contents.length > 8_000_000) {
      return { ok: false, reason: 'Invalid template pack' };
    }
    try {
      JSON.parse(contents);
    } catch {
      return { ok: false, reason: 'Template pack is not valid JSON' };
    }
    const target = path.join(__dirname, '../src/data/shippedTemplates.json');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, 'utf8');
    return { ok: true, path: target };
  });

  ipcMain.handle('figma:fetchImage', async (_event, { imageUrl, token }) => {
    if (typeof imageUrl !== 'string' || imageUrl.length > 4096) {
      return { ok: false, error: 'Invalid image URL' };
    }
    let parsed;
    try {
      parsed = new URL(imageUrl);
    } catch {
      return { ok: false, error: 'Invalid image URL' };
    }
    if (parsed.protocol !== 'https:') {
      return { ok: false, error: 'Only HTTPS image URLs are allowed' };
    }
    const host = parsed.hostname.toLowerCase();
    const allowed =
      host === 'figma.com'
      || host.endsWith('.figma.com')
      || host.endsWith('.figma.site')
      || host.endsWith('.amazonaws.com')
      || host.endsWith('.cloudfront.net');
    if (!allowed) {
      return { ok: false, error: 'Image host is not allowed' };
    }
    const headers = { Accept: 'image/*,*/*' };
    if (typeof token === 'string' && token.length >= 8 && token.length <= 512) {
      headers['X-Figma-Token'] = token;
    }
    const response = await fetch(parsed.toString(), { headers });
    if (!response.ok) {
      return { ok: false, error: `Image download failed (${response.status})` };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 40_000_000) {
      return { ok: false, error: 'Exported image is too large' };
    }
    const contentType = (response.headers.get('content-type') || 'image/png').split(';')[0];
    const mime = contentType.startsWith('image/') ? contentType : 'image/png';
    return { ok: true, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
  });

  // Cold-launch from Finder / Explorer also puts the path on argv (non-macOS).
  // On macOS, open-file usually wins and may have already filled pendingOpenPath.
  const launchPath = projectPathFromArgv(process.argv);
  if (launchPath) pendingOpenPath = launchPath;

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function sanitizeName(name) {
  return String(name || 'Mockup').replace(/[^\w .-]/g, '').trim().slice(0, 80) || 'Mockup';
}

function sanitizeExt(extension) {
  const ext = String(extension || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['png', 'webp', 'webm', 'mp4', 'mov', 'gif', 'json'].includes(ext)) return ext;
  return 'bin';
}

function mediaFilters(ext, mimeType) {
  if (ext === 'mp4') return [{ name: 'MP4 Video', extensions: ['mp4'] }, { name: 'All Files', extensions: ['*'] }];
  if (ext === 'mov') return [{ name: 'QuickTime Movie', extensions: ['mov'] }, { name: 'All Files', extensions: ['*'] }];
  if (ext === 'webm') return [{ name: 'WebM Video', extensions: ['webm'] }, { name: 'All Files', extensions: ['*'] }];
  if (ext === 'gif') return [{ name: 'GIF Animation', extensions: ['gif'] }, { name: 'All Files', extensions: ['*'] }];
  if (ext === 'png') return [{ name: 'PNG Image', extensions: ['png'] }];
  if (ext === 'webp') return [{ name: 'WebP Image', extensions: ['webp'] }];
  return [{ name: mimeType || 'Media', extensions: [ext] }];
}

app.on('before-quit', () => {
  stopAndroidMirrorSession();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
