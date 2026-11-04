const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

function createWindow() {
  const win = new BrowserWindow({
    title: 'Mockup Studio',
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

app.whenReady().then(() => {
  ipcMain.handle('project:save', async (_event, { contents, proposedName }) => {
    if (typeof contents !== 'string' || contents.length > 45_000_000) throw new Error('Invalid project size');
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save Mockup Studio project',
      defaultPath: `${sanitizeName(proposedName)}.mockup.json`,
      filters: [{ name: 'Mockup Studio Project', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    await fs.writeFile(filePath, contents, 'utf8');
    return { canceled: false, path: filePath };
  });

  ipcMain.handle('project:open', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Open Mockup Studio project',
      properties: ['openFile'],
      filters: [{ name: 'Mockup Studio Project', extensions: ['json'] }],
    });
    if (canceled || !filePaths[0]) return { canceled: true };
    const stat = await fs.stat(filePaths[0]);
    if (stat.size > 45_000_000) throw new Error('Project exceeds maximum file size');
    const contents = await fs.readFile(filePaths[0], 'utf8');
    return { canceled: false, contents };
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
