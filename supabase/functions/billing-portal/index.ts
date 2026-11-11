/**
 * Stripe Customer Portal session for the signed-in Mokup Studio account.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { stripeMode, stripeSecretKey } from "../_shared/stripeConfig.ts";
import { corsHeaders, json, requireUser } from "../_shared/supabaseAdmin.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const mode = stripeMode();
  const stripeSecret = stripeSecretKey(mode);
  if (!stripeSecret) return json({ error: "stripe_not_configured", mode }, 503);

  const { data: row } = await auth.admin
    .from("mokstudio_entitlements")
    .select("stripe_customer_id, source, provider")
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (!row?.stripe_customer_id) {
    return json({ error: "no_stripe_customer" }, 404);
  }

  let body: { returnUrl?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* optional body */
  }

  const siteUrl = (Deno.env.get("SITE_URL") || "https://mokstudio.io").replace(/\/$/, "");
  const returnUrl = String(body.returnUrl || `${siteUrl}/pricing`);

  const form = new URLSearchParams();
  form.set("customer", row.stripe_customer_id);
  form.set("return_url", returnUrl);

  const stripeRes = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const session = await stripeRes.json() as {
    url?: string;
    error?: { message?: string };
  };
  if (!stripeRes.ok || !session.url) {
    return json({ error: session.error?.message || "portal_create_failed" }, 502);
  }

  return json({ ok: true, url: session.url });
});
