/**
 * Dev launches Electron.app itself, so macOS shows "Electron" and the Electron
 * icon until that bundle is branded. Reapplies after npm install.
 *
 * CFBundleIdentifier must leave com.github.Electron — otherwise Launch Services
 * merges this with every other Electron.app on the machine and the Dock/menu
 * keep the generic "Electron" name.
 *
 * The Dock label follows the .app filename, so we rename Electron.app →
 * "mokstudio.app" and rewrite electron/path.txt to match.
 */
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const APP_NAME = 'mokstudio';
const APP_ID = 'studio.mockup.desktop';
const BUNDLE_NAME = `${APP_NAME}.app`;
const root = path.join(__dirname, '..');
const distDir = path.join(root, 'node_modules/electron/dist');
const stockAppPath = path.join(distDir, 'Electron.app');
const brandedAppPath = path.join(distDir, BUNDLE_NAME);
const pathTxt = path.join(root, 'node_modules/electron/path.txt');
const iconSrc = path.join(root, 'build/icon.icns');
const stampPath = path.join(distDir, '.mockup-studio-brand');

if (!fs.existsSync(stockAppPath) && !fs.existsSync(brandedAppPath)) process.exit(0);

const iconHash = fs.existsSync(iconSrc)
  ? crypto.createHash('sha256').update(fs.readFileSync(iconSrc)).digest('hex')
  : 'no-icon';
const stamp = `${APP_NAME}\n${APP_ID}\n${BUNDLE_NAME}\n${iconHash}\n`;
if (fs.existsSync(stampPath) && fs.readFileSync(stampPath, 'utf8') === stamp && fs.existsSync(brandedAppPath)) {
  const expectedPath = `${BUNDLE_NAME}/Contents/MacOS/Electron`;
  if (fs.existsSync(pathTxt) && fs.readFileSync(pathTxt, 'utf8').trim() === expectedPath) process.exit(0);
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

// Prefer renaming the stock bundle; if a previous brand left only the renamed app, reuse it.
if (fs.existsSync(stockAppPath)) {
  unregister(stockAppPath);
  if (fs.existsSync(brandedAppPath)) {
    fs.rmSync(brandedAppPath, { recursive: true, force: true });
  }
  fs.renameSync(stockAppPath, brandedAppPath);
} else if (!fs.existsSync(brandedAppPath)) {
  process.exit(0);
}

const plistPath = path.join(brandedAppPath, 'Contents/Info.plist');
const iconDest = path.join(brandedAppPath, 'Contents/Resources/electron.icns');
const enLproj = path.join(brandedAppPath, 'Contents/Resources/en.lproj');
const stringsPath = path.join(enLproj, 'InfoPlist.strings');

setString(plistPath, 'CFBundleName', APP_NAME);
setString(plistPath, 'CFBundleDisplayName', APP_NAME);
setString(plistPath, 'CFBundleIdentifier', APP_ID);

fs.mkdirSync(enLproj, { recursive: true });
fs.writeFileSync(
  stringsPath,
  `CFBundleName = "${APP_NAME}";\nCFBundleDisplayName = "${APP_NAME}";\n`,
  'utf8',
);

if (fs.existsSync(iconSrc)) fs.copyFileSync(iconSrc, iconDest);
fs.writeFileSync(pathTxt, `${BUNDLE_NAME}/Contents/MacOS/Electron`);

execFileSync('codesign', ['--force', '--sign', '-', brandedAppPath], { stdio: 'inherit' });
execFileSync('touch', [brandedAppPath]);

try {
  execFileSync(lsregister, ['-f', brandedAppPath], { stdio: 'ignore' });
} catch {
  // Dock picks up the new name on the next launch.
}

fs.writeFileSync(stampPath, stamp);
