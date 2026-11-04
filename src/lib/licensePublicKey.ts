/**
 * Ed25519 public key (SPKI, base64) used to verify offline license keys.
 * Matching private key lives in scripts/.license-private-key.pem (gitignored).
 * Regenerate with: node scripts/issue-license.mjs --init
 */
export const LICENSE_PUBLIC_KEY_SPKI_B64 =
  'MCowBQYDK2VwAyEABiwn9tzv0m4fMooLlx0Yiyh/XL7e3KKVeXMDZBPlj1s=';
