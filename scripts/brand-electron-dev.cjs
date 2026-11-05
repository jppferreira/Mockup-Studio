/**
 * Dev launches Electron.app itself, so macOS shows "Electron" and the Electron
 * icon until that bundle is branded. Reapplies after npm install.
 *
 * CFBundleIdentifier must leave com.github.Electron — otherwise Launch Services
 * merges this with every other Electron.app on the machine and the Dock/menu
 * keep the generic "Electron" name.
 */
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const APP_NAME = 'Mockup Studio';
const APP_ID = 'studio.mockup.desktop';
const root = path.join(__dirname, '..');
const appPath = path.join(root, 'node_modules/electron/dist/Electron.app');
const plistPath = path.join(appPath, 'Contents/Info.plist');
const iconSrc = path.join(root, 'build/icon.icns');
const iconDest = path.join(appPath, 'Contents/Resources/electron.icns');
const stampPath = path.join(root, 'node_modules/electron/dist/.mockup-studio-brand');

if (!fs.existsSync(plistPath) || !fs.existsSync(iconSrc)) process.exit(0);

const stamp = `${APP_NAME}\n${APP_ID}\n${crypto.createHash('sha256').update(fs.readFileSync(iconSrc)).digest('hex')}\n`;
if (fs.existsSync(stampPath) && fs.readFileSync(stampPath, 'utf8') === stamp) process.exit(0);

function plist(command) {
  execFileSync('/usr/libexec/PlistBuddy', ['-c', command, plistPath], { stdio: 'pipe' });
}

function setString(key, value) {
  try {
    plist(`Set :${key} ${value}`);
  } catch {
    plist(`Add :${key} string ${value}`);
  }
}

setString('CFBundleName', APP_NAME);
setString('CFBundleDisplayName', APP_NAME);
setString('CFBundleIdentifier', APP_ID);
fs.copyFileSync(iconSrc, iconDest);
execFileSync('codesign', ['--force', '--sign', '-', appPath], { stdio: 'inherit' });
execFileSync('touch', [appPath]);

const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
try {
  execFileSync(lsregister, ['-f', appPath], { stdio: 'ignore' });
} catch {
  // Dock still picks up the new name and icon on the next launch.
}

fs.writeFileSync(stampPath, stamp);
