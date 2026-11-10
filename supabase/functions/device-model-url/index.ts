import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BUCKET = "device-models";
const SIGNED_TTL_SECONDS = 90;
const DEVICE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,80}$/i;

/** Must match shared/pricing.ts FREE_DEVICE_IDS — free tier may download only these. */
const FREE_DEVICE_IDS = new Set([
  "iphone_15_pro_max",
  "galaxy_s26_ultra",
]);

/**
 * Must match shared/deviceLicenseGate.ts NEEDS_REVIEW_DEVICE_IDS.
 * Browser delivery is blocked until counsel clears SaaS / runtime licence scope.
 */
const NEEDS_REVIEW_DEVICE_IDS = new Set([
  "pixel_fold",
  "galaxy_z_flip8",
  "galaxy_z_fold8",
  "galaxy_z_fold8_ultra",
  "apple_watch_series_12",
  "pixel_watch_7",
  "ipad_pro_m5",
  "macbook_pro_m5",
  "imac_24",
  "imac_m4",
  "apple_homeview",
]);

/**
 * Ed25519 public key (SPKI, base64) — same as src/lib/licensePublicKey.ts
 * Used to verify MS-PRO / MS-PROMAX keys before signing paid model URLs.
 */
const LICENSE_PUBLIC_KEY_SPKI_B64 =
  "MCowBQYDK2VwAyEABiwn9tzv0m4fMooLlx0Yiyh/XL7e3KKVeXMDZBPlj1s=";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-mockup-model-secret, x-mockup-license-key, x-mockup-client",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const expectedSecret = Deno.env.get("MODEL_APP_SECRET") ?? "";
  const providedSecret = req.headers.get("x-mockup-model-secret") ?? "";
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: { deviceId?: string; licenseKey?: string; client?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const deviceId = String(body.deviceId ?? "").trim();
  if (!DEVICE_ID_RE.test(deviceId)) {
    return json({ error: "invalid_device_id" }, 400);
  }

  const clientHint = String(
    body.client ?? req.headers.get("x-mockup-client") ?? "",
  ).trim().toLowerCase();
  const isWebClient = clientHint === "web" || clientHint === "browser";

  if (isWebClient && NEEDS_REVIEW_DEVICE_IDS.has(deviceId)) {
    return json({
      error: "license_review_required",
      deviceId,
      detail: "This model is not cleared for browser delivery yet.",
    }, 403);
  }

  const licenseKey =
    String(body.licenseKey ?? "").trim() ||
    (req.headers.get("x-mockup-license-key") ?? "").trim();

  const isFreeDevice = FREE_DEVICE_IDS.has(deviceId);
  let accessTier: "free" | "pro" | "pro_max" = isFreeDevice ? "free" : "free";
  let accessVia: "free" | "account" | "license_key" | null = isFreeDevice ? "free" : null;

  if (!isFreeDevice) {
    const accountTier = await accountUnlocksAllDevices(req);
    if (accountTier) {
      accessTier = accountTier;
      accessVia = "account";
    } else {
      const paid = await licenseUnlocksAllDevices(licenseKey);
      if (!paid) {
        return json({ error: "license_required", deviceId }, 403);
      }
      accessTier = paid;
      accessVia = "license_key";
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const objectPath = `${deviceId}.glb`;
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(objectPath, SIGNED_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    return json({ error: "not_found", detail: error?.message ?? "missing" }, 404);
  }

  return json({
    deviceId,
    url: data.signedUrl,
    expiresIn: SIGNED_TTL_SECONDS,
    tier: accessTier,
    accessVia,
  });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      Connection: "keep-alive",
    },
  });
}

function b64UrlToBytes(value: string): Uint8Array {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const b64 = (value + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Prefer Auth JWT → mokstudio_entitlements.tier over offline license keys. */
async function accountUnlocksAllDevices(
  req: Request,
): Promise<"pro" | "pro_max" | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return null;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return null;

  // Ignore the shared anon key — only real user sessions unlock via account.
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token || token === anonKey) return null;

  try {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return null;

    const { data, error } = await userClient
      .from("mokstudio_entitlements")
      .select("tier")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (error || !data) return null;
    if (data.tier === "pro" || data.tier === "pro_max") return data.tier;
    return null;
  } catch {
    return null;
  }
}

async function licenseUnlocksAllDevices(
  rawKey: string,
): Promise<"pro" | "pro_max" | null> {
  if (!rawKey) return null;
  const key = rawKey.trim().replace(/\s+/g, "");
  const match = /^(MS-PROMAX|MS-PRO)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(key);
  if (!match) return null;

  const payloadBytes = b64UrlToBytes(match[2]);
  let payload: { v?: number; tier?: string };
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
      v?: number;
      tier?: string;
    };
  } catch {
    return null;
  }

  if (payload.v !== 1) return null;
  if (payload.tier !== "pro" && payload.tier !== "pro_max") return null;
  if (match[1] === "MS-PRO" && payload.tier !== "pro") return null;
  if (match[1] === "MS-PROMAX" && payload.tier !== "pro_max") return null;

  try {
    const pad = "=".repeat((4 - (LICENSE_PUBLIC_KEY_SPKI_B64.length % 4)) % 4);
    const spkiBin = atob(LICENSE_PUBLIC_KEY_SPKI_B64 + pad);
    const spki = new Uint8Array(spkiBin.length);
    for (let i = 0; i < spkiBin.length; i += 1) spki[i] = spkiBin.charCodeAt(i);

    const cryptoKey = await crypto.subtle.importKey(
      "spki",
      asBufferSource(spki),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "Ed25519",
      cryptoKey,
      asBufferSource(b64UrlToBytes(match[3])),
      asBufferSource(payloadBytes),
    );
    if (!ok) return null;
    return payload.tier;
  } catch {
    return null;
  }
}
