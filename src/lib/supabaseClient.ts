import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';

let client: SupabaseClient | null | undefined;

/** True when URL + anon key are present (same env used for device models). */
export function isSupabaseConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  return Boolean(url && key);
}

/**
 * Browser/Electron anon client. Relies on RLS — never use a service-role key here.
 * Auth uses PKCE + localStorage session; email OTP preferred (no redirect secrets).
 */
export function getSupabase(): SupabaseClient | null {
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

export async function getAuthSnapshot(): Promise<AuthSnapshot> {
  const sb = getSupabase();
  if (!sb) return { user: null, session: null };
  const { data, error } = await sb.auth.getSession();
  if (error) return { user: null, session: null };
  return { user: data.session?.user ?? null, session: data.session };
}

/** Email one-time code — no password store, no OAuth redirect surface. */
export async function requestEmailOtp(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Cloud sync is not configured.' };
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  const { error } = await sb.auth.signInWithOtp({
    email: trimmed,
    options: {
      shouldCreateUser: true,
      // Desktop-friendly: user pastes the 6–8 digit code; no magic-link redirect required.
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function verifyEmailOtp(
  email: string,
  token: string,
): Promise<{ ok: true; user: User } | { ok: false; error: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Cloud sync is not configured.' };
  const { data, error } = await sb.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: 'email',
  });
  if (error || !data.user) return { ok: false, error: error?.message || 'Invalid or expired code.' };
  return { ok: true, user: data.user };
}

export async function signOutCloud(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}

export function onAuthChange(handler: (snapshot: AuthSnapshot) => void): () => void {
  const sb = getSupabase();
  if (!sb) return () => undefined;
  const { data } = sb.auth.onAuthStateChange((_event, session) => {
    handler({ user: session?.user ?? null, session });
  });
  return () => data.subscription.unsubscribe();
}
