/**
 * Dev launches Electron.app itself, so macOS shows "Electron" and the Electron
 * icon until that bundle is branded. Reapplies after npm install.
 *
 * CFBundleIdentifier must leave com.github.Electron — otherwise Launch Services
 * merges this with every other Electron.app on the machine and the Dock/menu
 * keep the generic "Electron" name.
 *
 * Bundle name is "mokstudio-dev.app" (no spaces) so path.txt / spawn / deep links
 * stay reliable. Display name stays "mokstudio Dev".
 *
 * Dock / Finder launches of the branded .app have NO project path, which would
 * open Electron's default_app splash. We replace MacOS/Electron with a wrapper
 * that always injects this repo path (+ starts Vite if needed).
 *
 * Uses build/icon-dev.icns (production icon + green DEV badge). DMG / release
 * builds keep build/icon.icns via electron-builder — do not point them here.
 */
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const APP_NAME = 'mokstudio Dev';
const APP_ID = 'studio.mockup.desktop.dev';
const BUNDLE_NAME = 'mokstudio-dev.app';
const WRAPPER_VERSION = '3';
/** Older brand names — migrate / remove so Dock doesn't keep stale copies. */
const LEGACY_BUNDLE_NAMES = [
  'mokstudio.app',
  'mokstudio Dev.app',
  'Mockup Studio 3D.app',
  'Mockup Studio.app',
];
const root = path.join(__dirname, '..');
const distDir = path.join(root, 'node_modules/electron/dist');
const stockAppPath = path.join(distDir, 'Electron.app');
const brandedAppPath = path.join(distDir, BUNDLE_NAME);
const pathTxt = path.join(root, 'node_modules/electron/path.txt');
const iconSrc = path.join(root, 'build/icon-dev.icns');
const stampPath = path.join(distDir, '.mockup-studio-brand');

function findExistingApp() {
  if (fs.existsSync(stockAppPath)) return stockAppPath;
  if (fs.existsSync(brandedAppPath)) return brandedAppPath;
  for (const name of LEGACY_BUNDLE_NAMES) {
    const candidate = path.join(distDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function installDevLauncher(appPath) {
  const macOs = path.join(appPath, 'Contents/MacOS');
  const launcher = path.join(macOs, 'Electron');
  const binary = path.join(macOs, 'Electron.bin');

  // First brand: rename the real Mach-O. Re-runs: keep Electron.bin, refresh wrapper.
  if (!fs.existsSync(binary) && fs.existsSync(launcher)) {
    const stat = fs.lstatSync(launcher);
    if (stat.isFile() && !stat.isSymbolicLink()) {
      // Heuristic: shell wrappers are tiny; the real Electron binary is large.
      if (stat.size > 50_000) fs.renameSync(launcher, binary);
    }
  }
  if (!fs.existsSync(binary)) {
    throw new Error(`Missing Electron binary at ${binary}`);
  }

  const script = `#!/bin/bash
# mokstudio Dev launcher (v${WRAPPER_VERSION}) — always open the repo, never default_app.
ROOT=${JSON.stringify(root)}
BIN="$(dirname "$0")/Electron.bin"
LOG=/tmp/mok-dev-launch.log
export VITE_DEV_SERVER_URL="\${VITE_DEV_SERVER_URL:-http://127.0.0.1:5175}"

# Dock/Finder launches of an .app living under ~/Downloads are blocked by macOS
# TCC (EPERM on package.json) unless Files and Folders → Downloads is granted.
# CLI launches from Cursor inherit access and skip this path.
if ! /bin/test -r "$ROOT/package.json"; then
  {
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) cannot read $ROOT/package.json (macOS Downloads TCC)"
    ls -laO@ "$ROOT/package.json" 2>&1 || true
  } >>"$LOG"
  /usr/bin/osascript <<'APPLESCRIPT' >/dev/null 2>&1 || true
display dialog "macOS blocked mokstudio Dev from reading this project in Downloads (EPERM on package.json)." & return & return & "Fix: System Settings → Privacy & Security → Files and Folders → mokstudio Dev → enable Downloads." & return & return & "Or run npm run dev from Cursor (that launch path already has access)." buttons {"Open Settings", "OK"} default button "Open Settings"
if button returned of result is "Open Settings" then
  try
    open location "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension"
  end try
end if
APPLESCRIPT
  exit 1
fi

if ! curl -sf -o /dev/null --max-time 0.4 "$VITE_DEV_SERVER_URL" 2>/dev/null; then
  (cd "$ROOT" && npx vite --host 127.0.0.1 --port 5175 --strictPort >/tmp/mok-vite.log 2>&1 &)
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    curl -sf -o /dev/null --max-time 0.4 "$VITE_DEV_SERVER_URL" 2>/dev/null && break
    sleep 0.25
  done
fi
# Prefer an explicit app arg from \`electron .\`; otherwise inject the repo root.
if [ "$#" -eq 0 ]; then
  exec "$BIN" "$ROOT"
fi
exec "$BIN" "$@"
`;
  fs.writeFileSync(launcher, script, { mode: 0o755 });
}

const existingApp = findExistingApp();
if (!existingApp) process.exit(0);

const iconHash = fs.existsSync(iconSrc)
  ? crypto.createHash('sha256').update(fs.readFileSync(iconSrc)).digest('hex')
  : 'no-icon';
const stamp = `${APP_NAME}\n${APP_ID}\n${BUNDLE_NAME}\n${iconHash}\nwrapper:${WRAPPER_VERSION}\n`;
if (fs.existsSync(stampPath) && fs.readFileSync(stampPath, 'utf8') === stamp && fs.existsSync(brandedAppPath)) {
  const expectedPath = `${BUNDLE_NAME}/Contents/MacOS/Electron`;
  const launcher = path.join(brandedAppPath, 'Contents/MacOS/Electron');
  const binary = path.join(brandedAppPath, 'Contents/MacOS/Electron.bin');
  if (
    fs.existsSync(pathTxt)
    && fs.readFileSync(pathTxt, 'utf8').trim() === expectedPath
    && fs.existsSync(binary)
    && fs.existsSync(launcher)
    && fs.readFileSync(launcher, 'utf8').includes(`v${WRAPPER_VERSION}`)
  ) {
    process.exit(0);
  }
}

const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

function unregister(appPath) {
  if (!fs.existsSync(appPath)) return;
  try {
    execFileSync(lsregister, ['-u', appPath], { stdio: 'ignore' });
  } catch {
    // Not registered yet.
  }
}

function setString(plistPath, key, value) {
  execFileSync('plutil', ['-replace', key, '-string', value, plistPath], { stdio: 'pipe' });
}

unregister(existingApp);
for (const name of LEGACY_BUNDLE_NAMES) {
  const legacy = path.join(distDir, name);
  if (legacy === existingApp || !fs.existsSync(legacy)) continue;
  unregister(legacy);
  fs.rmSync(legacy, { recursive: true, force: true });
}
if (existingApp !== brandedAppPath) {
  if (fs.existsSync(brandedAppPath)) {
    unregister(brandedAppPath);
    fs.rmSync(brandedAppPath, { recursive: true, force: true });
  }
  fs.renameSync(existingApp, brandedAppPath);
}

const plistPath = path.join(brandedAppPath, 'Contents/Info.plist');
const iconDest = path.join(brandedAppPath, 'Contents/Resources/electron.icns');
const enLproj = path.join(brandedAppPath, 'Contents/Resources/en.lproj');
const stringsPath = path.join(enLproj, 'InfoPlist.strings');

setString(plistPath, 'CFBundleName', APP_NAME);
setString(plistPath, 'CFBundleDisplayName', APP_NAME);
setString(plistPath, 'CFBundleIdentifier', APP_ID);
// Help macOS prompt for Downloads access when the Dock-launched DEV app
// reads this repo under ~/Downloads (otherwise EPERM on package.json).
try {
  setString(
    plistPath,
    'NSDownloadsFolderUsageDescription',
    'mokstudio Dev needs access to this project folder in Downloads to run the local app.',
  );
  setString(
    plistPath,
    'NSDocumentsFolderUsageDescription',
    'mokstudio Dev needs access to your documents when opening local project files.',
  );
} catch {
  /* older plists / plutil edge cases */
}

fs.mkdirSync(enLproj, { recursive: true });
fs.writeFileSync(
  stringsPath,
  `CFBundleName = "${APP_NAME}";\nCFBundleDisplayName = "${APP_NAME}";\n`,
  'utf8',
);

if (fs.existsSync(iconSrc)) fs.copyFileSync(iconSrc, iconDest);
installDevLauncher(brandedAppPath);
// CLI (`electron .`) must call the Mach-O binary directly. The shell wrapper is
// only for Dock / Finder launches — and still needs Downloads TCC for ~/Downloads.
// No trailing newline — electron/index.js does not trim path.txt.
fs.writeFileSync(pathTxt, `${BUNDLE_NAME}/Contents/MacOS/Electron.bin`);

execFileSync('codesign', ['--force', '--sign', '-', brandedAppPath], { stdio: 'inherit' });
execFileSync('touch', [brandedAppPath]);

try {
  execFileSync(lsregister, ['-f', brandedAppPath], { stdio: 'ignore' });
} catch {
  // Dock picks up the new name on the next launch.
}

fs.writeFileSync(stampPath, stamp);
