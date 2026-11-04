/**
 * Shared Ed25519 license signing for CLI + fulfillment server.
 */
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TIERS = /** @type {const} */ (['pro', 'pro_max', 'update_pass']);

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_PRIV_PATH = join(root, 'scripts/.license-private-key.pem');
export const DEFAULT_PUB_MODULE_PATH = join(root, 'src/lib/licensePublicKey.ts');

/** @param {string} tier */
export function prefixFor(tier) {
  if (tier === 'pro_max') return 'MS-PROMAX';
  if (tier === 'update_pass') return 'MS-UPDATE';
  return 'MS-PRO';
}

/** @param {string} tier */
export function planLabel(tier) {
  if (tier === 'pro_max') return 'Pro Max';
  if (tier === 'update_pass') return 'Update Pass';
  return 'Pro';
}

/**
 * @param {string} [privPath]
 * @param {string} [pubModulePath]
 */
export function initKeypair(privPath = DEFAULT_PRIV_PATH, pubModulePath = DEFAULT_PUB_MODULE_PATH) {
  if (existsSync(privPath)) {
    throw new Error(`Private key already exists at ${privPath}`);
  }
  mkdirSync(dirname(privPath), { recursive: true });
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
  return { privPath, pubModulePath, pubB64 };
}

/**
 * Load private key from PEM file or LICENSE_PRIVATE_KEY_PEM env.
 * @param {{ privPath?: string, pem?: string }} [opts]
 */
export function loadPrivateKey(opts = {}) {
  const pemFromEnv = opts.pem ?? process.env.LICENSE_PRIVATE_KEY_PEM;
  if (pemFromEnv && pemFromEnv.trim()) {
    return createPrivateKey(pemFromEnv.replace(/\\n/g, '\n'));
  }
  const privPath = opts.privPath ?? DEFAULT_PRIV_PATH;
  if (!existsSync(privPath)) {
    throw new Error(
      `Missing private key. Set LICENSE_PRIVATE_KEY_PEM or create ${privPath} via: node scripts/issue-license.mjs --init`,
    );
  }
  return createPrivateKey(readFileSync(privPath));
}

/**
 * @param {'pro' | 'pro_max' | 'update_pass'} tier
 * @param {{ privPath?: string, pem?: string, iat?: number, nonce?: string }} [opts]
 * @returns {{ key: string, tier: string, payload: object }}
 */
export function signLicense(tier, opts = {}) {
  if (!TIERS.includes(tier)) {
    throw new Error(`Unknown tier: ${tier}`);
  }
  const privateKey = loadPrivateKey(opts);
  /** @type {{ v: number, tier: string, iat: number, n?: string }} */
  const payloadObj = {
    v: 1,
    tier,
    iat: opts.iat ?? Math.floor(Date.now() / 1000),
  };
  // Optional nonce so reissues in the same second still produce a distinct key.
  // The Mac app verifies the raw payload bytes and ignores unknown fields.
  if (opts.nonce) payloadObj.n = opts.nonce;
  const payload = JSON.stringify(payloadObj);
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url');
  const key = `${prefixFor(tier)}.${payloadB64}.${sig}`;
  return { key, tier, payload: payloadObj };
}
