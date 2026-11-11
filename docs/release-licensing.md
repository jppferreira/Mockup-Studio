# Mockup Studio — Licensing, Distribution & Release Checklist

One Supabase account powers **web**, **direct Mac (DMG)**, and **Mac App Store** clients. Paid access is stored in `mokstudio_entitlements` and is never trusted from a client-side `isPro` flag.

## How the three clients share one licence

1. Customer signs in with Supabase Auth (email OTP / Google / Apple).
2. Stripe Checkout or Apple IAP completes on a trusted backend path.
3. Edge Functions upsert `mokstudio_entitlements` (tier, plan, status, provider refs, period end).
4. Every signed-in client reads that row (RLS: own row only) and refreshes local licence state.
5. Direct Mac builds may also cache a **7-day signed offline entitlement** (`MS-OFFLINE…`) for offline use.

Apple subscriptions stay managed in Apple; Stripe subscriptions stay managed in Stripe. Providers are not auto-migrated.

## Environments

| Env | Purpose |
|-----|---------|
| Development | Local Vite + Electron; Stripe test mode; Apple sandbox |
| Staging | Separate Supabase project + Stripe webhook endpoint |
| Production | Live Stripe prices, ASSN production, notarised DMG, App Store build |

## Required secrets (never commit)

### Supabase Edge Functions
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_MODE` (`test` | `live`; default `test`)
- `STRIPE_SECRET_KEY_TEST` / `STRIPE_SECRET_KEY_LIVE` (live required when mode is live; legacy `STRIPE_SECRET_KEY` still works for test)
- `STRIPE_WEBHOOK_SECRET_TEST` / `STRIPE_WEBHOOK_SECRET_LIVE` (legacy `STRIPE_WEBHOOK_SECRET` for test)
- `STRIPE_PUBLISHABLE_KEY_TEST` / `STRIPE_PUBLISHABLE_KEY_LIVE` (optional server-side; website uses `VITE_*`)
- `STRIPE_PRICE_*_TEST` / `STRIPE_PRICE_*_LIVE` (or legacy unprefixed `STRIPE_PRICE_PRO` / `_PRO_MAX` / `_UPDATE_PASS` / `_MONTHLY` / `_YEARLY` / `_LIFETIME`)
- `SITE_URL`
- `LICENSE_PRIVATE_KEY_PEM` (offline entitlement signing; same key family as licence keys)

### Marketing website (`website/.env.*`)
- `VITE_STRIPE_MODE` (`test` | `live`; default `test`)
- `VITE_STRIPE_PUBLISHABLE_KEY_TEST` / `VITE_STRIPE_PUBLISHABLE_KEY_LIVE`

### Direct Mac signing & updates
- Developer ID Application certificate (`CSC_LINK` / Keychain)
- Notary: `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` (+ `APPLE_TEAM_ID`)
- `GH_TOKEN` with release permissions for `latest-mac.yml` publish

### Mac App Store (separate)
- Mac App Store distribution certificate
- `build/mas.provisionprofile`
- App Store Connect IAP products + ASSN URL → `apple-assn`
- Native StoreKit bridge (Electron does not ship full StoreKit; implement via native helper / module)

## Apply database migration

```bash
# From repo root, with Supabase CLI linked to the project:
npx supabase db push
# or apply supabase/migrations/20261111090000_mokstudio_entitlements_v2.sql in the SQL editor
```

## Deploy Edge Functions

```bash
npx supabase functions deploy create-checkout
npx supabase functions deploy billing-portal
npx supabase functions deploy stripe-webhook
npx supabase functions deploy bind-device
npx supabase functions deploy issue-offline-entitlement
npx supabase functions deploy apple-assn
npx supabase functions deploy bind-license
```

Point Stripe webhooks to:
`https://<project>.supabase.co/functions/v1/stripe-webhook`

Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `charge.refunded`.

## Direct-download release checklist

1. Bump `version` in `package.json` (semantic).
2. Run tests: `npm test` and `npx tsc --noEmit`.
3. Build & sign: `npm run dist:mac` (or GitHub Action **Release macOS** with publish).
4. Confirm artifacts under `release/direct/`:
   - `.dmg` (website installer for new users)
   - `.zip` + `latest-mac.yml` (+ blockmap) for `electron-updater`
5. Publish GitHub Release assets (electron-builder `--publish`).
6. Update website `VITE_DOWNLOAD_MAC_URL` / releases listing to the new DMG.
7. Smoke-test: install previous version → receives update → scenes/settings intact.
8. Do **not** treat a git push alone as a software release.

## Mac App Store release checklist

1. `npm run dist:mac:mas` with provisioning profile present.
2. Verify App Sandbox behaviour (import/export, models, video, storage).
3. Confirm electron-updater is **disabled** (`process.mas` / `MOCKUP_DISTRIBUTION=mac_mas`).
4. Configure IAP products; set `appAccountToken` to the Supabase user UUID at purchase.
5. Upload via Transporter / Xcode / `xcrun altool` / Notary+ASC tools as appropriate.
6. Submit for review only after explicit approval — CI does not auto-submit.

## Acceptance notes

- Cancelled Stripe/Apple subscriptions keep access until `period_end`.
- Lifetime grants keep `period_end` null and are not expired by subscription logic.
- MAS builds ignore the direct-download two-device seat cap.
- Offline tokens expire after seven days and revalidate when online.

## Secret hygiene

- Never put `sk_test_` / `sk_live_` on a shell argv, in chat, or in commits.
- If a secret was exposed, follow **[stripe-secret-rotation.md](./stripe-secret-rotation.md)** (stay on test mode until the live cutover checklist below).
- Local Stripe REST calls: `./scripts/stripe-api.sh` with `STRIPE_SECRET_KEY` set in the environment.

## Remaining credential-blocked work

- Rotate any leaked test secret (see stripe-secret-rotation.md), then update Supabase `STRIPE_SECRET_KEY` / `STRIPE_SECRET_KEY_TEST`
- Fill `STRIPE_SECRET_KEY_LIVE`, `STRIPE_WEBHOOK_SECRET_LIVE`, live price IDs, and `VITE_STRIPE_PUBLISHABLE_KEY_LIVE`, then flip `STRIPE_MODE` / `VITE_STRIPE_MODE` to `live`
- Apple StoreKit native bridge + production JWS certificate chain validation
- Notarised CI signing secrets on GitHub Actions
- Applying the v2 migration + deploying functions to the linked Supabase project (MCP SQL was unauthorized from this agent session — use CLI/dashboard)

## Verification backlog

- **Stripe refund E2E** — **done (test mode, 2026-11-11):** full Pro refund revokes; monthly skipped; partial refund no-op confirmed. See [backlog.md](./backlog.md). Follow-up: fix webhook signature verify to Stripe’s base64 `whsec_` algorithm so native Stripe deliveries succeed.

