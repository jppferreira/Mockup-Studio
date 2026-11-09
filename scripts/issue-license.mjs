#!/usr/bin/env node
/**
 * Issue signed mokstudio license keys (Ed25519).
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

import { existsSync } from 'node:fs';
import {
  DEFAULT_PRIV_PATH,
  DEFAULT_PUB_MODULE_PATH,
  TIERS,
  initKeypair,
  signLicense,
} from './lib/sign-license.mjs';

const arg = process.argv[2];

if (arg === '--init') {
  if (existsSync(DEFAULT_PRIV_PATH)) {
    console.error('Private key already exists at', DEFAULT_PRIV_PATH);
    console.error('Delete it first if you intentionally want to rotate keys.');
    process.exit(1);
  }
  const result = initKeypair(DEFAULT_PRIV_PATH, DEFAULT_PUB_MODULE_PATH);
  console.log('Wrote', result.privPath);
  console.log('Wrote', result.pubModulePath);
  console.log('Keep the private key secret. Commit only the public key module.');
} else if (TIERS.includes(arg)) {
  const { key } = signLicense(/** @type {'pro' | 'pro_max' | 'update_pass'} */ (arg));
  console.log(key);
} else {
  console.error('Usage: node scripts/issue-license.mjs --init | pro | pro_max | update_pass');
  process.exit(1);
}
