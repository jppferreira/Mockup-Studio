#!/usr/bin/env bash
# Thin Stripe API helper — never put sk_test_ / sk_live_ on the command line.
#
# Usage:
#   export STRIPE_SECRET_KEY='sk_test_…'   # from dashboard / password manager; not chat
#   ./scripts/stripe-api.sh GET /v1/balance
#   ./scripts/stripe-api.sh POST /v1/products/prod_xxx -d active=false
#
# Prefer STRIPE_SECRET_KEY_TEST when STRIPE_MODE=test (same value is fine).
set -euo pipefail

key="${STRIPE_SECRET_KEY:-${STRIPE_SECRET_KEY_TEST:-}}"
if [[ -z "$key" ]]; then
  echo "Set STRIPE_SECRET_KEY (or STRIPE_SECRET_KEY_TEST) in the environment first." >&2
  echo "Do not paste the key into chat, commits, or shell history on the argv." >&2
  exit 1
fi

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 METHOD /v1/path [curl -d/-G args…]" >&2
  exit 1
fi

method="$1"
path="$2"
shift 2

exec curl -sS -X "$method" "https://api.stripe.com${path}" \
  -u "${key}:" \
  "$@"
