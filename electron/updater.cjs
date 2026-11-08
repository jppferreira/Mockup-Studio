const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_DELAY_MS = 8_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Background Mac updates from the latest GitHub Release (latest-mac.yml + zip). */
function setupAutoUpdater() {
  let status = { state: 'idle' };
  const enabled = app.isPackaged && process.platform === 'darwin';

  ipcMain.handle('updater:status', () => status);
  ipcMain.handle('updater:install', () => {
    if (!enabled || status.state !== 'ready') return { ok: false };
    setImmediate(() => {
      autoUpdater.quitAndInstall(false, true);
    });
    return { ok: true };
  });

  if (!enabled) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  const broadcast = (next) => {
    status = next;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('updater:status', status);
    }
  };

  autoUpdater.on('update-available', (info) => {
    broadcast({ state: 'downloading', version: info?.version || null, percent: 0 });
  });
  autoUpdater.on('download-progress', (progress) => {
    broadcast({
      state: 'downloading',
      version: status.version || null,
      percent: Math.max(0, Math.min(100, Math.round(progress?.percent || 0))),
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    broadcast({ state: 'ready', version: info?.version || status.version || null, percent: 100 });
  });
  autoUpdater.on('error', (err) => {
    console.error('[updater]', err instanceof Error ? err.message : err);
    if (status.state !== 'ready') broadcast({ state: 'idle' });
  });

  const check = () => {
    if (status.state === 'downloading' || status.state === 'ready') return;
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater]', err instanceof Error ? err.message : err);
    });
  };

  setTimeout(check, CHECK_DELAY_MS);
  setInterval(check, CHECK_INTERVAL_MS);
}

module.exports = { setupAutoUpdater };
