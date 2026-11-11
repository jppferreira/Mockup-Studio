/**
 * Activate / list / revoke desktop seats for direct-download builds.
 * MAS builds should not call seat enforcement (Apple manages devices).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, json, recordEvent, requireUser } from "../_shared/supabaseAdmin.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  let body: {
    action?: "list" | "activate" | "deactivate";
    deviceFingerprint?: string;
    label?: string;
    platform?: "mac_direct" | "mac_mas" | "web";
    deviceId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const action = body.action ?? "list";

  if (action === "list") {
    const { data, error } = await auth.admin
      .from("mokstudio_devices")
      .select("id, device_fingerprint, label, platform, bound_at, last_seen_at, revoked_at")
      .eq("user_id", auth.userId)
      .order("bound_at", { ascending: true });
    if (error) return json({ error: error.message }, 500);
    const { data: ent } = await auth.admin
      .from("mokstudio_entitlements")
      .select("max_devices, tier, status, period_end, source")
      .eq("user_id", auth.userId)
      .maybeSingle();
    return json({
      ok: true,
      maxDevices: ent?.max_devices ?? 1,
      devices: data ?? [],
    });
  }

  if (action === "deactivate") {
    const deviceId = String(body.deviceId ?? "");
    if (!deviceId) return json({ error: "device_id_required" }, 400);
    const { error } = await auth.admin
      .from("mokstudio_devices")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", auth.userId)
      .eq("id", deviceId)
      .is("revoked_at", null);
    if (error) return json({ error: error.message }, 500);
    await recordEvent(auth.admin, {
      userId: auth.userId,
      actor: "bind-device",
      eventType: "device_deactivate",
      provider: "manual",
      externalId: `deactivate:${deviceId}:${Date.now()}`,
      payload: { deviceId },
    });
    return json({ ok: true });
  }

  if (action === "activate") {
    const platform = body.platform ?? "mac_direct";
    // Do not enforce arbitrary seat caps for Mac App Store installs.
    if (platform === "mac_mas") {
      return json({ ok: true, skipped: true, reason: "mas_no_seat_cap" });
    }

    const fingerprint = String(body.deviceFingerprint ?? "").trim();
    if (fingerprint.length < 16 || fingerprint.length > 128) {
      return json({ error: "invalid_fingerprint" }, 400);
    }

    const { data: ent } = await auth.admin
      .from("mokstudio_entitlements")
      .select("max_devices, tier, status, period_end")
      .eq("user_id", auth.userId)
      .maybeSingle();

    const maxDevices = Math.max(1, ent?.max_devices ?? 1);
    const { data: existing } = await auth.admin
      .from("mokstudio_devices")
      .select("id, revoked_at")
      .eq("user_id", auth.userId)
      .eq("device_fingerprint", fingerprint)
      .maybeSingle();

    if (existing?.id && !existing.revoked_at) {
      await auth.admin
        .from("mokstudio_devices")
        .update({
          last_seen_at: new Date().toISOString(),
          label: body.label ?? undefined,
        })
        .eq("id", existing.id);
      return json({ ok: true, deviceId: existing.id, reactivated: false });
    }

    if (existing?.id && existing.revoked_at) {
      await auth.admin
        .from("mokstudio_devices")
        .update({
          revoked_at: null,
          last_seen_at: new Date().toISOString(),
          bound_at: new Date().toISOString(),
          label: body.label ?? null,
          platform,
        })
        .eq("id", existing.id);
      await recordEvent(auth.admin, {
        userId: auth.userId,
        actor: "bind-device",
        eventType: "device_reactivate",
        provider: "manual",
        externalId: `reactivate:${existing.id}:${Date.now()}`,
        payload: { deviceId: existing.id },
      });
      return json({ ok: true, deviceId: existing.id, reactivated: true });
    }

    const { data: active } = await auth.admin
      .from("mokstudio_devices")
      .select("id")
      .eq("user_id", auth.userId)
      .is("revoked_at", null);
    if ((active?.length ?? 0) >= maxDevices) {
      return json({
        error: "device_limit_reached",
        maxDevices,
        activeCount: active?.length ?? 0,
      }, 409);
    }

    const { data: inserted, error } = await auth.admin
      .from("mokstudio_devices")
      .insert({
        user_id: auth.userId,
        device_fingerprint: fingerprint,
        label: body.label ?? null,
        platform,
      })
      .select("id")
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);

    await recordEvent(auth.admin, {
      userId: auth.userId,
      actor: "bind-device",
      eventType: "device_activate",
      provider: "manual",
      externalId: `activate:${inserted?.id}:${Date.now()}`,
      payload: { deviceId: inserted?.id, platform },
    });

    return json({ ok: true, deviceId: inserted?.id, reactivated: false });
  }

  return json({ error: "unknown_action" }, 400);
});
