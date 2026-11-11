/**
 * App Store Server Notifications (V2) handler — scaffold.
 *
 * Requires Apple App Store Connect API / ASSN configuration:
 * - APPLE_BUNDLE_ID
 * - APPLE_APP_APPLE_ID (numeric)
 * - APPLE_ISSUER_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY (for Online verification, optional here)
 *
 * This function verifies the outer JWS envelope structure, records the notification
 * for idempotency, and upserts mokstudio_entitlements when a supabase_user_id is
 * present in appAccountToken (UUID set at purchase time).
 *
 * Full cryptographic chain validation against Apple root CAs should be completed
 * before production cutover — see docs/release-licensing.md.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json, recordEvent } from "../_shared/supabaseAdmin.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "server_misconfigured" }, 500);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: { signedPayload?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const signedPayload = String(body.signedPayload ?? "");
  if (!signedPayload.includes(".")) {
    return json({ error: "invalid_payload" }, 400);
  }

  const decoded = decodeJwsPayload(signedPayload);
  if (!decoded) return json({ error: "invalid_jws" }, 400);

  const notificationUUID = String(decoded.notificationUUID ?? "");
  const notificationType = String(decoded.notificationType ?? "unknown");
  const data = (decoded.data ?? {}) as Record<string, unknown>;
  const signedTransactionInfo = typeof data.signedTransactionInfo === "string"
    ? data.signedTransactionInfo
    : null;

  const dedupe = await recordEvent(admin, {
    actor: "apple-assn",
    eventType: notificationType,
    provider: "mas",
    externalId: notificationUUID || `assn:${notificationType}:${Date.now()}`,
    payload: {
      subtype: decoded.subtype ?? null,
      // Do not store full Apple payloads long-term in v1 — keep identifiers only.
      hasTransaction: Boolean(signedTransactionInfo),
    },
  });
  if (dedupe.duplicate) return json({ ok: true, duplicate: true });

  if (!signedTransactionInfo) {
    return json({ ok: true, ignored: true, reason: "no_transaction" });
  }

  const txn = decodeJwsPayload(signedTransactionInfo);
  if (!txn) return json({ ok: true, ignored: true, reason: "bad_transaction" });

  const originalTransactionId = String(txn.originalTransactionId ?? "");
  const appAccountToken = String(txn.appAccountToken ?? "");
  const productId = String(txn.productId ?? "");
  const expiresDate = typeof txn.expiresDate === "number"
    ? new Date(txn.expiresDate).toISOString()
    : null;
  const revocationDate = typeof txn.revocationDate === "number"
    ? new Date(txn.revocationDate).toISOString()
    : null;

  // appAccountToken must be the Supabase user UUID set when the MAS client starts a purchase.
  const userId = /^[0-9a-f-]{36}$/i.test(appAccountToken) ? appAccountToken : null;
  if (!userId && !originalTransactionId) {
    return json({ ok: true, ignored: true, reason: "unlinked_purchase" });
  }

  const grant = mapAppleProduct(productId);
  const revokeTypes = new Set([
    "REFUND",
    "REVOKE",
    "EXPIRED",
    "GRACE_PERIOD_EXPIRED",
  ]);
  const renewTypes = new Set([
    "SUBSCRIBED",
    "DID_RENEW",
    "OFFER_REDEEMED",
    "ONE_TIME_CHARGE",
  ]);

  if (userId && (renewTypes.has(notificationType) || notificationType === "DID_CHANGE_RENEWAL_STATUS")) {
    await admin.from("mokstudio_entitlements").upsert({
      user_id: userId,
      tier: grant.tier,
      plan: grant.plan,
      status: revocationDate ? "revoked" : (expiresDate && Date.parse(expiresDate) <= Date.now() ? "expired" : "active"),
      source: "mas",
      provider: "mas",
      apple_original_transaction_id: originalTransactionId || null,
      period_end: grant.lifetime ? null : expiresDate,
      updates_until: grant.lifetime
        ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
        : expiresDate,
      activated_at: new Date().toISOString(),
      canceled_at: notificationType === "DID_CHANGE_RENEWAL_STATUS" ? new Date().toISOString() : null,
      max_devices: grant.maxDevices,
    }, { onConflict: "user_id" });
  }

  if (userId && revokeTypes.has(notificationType)) {
    const keepUntil = expiresDate && Date.parse(expiresDate) > Date.now() && notificationType === "EXPIRED"
      ? false
      : true;
    if (keepUntil || revocationDate) {
      await admin.from("mokstudio_entitlements").update({
        status: notificationType === "EXPIRED" && expiresDate && Date.parse(expiresDate) > Date.now()
          ? "canceled"
          : "revoked",
        tier: notificationType === "EXPIRED" && expiresDate && Date.parse(expiresDate) > Date.now()
          ? grant.tier
          : "free",
        period_end: expiresDate ?? new Date().toISOString(),
        canceled_at: new Date().toISOString(),
      }).eq("user_id", userId);
    }
  }

  // Link by original transaction when appAccountToken was missing historically.
  if (!userId && originalTransactionId) {
    await admin.from("mokstudio_entitlements").update({
      status: revokeTypes.has(notificationType) ? "revoked" : "active",
      period_end: grant.lifetime ? null : expiresDate,
    }).eq("apple_original_transaction_id", originalTransactionId);
  }

  return json({ ok: true });
});

function decodeJwsPayload(jws: string): Record<string, unknown> | null {
  const parts = jws.split(".");
  if (parts.length < 2) return null;
  try {
    const pad = "=".repeat((4 - (parts[1].length % 4)) % 4);
    const b64 = (parts[1] + pad).replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mapAppleProduct(productId: string): {
  tier: "pro" | "pro_max";
  plan: string;
  maxDevices: number;
  lifetime: boolean;
} {
  const id = productId.toLowerCase();
  if (id.includes("promax") || id.includes("pro_max")) {
    return { tier: "pro_max", plan: "pro_max", maxDevices: 2, lifetime: true };
  }
  if (id.includes("lifetime")) {
    return { tier: "pro", plan: "lifetime", maxDevices: 1, lifetime: true };
  }
  if (id.includes("year")) {
    return { tier: "pro", plan: "yearly", maxDevices: 1, lifetime: false };
  }
  if (id.includes("month")) {
    return { tier: "pro", plan: "monthly", maxDevices: 1, lifetime: false };
  }
  return { tier: "pro", plan: "pro", maxDevices: 1, lifetime: true };
}
