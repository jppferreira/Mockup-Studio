/**
 * Stripe test/live mode selection for Edge Functions.
 *
 * STRIPE_MODE=test|live (default: test)
 *
 * Prefer mode-specific secrets when present; fall back to legacy unprefixed
 * names so existing projects keep working in test mode.
 */

export type StripeMode = "test" | "live";

export type CheckoutSku =
  | "pro"
  | "pro_max"
  | "update_pass"
  | "monthly"
  | "yearly"
  | "lifetime";

const PRICE_BASE: Record<CheckoutSku, string> = {
  pro: "STRIPE_PRICE_PRO",
  pro_max: "STRIPE_PRICE_PRO_MAX",
  update_pass: "STRIPE_PRICE_UPDATE_PASS",
  monthly: "STRIPE_PRICE_MONTHLY",
  yearly: "STRIPE_PRICE_YEARLY",
  lifetime: "STRIPE_PRICE_LIFETIME",
};

export function stripeMode(): StripeMode {
  const raw = (Deno.env.get("STRIPE_MODE") || "test").trim().toLowerCase();
  return raw === "live" ? "live" : "test";
}

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = Deno.env.get(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Secret API key for the active mode. Live mode never falls back to the legacy test key. */
export function stripeSecretKey(mode: StripeMode = stripeMode()): string | undefined {
  if (mode === "live") {
    return firstEnv("STRIPE_SECRET_KEY_LIVE");
  }
  return firstEnv("STRIPE_SECRET_KEY_TEST", "STRIPE_SECRET_KEY");
}

/** Webhook signing secret for the active mode. */
export function stripeWebhookSecret(mode: StripeMode = stripeMode()): string | undefined {
  if (mode === "live") {
    return firstEnv("STRIPE_WEBHOOK_SECRET_LIVE");
  }
  return firstEnv("STRIPE_WEBHOOK_SECRET_TEST", "STRIPE_WEBHOOK_SECRET");
}

/** Optional publishable key (pk_…) if Edge code ever needs it; website uses VITE_* variants. */
export function stripePublishableKey(mode: StripeMode = stripeMode()): string | undefined {
  if (mode === "live") {
    return firstEnv("STRIPE_PUBLISHABLE_KEY_LIVE");
  }
  return firstEnv("STRIPE_PUBLISHABLE_KEY_TEST", "STRIPE_PUBLISHABLE_KEY");
}

/** Price ID for a SKU in the active mode. */
export function stripePriceId(
  sku: CheckoutSku,
  mode: StripeMode = stripeMode(),
): string | undefined {
  const base = PRICE_BASE[sku];
  if (mode === "live") {
    return firstEnv(`${base}_LIVE`, base);
  }
  return firstEnv(`${base}_TEST`, base);
}

export function allCheckoutSkus(): CheckoutSku[] {
  return ["pro", "pro_max", "update_pass", "monthly", "yearly", "lifetime"];
}
