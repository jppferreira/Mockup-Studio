const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_DELAY_MS = 4_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
/** Public latest assets — avoids GitHub API rate limits that break the default provider. */
const GENERIC_FEED_URL = 'https://github.com/jppferreira/Mockup-Studio/releases/latest/download/';

function isMasBuild() {
  if (process.mas === true) return true;
  if (process.env.MOCKUP_DISTRIBUTION === 'mac_mas') return true;
  return false;
}

/** Background Mac updates from the latest GitHub Release (latest-mac.yml + zip). */
function setupAutoUpdater() {
  let status = { state: 'idle' };
  /** @type {import('electron-updater').UpdateCheckResult | null} */
  let lastCheckResult = null;
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
  ipcMain.handle('updater:download', async () => {
    if (!enabled) {
      return { ok: false, error: 'Updates are managed by the Mac App Store on this build.' };
    }
    if (status.state === 'ready') {
      return { ok: true, state: 'ready', version: status.version || null };
    }
    if (status.state === 'downloading') {
      return { ok: true, state: 'downloading', version: status.version || null, percent: status.percent || 0 };
    }
    try {
      broadcast({
        state: 'downloading',
        version: status.version || lastCheckResult?.updateInfo?.version || null,
        percent: 0,
      });
      // Ensure we have update info before downloadUpdate().
      if (!lastCheckResult?.downloadPromise && status.state !== 'available') {
        lastCheckResult = await autoUpdater.checkForUpdates();
      }
      await autoUpdater.downloadUpdate();
      return { ok: true, state: status.state, version: status.version || null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[updater] download failed', message);
      broadcast({ state: 'error', message, version: status.version || null });
      return { ok: false, error: message };
    }
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
      lastCheckResult = await autoUpdater.checkForUpdates();
      const version = lastCheckResult?.updateInfo?.version || null;
      // Give update-available a tick to land before treating as up-to-date.
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (status.state === 'checking' || status.state === 'idle') {
        broadcast({ state: 'up-to-date', version: app.getVersion() });
        return { ok: true, state: 'up-to-date', version: app.getVersion() };
      }
      return { ok: true, state: status.state, version: status.version || version };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[updater] check failed', message);
      broadcast({ state: 'error', message });
      return { ok: false, error: message };
    }
  });

  if (!enabled) return;

  try {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: GENERIC_FEED_URL,
    });
  } catch (err) {
    console.error('[updater] setFeedURL failed', err instanceof Error ? err.message : err);
  }

  // Wait for the user to confirm in the modal (Figma-style), then download in-app.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;
  if (typeof autoUpdater.allowDowngrade === 'boolean') {
    autoUpdater.allowDowngrade = false;
  }

  autoUpdater.on('checking-for-update', () => {
    if (status.state !== 'ready' && status.state !== 'downloading' && status.state !== 'available') {
      broadcast({ state: 'checking', version: null, percent: 0 });
    }
  });
  autoUpdater.on('update-available', (info) => {
    lastCheckResult = lastCheckResult || { updateInfo: info };
    if (status.state === 'downloading' || status.state === 'ready') return;
    broadcast({ state: 'available', version: info?.version || null, percent: 0 });
  });
  autoUpdater.on('update-not-available', () => {
    if (status.state !== 'ready' && status.state !== 'downloading') {
      broadcast({ state: 'up-to-date', version: app.getVersion() });
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
    const message = err instanceof Error ? err.message : String(err);
    console.error('[updater]', message);
    if (status.state !== 'ready') {
      broadcast({ state: 'error', message, version: status.version || null });
    }
  });

  const check = () => {
    if (status.state === 'downloading' || status.state === 'ready' || status.state === 'available') return;
    autoUpdater.checkForUpdates()
      .then((result) => {
        lastCheckResult = result;
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[updater]', message);
        broadcast({ state: 'error', message });
      });
  };

  setTimeout(check, CHECK_DELAY_MS);
  setInterval(check, CHECK_INTERVAL_MS);
}

module.exports = { setupAutoUpdater, isMasBuild };
