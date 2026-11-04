#!/usr/bin/env node
/**
 * Issue signed Mockup Studio license keys (Ed25519).
 *
 * Usage:
 *   node scripts/issue-license.mjs --init          # create keypair (once)
 *   node scripts/issue-license.mjs pro
 *   node scripts/issue-license.mjs pro_max
 *   node scripts/issue-license.mjs update_pass
 *
 * Private key: scripts/.license-private-key.pem (gitignored)
 * Public key:  copied into src/lib/licensePublicKey.ts by --init
 */

import { generateKeyPairSync, createPrivateKey, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const privPath = join(root, 'scripts/.license-private-key.pem');
const pubModulePath = join(root, 'src/lib/licensePublicKey.ts');

const TIERS = new Set(['pro', 'pro_max', 'update_pass']);

function prefixFor(tier) {
  if (tier === 'pro_max') return 'MS-PROMAX';
  if (tier === 'update_pass') return 'MS-UPDATE';
  return 'MS-PRO';
}

function initKeys() {
  mkdirSync(join(root, 'scripts'), { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubB64 = Buffer.from(publicKey.export({ type: 'spki', format: 'der' })).toString('base64');
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  writeFileSync(privPath, privPem);
  writeFileSync(
    pubModulePath,
    `/**
 * Ed25519 public key (SPKI, base64) used to verify offline license keys.
 * Matching private key lives in scripts/.license-private-key.pem (gitignored).
 * Regenerate with: node scripts/issue-license.mjs --init
 */
export const LICENSE_PUBLIC_KEY_SPKI_B64 =
  '${pubB64}';
`,
  );
  console.log('Wrote', privPath);
  console.log('Wrote', pubModulePath);
  console.log('Keep the private key secret. Commit only the public key module.');
}

function issue(tier) {
  if (!existsSync(privPath)) {
    console.error('Missing private key. Run: node scripts/issue-license.mjs --init');
    process.exit(1);
  }
  const privateKey = createPrivateKey(readFileSync(privPath));
  const payload = JSON.stringify({ v: 1, tier, iat: Math.floor(Date.now() / 1000) });
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url');
  const key = `${prefixFor(tier)}.${payloadB64}.${sig}`;
  console.log(key);
}

const arg = process.argv[2];
if (arg === '--init') {
  if (existsSync(privPath)) {
    console.error('Private key already exists at', privPath);
    console.error('Delete it first if you intentionally want to rotate keys.');
    process.exit(1);
  }
  initKeys();
} else if (TIERS.has(arg)) {
  issue(arg);
} else {
  console.error('Usage: node scripts/issue-license.mjs --init | pro | pro_max | update_pass');
  process.exit(1);
}
