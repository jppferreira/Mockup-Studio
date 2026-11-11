const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_DELAY_MS = 8_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function isMasBuild() {
  if (process.mas === true) return true;
  if (process.env.MOCKUP_DISTRIBUTION === 'mac_mas') return true;
  return false;
}

/** Background Mac updates from the latest GitHub Release (latest-mac.yml + zip). */
function setupAutoUpdater() {
  let status = { state: 'idle' };
  const enabled = app.isPackaged && process.platform === 'darwin' && !isMasBuild();

  const broadcast = (next) => {
    status = next;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('updater:status', status);
    }
  };

  ipcMain.handle('updater:status', () => status);
  ipcMain.handle('updater:install', () => {
    if (!enabled || status.state !== 'ready') return { ok: false };
    setImmediate(() => {
      autoUpdater.quitAndInstall(false, true);
    });
    return { ok: true };
  });
  ipcMain.handle('updater:check', async () => {
    if (!enabled) {
      return { ok: false, error: 'Updates are managed by the Mac App Store on this build.' };
    }
    if (status.state === 'downloading') {
      return { ok: true, state: 'downloading', version: status.version || null, percent: status.percent || 0 };
    }
    if (status.state === 'ready') {
      return { ok: true, state: 'ready', version: status.version || null };
    }
    try {
      broadcast({ state: 'checking', version: null, percent: 0 });
      const result = await autoUpdater.checkForUpdates();
      const version = result?.updateInfo?.version || null;
      // If nothing newer, electron-updater resolves without update-available.
      if (status.state === 'checking' || status.state === 'idle') {
        broadcast({ state: 'idle' });
        return { ok: true, state: 'up-to-date', version: app.getVersion() };
      }
      return { ok: true, state: status.state, version: status.version || version };
    } catch (err) {
      broadcast({ state: 'error', message: err instanceof Error ? err.message : String(err) });
      return { ok: false, error: err instanceof Error ? err.message : 'Update check failed' };
    }
  });

  if (!enabled) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  autoUpdater.on('checking-for-update', () => {
    if (status.state !== 'ready' && status.state !== 'downloading') {
      broadcast({ state: 'checking', version: null, percent: 0 });
    }
  });
  autoUpdater.on('update-available', (info) => {
    broadcast({ state: 'downloading', version: info?.version || null, percent: 0 });
  });
  autoUpdater.on('update-not-available', () => {
    if (status.state !== 'ready' && status.state !== 'downloading') {
      broadcast({ state: 'idle' });
    }
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
    if (status.state !== 'ready') {
      broadcast({ state: 'error', message: err instanceof Error ? err.message : String(err) });
    }
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

module.exports = { setupAutoUpdater, isMasBuild };
