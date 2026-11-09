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
 * Ed25519 public key (SPKI, base64) — same as src/lib/licensePublicKey.ts
 * Used to verify MS-PRO / MS-PROMAX keys before signing paid model URLs.
 */
const LICENSE_PUBLIC_KEY_SPKI_B64 =
  "MCowBQYDK2VwAyEABiwn9tzv0m4fMooLlx0Yiyh/XL7e3KKVeXMDZBPlj1s=";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-mockup-model-secret, x-mockup-license-key",
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

  let body: { deviceId?: string; licenseKey?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const deviceId = String(body.deviceId ?? "").trim();
  if (!DEVICE_ID_RE.test(deviceId)) {
    return json({ error: "invalid_device_id" }, 400);
  }

  const licenseKey =
    String(body.licenseKey ?? "").trim() ||
    (req.headers.get("x-mockup-license-key") ?? "").trim();

  const isFreeDevice = FREE_DEVICE_IDS.has(deviceId);
  if (!isFreeDevice) {
    const paid = await licenseUnlocksAllDevices(licenseKey);
    if (!paid) {
      return json({ error: "license_required", deviceId }, 403);
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
    tier: isFreeDevice ? "free" : "paid",
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

async function licenseUnlocksAllDevices(rawKey: string): Promise<boolean> {
  if (!rawKey) return false;
  const key = rawKey.trim().replace(/\s+/g, "");
  const match = /^(MS-PROMAX|MS-PRO)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(key);
  if (!match) return false;

  const payloadBytes = b64UrlToBytes(match[2]);
  let payload: { v?: number; tier?: string };
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
      v?: number;
      tier?: string;
    };
  } catch {
    return false;
  }

  if (payload.v !== 1) return false;
  if (payload.tier !== "pro" && payload.tier !== "pro_max") return false;
  if (match[1] === "MS-PRO" && payload.tier !== "pro") return false;
  if (match[1] === "MS-PROMAX" && payload.tier !== "pro_max") return false;

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
    return await crypto.subtle.verify(
      "Ed25519",
      cryptoKey,
      asBufferSource(b64UrlToBytes(match[3])),
      asBufferSource(payloadBytes),
    );
  } catch {
    return false;
  }
}
