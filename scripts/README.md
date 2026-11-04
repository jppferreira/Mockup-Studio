# License key tooling

Issue Ed25519-signed keys for direct-download / website purchases.

Shared signer: `scripts/lib/sign-license.mjs` (used by this CLI and `server/`).

```bash
# Create scripts/.license-private-key.pem (gitignored) and refresh the public key module
node scripts/issue-license.mjs --init

npm run license:issue -- pro
npm run license:issue -- pro_max
npm run license:issue -- update_pass
```

Automated post-purchase email: `npm run fulfill:dev` — see `server/README.md`.

Keep the private key offline (password manager / CI secret). Only `src/lib/licensePublicKey.ts` is committed.

Mac App Store builds will unlock the same tiers via StoreKit later — do not email website keys for MAS purchases.
