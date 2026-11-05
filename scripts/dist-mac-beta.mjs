#!/usr/bin/env node
/**
 * Build a Gatekeeper-friendly open-beta Mac DMG:
 * Developer ID sign + Apple notarize + staple.
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const IDENTITY =
  process.env.CSC_NAME ||
  'Developer ID Application: Joao Ferreira (HG7F63WLGK)';

function hasIdentity(name) {
  try {
    const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
      encoding: 'utf8',
    });
    return out.includes(name) || out.includes('Developer ID Application:');
  } catch {
    return false;
  }
}

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(path.join(root, '.env.local'));
loadEnvFile(path.join(root, 'signing', '.env'));

if (!hasIdentity(IDENTITY)) {
  console.error(`
Missing Developer ID Application certificate in Keychain.

Gatekeeper will keep blocking other Macs until you install one:

  1. Open https://developer.apple.com/account/resources/certificates/list
  2. + → "Developer ID Application" → create with a CSR
     (or Xcode → Settings → Accounts → Manage Certificates → + Developer ID Application)
  3. Double-click the downloaded .cer to install into login Keychain
  4. Re-run: npm run dist:mac:beta

Expected identity:
  ${IDENTITY}
`);
  process.exit(1);
}

const hasApi =
  process.env.APPLE_API_KEY &&
  process.env.APPLE_API_KEY_ID &&
  process.env.APPLE_API_ISSUER;
const hasPassword =
  process.env.APPLE_ID &&
  (process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_ID_PASSWORD);

if (!hasApi && !hasPassword) {
  console.error(`
Developer ID is installed, but notarization credentials are missing.

Add to .env.local (or signing/.env):

  APPLE_TEAM_ID=HG7F63WLGK
  APPLE_ID=your@email.com
  APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx

Create the app-specific password at:
  https://appleid.apple.com/account/manage → App-Specific Passwords

Or use an App Store Connect API key:
  APPLE_API_KEY=.../AuthKey_XXXXXX.p8
  APPLE_API_KEY_ID=XXXXXX
  APPLE_API_ISSUER=<issuer uuid>
`);
  process.exit(1);
}

process.env.CSC_NAME = IDENTITY;
process.env.APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || 'HG7F63WLGK';
process.env.REQUIRE_NOTARIZE = '1';
delete process.env.SKIP_NOTARIZE;

console.log(`[dist:mac:beta] Signing as: ${IDENTITY}`);
execSync('npm run build', { stdio: 'inherit' });
execSync(
  `npx electron-builder --mac dmg zip --arm64 -c.mac.identity="${IDENTITY}"`,
  { stdio: 'inherit', env: process.env },
);
console.log('[dist:mac:beta] Done — upload release/*.dmg as a GitHub pre-release.');
