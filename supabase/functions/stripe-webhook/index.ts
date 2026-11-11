/**
 * Verified Stripe webhook → upsert mokstudio_entitlements.
 * Never trusts client-side payment claims. Idempotent via entitlement_events.external_id.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  allCheckoutSkus,
  stripeMode,
  stripePriceId,
  stripeSecretKey,
  stripeWebhookSecret,
  type CheckoutSku,
} from "../_shared/stripeConfig.ts";
import { corsHeaders, json, recordEvent } from "../_shared/supabaseAdmin.ts";

function skuFromPriceId(priceId: string | null | undefined): CheckoutSku | null {
  if (!priceId) return null;
  const mode = stripeMode();
  for (const sku of allCheckoutSkus()) {
    if (stripePriceId(sku, mode) === priceId) return sku;
  }
  return null;
}

function grantForSku(sku: CheckoutSku): {
  tier: "pro" | "pro_max";
  plan: string;
  maxDevices: number;
  lifetime: boolean;
  updatesOnly: boolean;
} {
  if (sku === "pro_max") {
    return { tier: "pro_max", plan: "pro_max", maxDevices: 2, lifetime: true, updatesOnly: false };
  }
  if (sku === "lifetime") {
    return { tier: "pro", plan: "lifetime", maxDevices: 1, lifetime: true, updatesOnly: false };
  }
  if (sku === "pro") {
    return { tier: "pro", plan: "pro", maxDevices: 1, lifetime: true, updatesOnly: false };
  }
  if (sku === "yearly") {
    return { tier: "pro", plan: "yearly", maxDevices: 1, lifetime: false, updatesOnly: false };
  }
  if (sku === "monthly") {
    return { tier: "pro", plan: "monthly", maxDevices: 1, lifetime: false, updatesOnly: false };
  }
  return { tier: "pro", plan: "update_pass", maxDevices: 1, lifetime: false, updatesOnly: true };
}

/** Stripe signs with HMAC-SHA256 over `t.payload` using the base64 payload of `whsec_…`. */
function stripeWebhookKeyBytes(secret: string): Uint8Array {
  if (secret.startsWith("whsec_")) {
    const b64 = secret.slice("whsec_".length);
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new TextEncoder().encode(secret);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let ok = 0;
  for (let i = 0; i < a.length; i += 1) ok |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ok === 0;
}

async function hmacHex(keyBytes: Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "t") timestamp = v;
    if (k === "v1" && v) signatures.push(v);
  }
  if (!timestamp || signatures.length === 0) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age >= 60 * 5) return false;

  const signed = `${timestamp}.${payload}`;
  // Primary: Stripe official (base64 after whsec_). Fallback: raw UTF-8 of the full secret
  // so older manual probes / mis-copied secrets still verify during rollout.
  const candidates = [stripeWebhookKeyBytes(secret)];
  if (secret.startsWith("whsec_")) {
    candidates.push(new TextEncoder().encode(secret));
  }
  for (const keyBytes of candidates) {
    const hex = await hmacHex(keyBytes, signed);
    if (signatures.some((sig) => timingSafeEqualHex(hex, sig))) return true;
  }
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const mode = stripeMode();
  const stripeSecret = stripeSecretKey(mode);
  const webhookSecret = stripeWebhookSecret(mode);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!stripeSecret || !webhookSecret || !supabaseUrl || !serviceKey) {
    return json({ error: "server_misconfigured", mode }, 500);
  }

  const payload = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!(await verifyStripeSignature(payload, sig, webhookSecret))) {
    return json({ error: "invalid_signature" }, 400);
  }

  const event = JSON.parse(payload) as {
    id: string;
    type: string;
    data: { object: Record<string, unknown> };
  };

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const dedupe = await recordEvent(admin, {
    actor: "stripe-webhook",
    eventType: event.type,
    provider: "stripe",
    externalId: event.id,
    payload: { type: event.type },
  });
  if (dedupe.duplicate) return json({ ok: true, duplicate: true });

  try {
    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(admin, stripeSecret, event.data.object);
    } else if (
      event.type === "customer.subscription.updated"
      || event.type === "customer.subscription.deleted"
    ) {
      await handleSubscriptionChange(admin, event.type, event.data.object);
    } else if (event.type === "invoice.payment_failed") {
      await handlePaymentFailed(admin, event.data.object);
    } else if (event.type === "charge.refunded") {
      await handleRefund(admin, event.data.object);
    }
  } catch (err) {
    console.error("[stripe-webhook]", err);
    return json({ error: "handler_failed" }, 500);
  }

  return json({ ok: true });
});

async function handleCheckoutCompleted(
  admin: ReturnType<typeof createClient>,
  stripeSecret: string,
  session: Record<string, unknown>,
) {
  const userId = String(
    session.client_reference_id
      || (session.metadata as Record<string, string> | undefined)?.supabase_user_id
      || "",
  );
  if (!userId) throw new Error("missing_user_id");

  const customerId = typeof session.customer === "string" ? session.customer : null;
  const sessionId = String(session.id ?? "");
  let sku = ((session.metadata as Record<string, string> | undefined)?.sku || "pro") as CheckoutSku;

  // Resolve SKU from line items when metadata is missing.
  if (!sku || !(sku in { pro: 1, pro_max: 1, update_pass: 1, monthly: 1, yearly: 1, lifetime: 1 })) {
    sku = "pro";
  }

  if (sessionId) {
    const lineRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items?limit=1`,
      { headers: { Authorization: `Bearer ${stripeSecret}` } },
    );
    if (lineRes.ok) {
      const lines = await lineRes.json() as {
        data?: Array<{ price?: { id?: string } }>;
      };
      const priceId = lines.data?.[0]?.price?.id;
      const fromPrice = skuFromPriceId(priceId);
      if (fromPrice) sku = fromPrice;
    }
  }

  const grant = grantForSku(sku);
  const now = new Date();
  const updatesUntil = new Date(now);
  updatesUntil.setMonth(updatesUntil.getMonth() + 12);

  if (grant.updatesOnly) {
    const { data: current } = await admin
      .from("mokstudio_entitlements")
      .select("tier, updates_until, max_devices")
      .eq("user_id", userId)
      .maybeSingle();
    const base = current?.updates_until ? new Date(current.updates_until) : now;
    const start = base.getTime() > now.getTime() ? base : now;
    const next = new Date(start);
    next.setMonth(next.getMonth() + 12);
    await admin.from("mokstudio_entitlements").upsert({
      user_id: userId,
      tier: current?.tier && current.tier !== "free" ? current.tier : "pro",
      plan: current?.tier === "pro_max" ? "pro_max" : "pro",
      status: "active",
      source: "stripe",
      provider: "stripe",
      stripe_customer_id: customerId,
      stripe_checkout_session_id: sessionId,
      updates_until: next.toISOString(),
      activated_at: now.toISOString(),
      max_devices: current?.max_devices ?? 1,
      period_end: null,
    }, { onConflict: "user_id" });
    await recordEvent(admin, {
      userId,
      actor: "stripe-webhook",
      eventType: "grant_update_pass",
      provider: "stripe",
      externalId: `grant_update:${sessionId}`,
      payload: { sku, updatesUntil: next.toISOString() },
    });
    return;
  }

  const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
  let periodEnd: string | null = null;
  let periodStart: string | null = now.toISOString();
  let status = "active";

  if (subscriptionId) {
    const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${stripeSecret}` },
    });
    if (subRes.ok) {
      const sub = await subRes.json() as {
        status?: string;
        current_period_end?: number;
        current_period_start?: number;
      };
      if (sub.current_period_end) {
        periodEnd = new Date(sub.current_period_end * 1000).toISOString();
      }
      if (sub.current_period_start) {
        periodStart = new Date(sub.current_period_start * 1000).toISOString();
      }
      if (sub.status === "trialing") status = "trialing";
      if (sub.status === "past_due") status = "past_due";
      if (sub.status === "canceled") status = "canceled";
    }
  }

  await admin.from("mokstudio_entitlements").upsert({
    user_id: userId,
    tier: grant.tier,
    plan: grant.plan,
    status,
    source: "stripe",
    provider: "stripe",
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    stripe_checkout_session_id: sessionId,
    updates_until: grant.lifetime ? updatesUntil.toISOString() : periodEnd,
    activated_at: now.toISOString(),
    period_start: periodStart,
    period_end: grant.lifetime ? null : periodEnd,
    canceled_at: null,
    max_devices: grant.maxDevices,
  }, { onConflict: "user_id" });

  await recordEvent(admin, {
    userId,
    actor: "stripe-webhook",
    eventType: "grant",
    provider: "stripe",
    externalId: `grant:${sessionId}`,
    payload: { sku, tier: grant.tier, plan: grant.plan, lifetime: grant.lifetime },
  });
}

async function handleSubscriptionChange(
  admin: ReturnType<typeof createClient>,
  eventType: string,
  sub: Record<string, unknown>,
) {
  const subscriptionId = String(sub.id ?? "");
  const customerId = typeof sub.customer === "string" ? sub.customer : null;
  const userId = String(
    (sub.metadata as Record<string, string> | undefined)?.supabase_user_id || "",
  );

  let rowQuery = admin.from("mokstudio_entitlements").select("user_id, tier, plan, max_devices");
  if (subscriptionId) rowQuery = rowQuery.eq("stripe_subscription_id", subscriptionId);
  else if (customerId) rowQuery = rowQuery.eq("stripe_customer_id", customerId);
  else if (userId) rowQuery = rowQuery.eq("user_id", userId);
  else return;

  const { data: row } = await rowQuery.maybeSingle();
  if (!row?.user_id) return;

  const periodEnd = typeof sub.current_period_end === "number"
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;
  const periodStart = typeof sub.current_period_start === "number"
    ? new Date(sub.current_period_start * 1000).toISOString()
    : null;
  const cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
  const stripeStatus = String(sub.status ?? "");

  let status = "active";
  let canceledAt: string | null = null;
  if (eventType === "customer.subscription.deleted" || stripeStatus === "canceled") {
    // Keep access until period_end when present.
    status = periodEnd && Date.parse(periodEnd) > Date.now() ? "canceled" : "expired";
    canceledAt = new Date().toISOString();
  } else if (stripeStatus === "past_due") {
    status = "past_due";
  } else if (stripeStatus === "trialing") {
    status = "trialing";
  } else if (cancelAtPeriodEnd) {
    status = "canceled";
    canceledAt = new Date().toISOString();
  }

  const stillPaid = status === "active" || status === "trialing" || status === "past_due"
    || (status === "canceled" && periodEnd && Date.parse(periodEnd) > Date.now());

  await admin.from("mokstudio_entitlements").update({
    status: stillPaid ? status : "expired",
    period_start: periodStart,
    period_end: periodEnd,
    updates_until: periodEnd,
    canceled_at: canceledAt,
    tier: stillPaid ? row.tier : "free",
    plan: stillPaid ? row.plan : "free",
  }).eq("user_id", row.user_id);

  await recordEvent(admin, {
    userId: row.user_id,
    actor: "stripe-webhook",
    eventType: eventType === "customer.subscription.deleted" ? "subscription_deleted" : "subscription_updated",
    provider: "stripe",
    externalId: `sub_change:${subscriptionId}:${eventType}:${sub.current_period_end ?? "x"}`,
    payload: { status, periodEnd, stripeStatus },
  });
}

async function handlePaymentFailed(
  admin: ReturnType<typeof createClient>,
  invoice: Record<string, unknown>,
) {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : null;
  let q = admin.from("mokstudio_entitlements").select("user_id");
  if (subscriptionId) q = q.eq("stripe_subscription_id", subscriptionId);
  else if (customerId) q = q.eq("stripe_customer_id", customerId);
  else return;
  const { data: row } = await q.maybeSingle();
  if (!row?.user_id) return;
  await admin.from("mokstudio_entitlements").update({ status: "past_due" }).eq("user_id", row.user_id);
  await recordEvent(admin, {
    userId: row.user_id,
    actor: "stripe-webhook",
    eventType: "payment_failed",
    provider: "stripe",
    externalId: `invoice_fail:${String(invoice.id ?? crypto.randomUUID())}`,
    payload: {},
  });
}

async function handleRefund(
  admin: ReturnType<typeof createClient>,
  charge: Record<string, unknown>,
) {
  const customerId = typeof charge.customer === "string" ? charge.customer : null;
  if (!customerId) return;
  const { data: row } = await admin
    .from("mokstudio_entitlements")
    .select("user_id, plan")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (!row?.user_id) return;

  // Product policy: only *full* refunds revoke one-time Pro / Pro Max.
  // Partial refunds (`charge.refunded === false`) leave entitlements unchanged —
  // the customer still paid a non-zero amount; tier changes for partials are support-only.
  // Subscription plans skip here; Stripe subscription events own period/cancel state.
  const refunded = Boolean(charge.refunded);
  if (!refunded) return;
  if (row.plan === "monthly" || row.plan === "yearly" || row.plan === "trial") return;

  await admin.from("mokstudio_entitlements").update({
    tier: "free",
    plan: "free",
    status: "revoked",
    source: "stripe",
    provider: "stripe",
    canceled_at: new Date().toISOString(),
    period_end: new Date().toISOString(),
  }).eq("user_id", row.user_id);

  await recordEvent(admin, {
    userId: row.user_id,
    actor: "stripe-webhook",
    eventType: "refund_revoke",
    provider: "stripe",
    externalId: `refund:${String(charge.id ?? crypto.randomUUID())}`,
    payload: {},
  });
}
