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
| `POST` | `/feedback` | Product feedback / contact form → `FEEDBACK_INBOX` via Resend |

Buyer UI: website `/recover` ([`website/src/pages/RecoverPage.tsx`](../website/src/pages/RecoverPage.tsx)). App License modal links there.

App **Send feedback** and website **Contact / feedback** both call `POST /feedback` when `VITE_FULFILL_API_URL` is set (see root `.env.example` / `.env.local`).

## Setup

```bash
cp server/.env.example server/.env
# ensure scripts/.license-private-key.pem exists (npm run license:issue --init once)
npm run fulfill:dev
```

### Resend (feedback + license mail)

1. Create an API key at [resend.com/api-keys](https://resend.com/api-keys).
2. In `server/.env` set:
   - `RESEND_API_KEY=re_...`
   - `FEEDBACK_INBOX=hello@jppferreira.com` (delivery address)
   - `LICENSE_EMAIL_FROM="Mockup Studio <onboarding@resend.dev>"` for sandbox, or a verified domain sender for production
3. In the app / website `.env.local` set `VITE_FULFILL_API_URL=http://127.0.0.1:8787` (or your production fulfill URL).
4. Restart `npm run fulfill:dev`. Without `RESEND_API_KEY`, `/feedback` still returns `ok` and prints a dry-run to the server console.

```bash
curl -s -X POST http://127.0.0.1:8787/feedback \
  -H 'Content-Type: application/json' \
  -d '{"message":"hello","topic":"Other","email":"you@example.com","intent":"feedback"}'
```

Point Lemon/Paddle webhook URLs at your public HTTPS URL (use ngrok locally):

- `https://<host>/webhooks/lemonsqueezy`
- `https://<host>/webhooks/paddle`

Set success URL on checkout to `https://mokstudio.io/thanks?plan=pro` (etc.).

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
