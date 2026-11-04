# License fulfillment server

After Lemon Squeezy or Paddle reports a paid order, this service:

1. Verifies the webhook signature  
2. Maps variant/price → `pro` | `pro_max` | `update_pass`  
3. Signs an offline key (`scripts/lib/sign-license.mjs`)  
4. Emails the buyer via **Resend** (or dry-runs to the console)  
5. Stores the order id so retries are idempotent (`server/data/issued-licenses.json`)

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness |
| `POST` | `/webhooks/lemonsqueezy` | Lemon Squeezy (`X-Signature`) |
| `POST` | `/webhooks/paddle` | Paddle Billing (`Paddle-Signature`) |
| `POST` | `/recover/request` | Email a 6-digit code to the purchase address |
| `POST` | `/recover/confirm` | Verify code → mint + email a **new** signed key |
| `POST` | `/dev/fulfill` | Local test — header `X-Fulfill-Secret` |

Buyer UI: website `/recover` ([`website/src/pages/RecoverPage.tsx`](../website/src/pages/RecoverPage.tsx)). App License modal links there.

## Setup

```bash
cp server/.env.example server/.env
# ensure scripts/.license-private-key.pem exists (npm run license:issue --init once)
npm run fulfill:dev
```

Point Lemon/Paddle webhook URLs at your public HTTPS URL (use ngrok locally):

- `https://<host>/webhooks/lemonsqueezy`
- `https://<host>/webhooks/paddle`

Set success URL on checkout to `https://mockupstudio.app/thanks?plan=pro` (etc.).

## Local test (no store)

```bash
npm run fulfill:dev

curl -s http://127.0.0.1:8787/health

curl -s -X POST http://127.0.0.1:8787/dev/fulfill \
  -H 'Content-Type: application/json' \
  -H 'X-Fulfill-Secret: dev-secret' \
  -d '{"email":"you@example.com","tier":"pro","orderId":"test-1"}'
```

Without `RESEND_API_KEY`, the key is printed in the server console (dry-run) and returned in the JSON. Paste it into the Mac app License modal.

## Recover / reissue (local)

Seed an order, then run the OTP flow:

```bash
# terminal A
npm run fulfill:dev

# terminal B — create a fake purchase record
curl -s -X POST http://127.0.0.1:8787/dev/fulfill \
  -H 'Content-Type: application/json' \
  -H 'X-Fulfill-Secret: dev-secret' \
  -d '{"email":"you@example.com","tier":"pro","orderId":"recover-demo-1"}'

# request code (dry-run returns devCode)
curl -s -X POST http://127.0.0.1:8787/recover/request \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com"}'

# confirm with the printed / returned code
curl -s -X POST http://127.0.0.1:8787/recover/confirm \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","code":"123456"}'
```

Or open `http://127.0.0.1:5180/recover` with `npm run website` while the fulfill server is up.

## Production notes

- Keep `scripts/.license-private-key.pem` / `LICENSE_PRIVATE_KEY_PEM` only on the server.
- Prefer Resend with a verified domain for `LICENSE_EMAIL_FROM`.
- Replace the JSON store with a real DB when you outgrow a single instance.
