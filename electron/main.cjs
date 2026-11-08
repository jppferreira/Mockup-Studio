const { app, BrowserWindow, Menu, clipboard, ipcMain, dialog, nativeImage, shell, session, systemPreferences } = require('electron');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');

const APP_NAME = 'Mockup Studio 3D';
app.setName(APP_NAME);

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
const { decodeProjectFile, encodeProjectFile } = require('./projectFile.cjs');
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
}

function allowMediaPermission(permission) {
  return permission === 'media'
    || permission === 'mediaKeySystem'
    || permission === 'display-capture'
    || permission === 'clipboard-read'
    || permission === 'clipboard-sanitized-write';
}

app.whenReady().then(() => {
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
          reason: 'Camera access is blocked. Open System Settings → Privacy & Security → Camera and enable Mockup Studio.',
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
      title: 'Save Mockup Studio project',
      defaultPath: libraryDir ? path.join(libraryDir, baseName) : baseName,
      filters: [
        { name: 'Mockup Studio Project', extensions: ['mockup'] },
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
      title: 'Open Mockup Studio project',
      defaultPath: libraryDir || undefined,
      properties: ['openFile'],
      filters: [
        { name: 'Mockup Studio Project', extensions: ['mockup', 'json'] },
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
    const image = clipboard.readImage();
    if (image.isEmpty()) return { ok: false };
    const { width, height } = image.getSize();
    if (!width || !height) return { ok: false };
    if (width * height > 40_000_000) throw new Error('Use an image under 20 MB.');
    return { ok: true, dataUrl: image.toDataURL(), name: 'pasted.png' };
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
