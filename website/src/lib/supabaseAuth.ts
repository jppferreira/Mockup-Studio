import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';

let client: SupabaseClient | null | undefined;

export function isWebsiteAuthConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  return Boolean(url && key);
}

function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '');
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    client = null;
    return null;
  }
  client = createClient(url, key, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof localStorage === 'undefined' ? undefined : localStorage,
    },
  });
  return client;
}

export type AuthSnapshot = {
  user: User | null;
  session: Session | null;
};

export async function ensureFreshSession(): Promise<AuthSnapshot> {
  const sb = getSupabase();
  if (!sb) return { user: null, session: null };

  const { data, error } = await sb.auth.getSession();
  if (error || !data.session?.user) return { user: null, session: null };

  const expiresAtMs = (data.session.expires_at ?? 0) * 1000;
  const needsRefresh = !expiresAtMs || expiresAtMs < Date.now() + 120_000;
  if (!needsRefresh) {
    return { user: data.session.user, session: data.session };
  }

  const { data: refreshed, error: refreshError } = await sb.auth.refreshSession();
  if (refreshError || !refreshed.session?.user) {
    return { user: null, session: null };
  }
  return { user: refreshed.session.user, session: refreshed.session };
}

export async function requestEmailOtp(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Checkout sign-in is not configured.' };
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  const { error } = await sb.auth.signInWithOtp({
    email: trimmed,
    options: { shouldCreateUser: true },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function verifyEmailOtp(
  email: string,
  token: string,
): Promise<{ ok: true; user: User } | { ok: false; error: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Checkout sign-in is not configured.' };
  const { data, error } = await sb.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: 'email',
  });
  if (error || !data.user) return { ok: false, error: error?.message || 'Invalid or expired code.' };
  return { ok: true, user: data.user };
}
