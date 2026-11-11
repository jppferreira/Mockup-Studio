# mokstudio backlog

Open follow-ups that are not blocking day-to-day development.

## Verification

### Stripe refund end-to-end — **DONE** (2026-11-11, test mode)

**Goal:** Prove `charge.refunded` handling in `supabase/functions/stripe-webhook` matches product intent.

**How run:** Stripe **test mode** only (`sk_test_…`). Temporarily set Supabase `STRIPE_MODE=test`, recreated test webhook endpoint `we_1UadmYDlgYc5gcn6EqKSk2Cg` → edge function URL, synced `STRIPE_WEBHOOK_SECRET`. Posted signed events to `…/functions/v1/stripe-webhook` (HMAC matching this repo’s verifier). Created real test PaymentIntents/refunds via Stripe API against customer `cus_VbrTfevPL4HYX3` / user `tier-pro@mokstudio.test`. Restored `STRIPE_MODE=live` afterward. No live keys used for charges.

| Check | Result |
|-------|--------|
| Webhook accepts `charge.refunded` (HTTP 200) | **Pass** |
| Full refund of one-time **Pro** → `tier/plan=free`, `status=revoked` | **Pass** |
| `plan=monthly` + `charge.refunded` → **not** revoked (skipped) | **Pass** |
| Partial refund (`charge.refunded === false`, £10 of £50) → entitlement unchanged (`pro`/`active`) | **Pass (gap confirmed)** |

**Partial-refund gap:** Confirmed no-op. Product decision still open: whether partial refunds should revoke/reduce entitlements.

**Follow-up — webhook signature algorithm:** This edge function verifies signatures with HMAC over the **raw `whsec_…` string**. Stripe’s official libraries use the **base64-decoded** secret after the `whsec_` prefix. A probe with Stripe-style (b64) signing returned `400 invalid_signature`; raw-string signing returned `200`. After real test refunds, Stripe still showed `pending_webhooks: 1` on events — native Dashboard delivery may be failing verification. Fix `verifyStripeSignature` to match Stripe’s algorithm (and keep test coverage) so live/test Dashboard deliveries succeed without manual signed posts.

**Related code:** `supabase/functions/stripe-webhook/index.ts` → `handleRefund`.
