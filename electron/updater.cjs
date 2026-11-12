const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHECK_DELAY_MS = 4_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
/** Public latest assets — avoids GitHub API rate limits that break the default provider. */
const GENERIC_FEED_URL = 'https://github.com/jppferreira/Mockup-Studio/releases/latest/download/';

function isMasBuild() {
  if (process.mas === true) return true;
  if (process.env.MOCKUP_DISTRIBUTION === 'mac_mas') return true;
  return false;
}

function updaterCacheDir() {
  return path.join(app.getPath('home'), 'Library', 'Caches', 'mockup-studio-updater');
}

function findDownloadedZip() {
  const cache = updaterCacheDir();
  const updateZip = path.join(cache, 'update.zip');
  if (fs.existsSync(updateZip)) return updateZip;
  const pendingDir = path.join(cache, 'pending');
  if (!fs.existsSync(pendingDir)) return null;
  const zip = fs.readdirSync(pendingDir).find((name) => name.endsWith('.zip'));
  return zip ? path.join(pendingDir, zip) : null;
}

function currentAppBundlePath() {
  // …/mokstudio.app/Contents/MacOS/mokstudio → …/mokstudio.app
  return path.resolve(process.execPath, '..', '..', '..');
}

function confirmationPath() {
  return path.join(app.getPath('userData'), 'update-confirmation.json');
}

function markUpdateConfirmation(version) {
  try {
    fs.writeFileSync(
      confirmationPath(),
      JSON.stringify({ version: version || app.getVersion(), at: Date.now() }),
      'utf8',
    );
  } catch (err) {
    console.error('[updater] could not write confirmation', err instanceof Error ? err.message : err);
  }
}

function takeUpdateConfirmation() {
  const file = confirmationPath();
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.unlinkSync(file);
    return raw && typeof raw.version === 'string' ? raw : null;
  } catch {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
    return null;
  }
}

/**
 * Squirrel.Mac quitAndInstall is unreliable for ad-hoc/unsigned direct builds.
 * Apply the downloaded zip with a detached shell helper after this process quits.
 */
function installFromDownloadedZip(version) {
  const zipPath = findDownloadedZip();
  if (!zipPath) {
    return { ok: false, error: 'Update package not found. Try downloading again.' };
  }

  const appPath = currentAppBundlePath();
  if (!appPath.endsWith('.app') || !fs.existsSync(appPath)) {
    return { ok: false, error: 'Could not locate the installed app bundle.' };
  }

  const staging = path.join(os.tmpdir(), `mokstudio-update-${process.pid}-${Date.now()}`);
  const helper = path.join(os.tmpdir(), `mokstudio-apply-update-${process.pid}.sh`);
  const logFile = path.join(app.getPath('home'), 'Library', 'Logs', 'mokstudio-update.log');

  const script = `#!/bin/bash
set -euo pipefail
APP_PATH=${JSON.stringify(appPath)}
ZIP_PATH=${JSON.stringify(zipPath)}
STAGING=${JSON.stringify(staging)}
LOG=${JSON.stringify(logFile)}
mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) applying update from $ZIP_PATH -> $APP_PATH"

for _ in $(seq 1 80); do
  if ! pgrep -f "$APP_PATH/Contents/MacOS/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
sleep 0.8

rm -rf "$STAGING"
mkdir -p "$STAGING"
ditto -x -k "$ZIP_PATH" "$STAGING"
NEW_APP="$STAGING/mokstudio.app"
if [[ ! -d "$NEW_APP" ]]; then
  NEW_APP="$(find "$STAGING" -maxdepth 2 -name '*.app' -type d | head -1 || true)"
fi
if [[ -z "\${NEW_APP}" || ! -d "$NEW_APP" ]]; then
  echo "no .app found in update zip"
  exit 1
fi

rm -rf "$APP_PATH"
ditto "$NEW_APP" "$APP_PATH"
xattr -cr "$APP_PATH" >/dev/null 2>&1 || true
open "$APP_PATH"
rm -rf "$STAGING"
rm -f "$0"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) update applied"
`;

  fs.writeFileSync(helper, script, { mode: 0o755 });
  markUpdateConfirmation(version);
  spawn('/bin/bash', [helper], {
    detached: true,
    stdio: 'ignore',
  }).unref();

  setTimeout(() => {
    app.quit();
  }, 250);

  return { ok: true };
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
  ipcMain.handle('updater:takeConfirmation', () => takeUpdateConfirmation());
  ipcMain.handle('updater:install', () => {
    if (!enabled || status.state !== 'ready') {
      return { ok: false, error: 'No downloaded update is ready to install.' };
    }
    const version = status.version || lastCheckResult?.updateInfo?.version || null;
    // Prefer direct zip apply — Squirrel.Mac often fails on unsigned builds.
    const direct = installFromDownloadedZip(version);
    if (direct.ok) return direct;

    console.warn('[updater] direct install failed, falling back to quitAndInstall', direct.error);
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (err) {
        console.error('[updater] quitAndInstall failed', err instanceof Error ? err.message : err);
      }
    });
    return { ok: true, fallback: true };
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
      if (!lastCheckResult) {
        lastCheckResult = await autoUpdater.checkForUpdates();
      }
      await autoUpdater.downloadUpdate(lastCheckResult?.cancellationToken);
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

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
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
