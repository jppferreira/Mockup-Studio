const { app, BrowserWindow, Menu, clipboard, ipcMain, dialog, nativeImage, shell, session, systemPreferences } = require('electron');
const fs = require('node:fs/promises');
const { existsSync, appendFileSync } = require('node:fs');
const path = require('node:path');

const APP_NAME = 'mokstudio';
app.setName(APP_NAME);

const { decodeProjectFile, encodeProjectFile, isProjectFileName } = require('./projectFile.cjs');

/** Absolute path Finder/Explorer asked us to open (macOS can fire before ready). */
let pendingOpenPath = null;
/** @type {Electron.BrowserWindow | null} */
let mainWindow = null;

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
const { setupAutoUpdater } = require('./updater.cjs');

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
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[mockup-studio] did-fail-load', code, desc, url);
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
  if (['png', 'webp', 'webm', 'mp4', 'gif', 'json'].includes(ext)) return ext;
  return 'bin';
}

function mediaFilters(ext, mimeType) {
  if (ext === 'mp4') return [{ name: 'MP4 Video', extensions: ['mp4'] }, { name: 'All Files', extensions: ['*'] }];
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
