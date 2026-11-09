import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BUCKET = "device-models";
const SIGNED_TTL_SECONDS = 90;
const DEVICE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,80}$/i;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-mockup-model-secret",
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

  let body: { deviceId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const deviceId = String(body.deviceId ?? "").trim();
  if (!DEVICE_ID_RE.test(deviceId)) {
    return json({ error: "invalid_device_id" }, 400);
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
