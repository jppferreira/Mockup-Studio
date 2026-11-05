/**
 * Notarize the Mac .app after electron-builder signs it (Developer ID).
 *
 * Required env (pick one auth method):
 *   1) App Store Connect API key:
 *        APPLE_API_KEY=AuthKey_XXXXXX.p8 path (or basename if in cwd/private_keys)
 *        APPLE_API_KEY_ID=XXXXXX
 *        APPLE_API_ISSUER=<uuid>
 *   2) Apple ID + app-specific password:
 *        APPLE_ID=you@example.com
 *        APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
 *        APPLE_TEAM_ID=HG7F63WLGK
 *
 * Skip with: SKIP_NOTARIZE=1
 */
const path = require('node:path');
const fs = require('node:fs');
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;
  if (process.env.SKIP_NOTARIZE === '1') {
    console.log('[notarize] SKIP_NOTARIZE=1 — skipping');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  const appBundleId = context.packager.appInfo.id;

  const teamId = process.env.APPLE_TEAM_ID || 'HG7F63WLGK';
  const apiKey = process.env.APPLE_API_KEY || process.env.APPLE_API_KEY_PATH;
  const apiKeyId = process.env.APPLE_API_KEY_ID;
  const apiIssuer = process.env.APPLE_API_ISSUER;
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_ID_PASSWORD;

  const hasApi = Boolean(apiKey && apiKeyId && apiIssuer);
  const hasPassword = Boolean(appleId && appleIdPassword && teamId);

  if (!hasApi && !hasPassword) {
    if (process.env.REQUIRE_NOTARIZE === '1') {
      throw new Error(
        '[notarize] Missing Apple credentials.\n' +
          'Set APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER\n' +
          'or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID',
      );
    }
    console.warn(
      '[notarize] No Apple credentials — skipping. Use npm run dist:mac:beta for shippable builds.',
    );
    return;
  }

  // Ensure we are not trying to notarize a Development-signed binary.
  const { execFileSync } = require('node:child_process');
  let authority = '';
  try {
    authority = execFileSync('codesign', ['-dv', '--verbose=2', appPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    authority = String(err.stderr || err.stdout || '');
  }
  if (!/Authority=Developer ID Application:/.test(authority)) {
    throw new Error(
      '[notarize] App is not signed with Developer ID Application.\n' +
        'Create/install that certificate in Keychain, then rebuild.\n' +
        `codesign report:\n${authority}`,
    );
  }

  console.log(`[notarize] Submitting ${appPath} (${appBundleId})…`);

  const opts = {
    appPath,
    appBundleId,
  };

  if (hasApi) {
    let keyPath = apiKey;
    if (!fs.existsSync(keyPath)) {
      const candidates = [
        path.resolve(apiKey),
        path.join(process.cwd(), apiKey),
        path.join(process.env.HOME || '', 'private_keys', path.basename(apiKey)),
        path.join(process.env.HOME || '', '.appstoreconnect', 'private_keys', path.basename(apiKey)),
      ];
      keyPath = candidates.find((p) => fs.existsSync(p)) || apiKey;
    }
    Object.assign(opts, {
      tool: 'notarytool',
      appleApiKey: keyPath,
      appleApiKeyId: apiKeyId,
      appleApiIssuer: apiIssuer,
    });
  } else {
    Object.assign(opts, {
      tool: 'notarytool',
      appleId,
      appleIdPassword,
      teamId,
    });
  }

  await notarize(opts);
  console.log('[notarize] Done — staple will run via electron-builder');
};
