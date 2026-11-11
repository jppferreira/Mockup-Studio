# Rotate a leaked Stripe secret key

Use this when a Stripe **secret** key (`sk_test_…` / `sk_live_…`) appeared on a shell command line, in chat, or in a log. Publishable keys (`pk_…`) are not covered here.

This pass keeps **`STRIPE_MODE=test`** — do not flip to live as part of rotation.

## What leaked (this incident)

| Where | Committed? | Status after scrub |
|-------|------------|--------------------|
| Agent terminal log (`…/terminals/190254.txt`) — `export STRIPE_SECRET_KEY='sk_test_…'` then `curl -u` | No | Replaced with `"$STRIPE_SECRET_KEY"` |
| Agent tools dump of the same command | No | Same scrub |
| Cursor project terminal (`~/.cursor/projects/…/terminals/1.txt`) — `supabase secrets set STRIPE_SECRET_KEY=sk_test_…` on argv | No | Replaced with `"$STRIPE_SECRET_KEY"` |
| Repo source, `.env.example`, website env files, git history | No `sk_test_` / `sk_live_` values found | Unchanged |

Treat **every** test secret that was pasted onto argv as compromised, even if suffixes differed.

## Dashboard steps (you must do these)

1. Open [Stripe Dashboard → Developers → API keys](https://dashboard.stripe.com/test/apikeys)  
   Ensure the toggle is **Test mode** (not Live).
2. Under **Standard keys**, find **Secret key**.
3. Click **Roll key** (or **Reveal** then the roll / create replacement control — wording varies).
4. Confirm the roll. Stripe issues a **new** `sk_test_…` and schedules the old key to expire (note the expiry window Stripe shows).
5. Copy the **new** secret once into a password manager. Do **not** paste it into chat, commits, or unquoted shell history.
6. (Optional but recommended) Open [Developers → API keys → Restricted keys](https://dashboard.stripe.com/test/apikeys) and revoke any restricted keys you no longer need if they were also exposed.

## After you have the new test secret

Update Supabase **without** putting the raw key on the interactive shell argv. Prefer an env-file:

```bash
# 1) Create a gitignored temp file (paste the NEW key only into this file)
cat > /tmp/mokstudio-stripe-test.env <<'EOF'
STRIPE_SECRET_KEY=sk_test_PASTE_NEW_KEY_HERE
STRIPE_SECRET_KEY_TEST=sk_test_PASTE_NEW_KEY_HERE
EOF
chmod 600 /tmp/mokstudio-stripe-test.env

# 2) Push to the project (stay on test mode — do not set STRIPE_MODE=live)
npx supabase secrets set --env-file /tmp/mokstudio-stripe-test.env \
  --project-ref kpgukqklgkvnvlukjhqc

# 3) Delete the temp file
rm -P /tmp/mokstudio-stripe-test.env 2>/dev/null || rm /tmp/mokstudio-stripe-test.env

# 4) Confirm names only (digests change; values are never shown)
npx supabase secrets list --project-ref kpgukqklgkvnvlukjhqc | rg 'STRIPE_SECRET|STRIPE_MODE|NAME|---'
```

Leave `STRIPE_MODE` as `test`.

## Local Stripe API calls (no inline keys)

```bash
# Load the new key into the environment from your password manager, then:
export STRIPE_SECRET_KEY   # already set in this shell — do not echo it
./scripts/stripe-api.sh GET /v1/balance
./scripts/stripe-api.sh POST /v1/products/prod_xxx -d active=false
```

## Verify rotation

1. Call with the **old** key (from password manager history only — not from this repo): expect `401` / invalid API key after Stripe expires it.
2. Call with the **new** key via `./scripts/stripe-api.sh GET /v1/balance`: expect HTTP 200 JSON.
3. Smoke a test checkout from the app/site while still in test mode.

## Do not

- Commit `.env` files or `/tmp/*stripe*.env`
- Paste `sk_test_` / `sk_live_` into Cursor chat or agent prompts
- Run `supabase secrets set STRIPE_SECRET_KEY=sk_test_…` with the value on argv
- Flip `STRIPE_MODE` / `VITE_STRIPE_MODE` to `live` as part of this rotation
