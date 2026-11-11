/**
 * Authenticated Stripe Checkout Session creator.
 * Secret key stays server-side. Client only receives the hosted Checkout URL.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, json, recordEvent, requireUser } from "../_shared/supabaseAdmin.ts";

type CheckoutSku = "pro" | "pro_max" | "update_pass" | "monthly" | "yearly" | "lifetime";

const SKU_ENV: Record<CheckoutSku, string> = {
  pro: "STRIPE_PRICE_PRO",
  pro_max: "STRIPE_PRICE_PRO_MAX",
  update_pass: "STRIPE_PRICE_UPDATE_PASS",
  monthly: "STRIPE_PRICE_MONTHLY",
  yearly: "STRIPE_PRICE_YEARLY",
  lifetime: "STRIPE_PRICE_LIFETIME",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeSecret) return json({ error: "stripe_not_configured" }, 503);

  let body: { sku?: string; successUrl?: string; cancelUrl?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const sku = String(body.sku ?? "pro") as CheckoutSku;
  if (!(sku in SKU_ENV)) return json({ error: "invalid_sku" }, 400);

  const priceId = Deno.env.get(SKU_ENV[sku]);
  if (!priceId) return json({ error: "price_not_configured", sku }, 503);

  const siteUrl = (Deno.env.get("SITE_URL") || "https://mokstudio.io").replace(/\/$/, "");
  const successUrl = String(body.successUrl || `${siteUrl}/thanks?session_id={CHECKOUT_SESSION_ID}`);
  const cancelUrl = String(body.cancelUrl || `${siteUrl}/pricing`);

  // Reuse Stripe customer when we already linked one.
  const { data: existing } = await auth.admin
    .from("mokstudio_entitlements")
    .select("stripe_customer_id")
    .eq("user_id", auth.userId)
    .maybeSingle();

  const mode = sku === "monthly" || sku === "yearly" ? "subscription" : "payment";

  const form = new URLSearchParams();
  form.set("mode", mode);
  form.set("success_url", successUrl);
  form.set("cancel_url", cancelUrl);
  form.set("client_reference_id", auth.userId);
  form.set("metadata[supabase_user_id]", auth.userId);
  form.set("metadata[sku]", sku);
  form.set("line_items[0][price]", priceId);
  form.set("line_items[0][quantity]", "1");
  form.set("allow_promotion_codes", "true");
  if (auth.userEmail) form.set("customer_email", auth.userEmail);
  if (existing?.stripe_customer_id) {
    form.set("customer", existing.stripe_customer_id);
    form.delete("customer_email");
  }
  if (mode === "subscription") {
    form.set("subscription_data[metadata][supabase_user_id]", auth.userId);
    form.set("subscription_data[metadata][sku]", sku);
  } else {
    form.set("payment_intent_data[metadata][supabase_user_id]", auth.userId);
    form.set("payment_intent_data[metadata][sku]", sku);
  }

  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const session = await stripeRes.json() as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };
  if (!stripeRes.ok || !session.url || !session.id) {
    return json({ error: session.error?.message || "checkout_create_failed" }, 502);
  }

  await recordEvent(auth.admin, {
    userId: auth.userId,
    actor: "create-checkout",
    eventType: "checkout_created",
    provider: "stripe",
    externalId: `checkout_create:${session.id}`,
    payload: { sku, sessionId: session.id },
  });

  return json({ ok: true, url: session.url, sessionId: session.id });
});
