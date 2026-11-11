/**
 * Issues a short-lived (7-day) signed offline entitlement for direct-download desktop.
 * Uses LICENSE_PRIVATE_KEY_PEM (Ed25519). Clients verify with the embedded public key.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders,
  json,
  recordEvent,
  requireUser,
} from "../_shared/supabaseAdmin.ts";

const OFFLINE_TTL_SECONDS = 7 * 24 * 60 * 60;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const pem = Deno.env.get("LICENSE_PRIVATE_KEY_PEM");
  if (!pem) return json({ error: "signing_not_configured" }, 503);

  const { data: ent } = await auth.admin
    .from("mokstudio_entitlements")
    .select(
      "tier, plan, status, period_end, updates_until, max_devices, offline_token_version, source, provider",
    )
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (!ent || ent.tier === "free") {
    return json({ error: "no_paid_entitlement" }, 403);
  }

  const now = Date.now();
  const status = String(ent.status ?? "active");
  if (status === "revoked" || status === "expired") {
    return json({ error: "entitlement_inactive" }, 403);
  }
  if (ent.period_end) {
    const end = Date.parse(ent.period_end);
    if (Number.isFinite(end) && end <= now && status !== "active" && status !== "trialing" && status !== "past_due") {
      return json({ error: "entitlement_expired" }, 403);
    }
    // canceled but still inside paid window is OK
    if (status === "canceled" && Number.isFinite(end) && end <= now) {
      return json({ error: "entitlement_expired" }, 403);
    }
  }

  let body: { deviceFingerprint?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* optional */
  }

  const iat = Math.floor(now / 1000);
  const exp = iat + OFFLINE_TTL_SECONDS;
  const payload = {
    v: 1,
    typ: "offline_entitlement",
    uid: auth.userId,
    tier: ent.tier,
    plan: ent.plan,
    status: ent.status,
    periodEnd: ent.period_end,
    updatesUntil: ent.updates_until,
    maxDevices: ent.max_devices,
    tokenVersion: ent.offline_token_version ?? 1,
    deviceFingerprint: body.deviceFingerprint ?? null,
    iat,
    exp,
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const payloadB64 = bytesToB64Url(payloadBytes);
  const key = await importPkcs8(pem);
  const signature = await crypto.subtle.sign("Ed25519", key, payloadBytes);
  const token = `MS-OFFLINE.${payloadB64}.${bytesToB64Url(new Uint8Array(signature))}`;

  await recordEvent(auth.admin, {
    userId: auth.userId,
    actor: "issue-offline-entitlement",
    eventType: "offline_token_issued",
    provider: ent.provider ?? ent.source ?? "manual",
    externalId: `offline:${auth.userId}:${iat}`,
    payload: { exp, tier: ent.tier },
  });

  return json({
    ok: true,
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
    tier: ent.tier,
    plan: ent.plan,
    status: ent.status,
  });
});

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToBytes(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function importPkcs8(pem: string): Promise<CryptoKey> {
  const bytes = pemToBytes(pem);
  return crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
}
