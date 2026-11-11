/**
 * Bind a verified MS-PRO / MS-PROMAX key to the signed-in Supabase user.
 * Verifies the Ed25519 key, then upserts mokstudio_entitlements (service role).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const LICENSE_PUBLIC_KEY_SPKI_B64 =
  "MCowBQYDK2VwAyEABiwn9tzv0m4fMooLlx0Yiyh/XL7e3KKVeXMDZBPlj1s=";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type LicenseProduct = "pro" | "pro_max";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "auth_required" }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: "auth_required" }, 401);
  }
  const userId = userData.user.id;

  let body: { licenseKey?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (body.action === "clear") {
    const { error } = await admin.from("mokstudio_entitlements").upsert(
      {
        user_id: userId,
        tier: "free",
        plan: "free",
        status: "active",
        source: "none",
        provider: null,
        license_key_hash: null,
        license_prefix: null,
        updates_until: null,
        activated_at: null,
        period_end: null,
        canceled_at: null,
        max_devices: 1,
      },
      { onConflict: "user_id" },
    );
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, tier: "free", source: "none" });
  }

  const licenseKey = String(body.licenseKey ?? "").trim().replace(/\s+/g, "");
  const verified = await verifyProLicense(licenseKey);
  if (!verified) {
    return json({ error: "invalid_license" }, 400);
  }

  const hash = await sha256Hex(licenseKey);
  // Reject if this key is already bound to a different account.
  const { data: existingHash } = await admin
    .from("mokstudio_entitlements")
    .select("user_id")
    .eq("license_key_hash", hash)
    .maybeSingle();
  if (existingHash?.user_id && existingHash.user_id !== userId) {
    return json({ error: "license_already_bound" }, 409);
  }

  const updatesUntil = new Date();
  updatesUntil.setMonth(updatesUntil.getMonth() + 12);

  const { data, error } = await admin
    .from("mokstudio_entitlements")
    .upsert(
      {
        user_id: userId,
        tier: verified.tier,
        plan: verified.tier,
        status: "active",
        source: "key",
        provider: "key",
        license_key_hash: hash,
        license_prefix: verified.prefix,
        updates_until: updatesUntil.toISOString(),
        activated_at: new Date().toISOString(),
        period_end: null,
        canceled_at: null,
        max_devices: verified.tier === "pro_max" ? 2 : 1,
      },
      { onConflict: "user_id" },
    )
    .select("tier, source, license_prefix, updates_until, activated_at")
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  return json({
    ok: true,
    tier: data?.tier ?? verified.tier,
    source: data?.source ?? "key",
    licensePrefix: data?.license_prefix ?? verified.prefix,
    updatesUntil: data?.updates_until ?? updatesUntil.toISOString(),
    activatedAt: data?.activated_at ?? new Date().toISOString(),
  });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyProLicense(
  rawKey: string,
): Promise<{ tier: LicenseProduct; prefix: "MS-PRO" | "MS-PROMAX" } | null> {
  if (!rawKey) return null;
  const match = /^(MS-PROMAX|MS-PRO)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(rawKey);
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
    return {
      tier: payload.tier,
      prefix: match[1] as "MS-PRO" | "MS-PROMAX",
    };
  } catch {
    return null;
  }
}
