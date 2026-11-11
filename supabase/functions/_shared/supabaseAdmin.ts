import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "./cors.ts";

export type AdminClients = {
  userId: string;
  userEmail: string | null;
  userClient: SupabaseClient;
  admin: SupabaseClient;
};

export async function requireUser(req: Request): Promise<AdminClients | Response> {
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

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    userId: userData.user.id,
    userEmail: userData.user.email ?? null,
    userClient,
    admin,
  };
}

export async function recordEvent(
  admin: SupabaseClient,
  input: {
    userId?: string | null;
    actor: string;
    eventType: string;
    provider?: string | null;
    externalId?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<{ duplicate: boolean }> {
  if (input.externalId && input.provider) {
    const { data: existing } = await admin
      .from("mokstudio_entitlement_events")
      .select("id")
      .eq("provider", input.provider)
      .eq("external_id", input.externalId)
      .maybeSingle();
    if (existing?.id) return { duplicate: true };
  }

  const { error } = await admin.from("mokstudio_entitlement_events").insert({
    user_id: input.userId ?? null,
    actor: input.actor,
    event_type: input.eventType,
    provider: input.provider ?? null,
    external_id: input.externalId ?? null,
    payload: input.payload ?? {},
  });

  // Unique race → treat as duplicate.
  if (error?.code === "23505") return { duplicate: true };
  if (error) throw new Error(error.message);
  return { duplicate: false };
}

export { corsHeaders, json };
