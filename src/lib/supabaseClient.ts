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

/**
 * Return a usable session for cloud writes.
 * `getSession()` alone can report a cached user while the access token is expired;
 * PostgREST then runs as `anon` and every upsert fails with permission denied.
 */
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

export async function getAuthSnapshot(options?: { fresh?: boolean }): Promise<AuthSnapshot> {
  if (options?.fresh) return ensureFreshSession();
  const sb = getSupabase();
  if (!sb) return { user: null, session: null };
  const { data, error } = await sb.auth.getSession();
  if (error) return { user: null, session: null };
  return { user: data.session?.user ?? null, session: data.session };
}

/** Email one-time code — no password store, no OAuth redirect surface. */
export async function requestEmailOtp(
  email: string,
  options?: { createUser?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Cloud sync is not configured.' };
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  const { error } = await sb.auth.signInWithOtp({
    email: trimmed,
    options: {
      // Sign up creates the user; Sign in only emails existing accounts.
      shouldCreateUser: options?.createUser !== false,
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

export type OAuthProvider = 'google' | 'apple';

/** Desktop deep-link target after Google / Apple (Figma-style browser handoff). */
export const DESKTOP_AUTH_REDIRECT = 'mokstudio://auth/callback';

function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.mockupDesktop);
}

/** Canonical return URL after Google / Apple OAuth (no hash/query). */
export function authRedirectTo(): string {
  if (isDesktopRuntime()) return DESKTOP_AUTH_REDIRECT;
  if (typeof window === 'undefined') return 'https://mokstudio.io/app/';
  const url = new URL(window.location.href);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/index\.html$/i, '/');
  return url.toString();
}

/**
 * Finish a desktop browser OAuth round-trip (`mokstudio://auth/callback?code=…`).
 */
export async function completeDesktopOAuthCallback(
  callbackUrl: string,
): Promise<{ ok: true; user: User } | { ok: false; error: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Cloud sync is not configured.' };
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    return { ok: false, error: 'Invalid sign-in link.' };
  }
  const errorDescription = parsed.searchParams.get('error_description')
    || parsed.searchParams.get('error');
  if (errorDescription) {
    return { ok: false, error: errorDescription };
  }
  const code = parsed.searchParams.get('code');
  if (!code) return { ok: false, error: 'Sign-in link is missing a code. Try again.' };
  const { data, error } = await sb.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return { ok: false, error: error?.message || 'Could not finish browser sign-in.' };
  }
  return { ok: true, user: data.user };
}

/**
 * Start Google or Apple OAuth via Supabase.
 * Desktop opens the system browser (like Figma), then returns via mokstudio://.
 * Web stays in-tab. Apple needs a Services ID in the Auth dashboard.
 */
export async function signInWithOAuthProvider(
  provider: OAuthProvider,
): Promise<{ ok: true; desktopBrowser?: true } | { ok: false; error: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Cloud sync is not configured.' };

  const redirectTo = authRedirectTo();
  const { data, error } = await sb.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });
  if (error || !data?.url) {
    return { ok: false, error: error?.message || 'Could not start Google sign-in.' };
  }

  // Catch misconfigured providers before dumping users on a raw JSON error page.
  try {
    const probe = await fetch(data.url, { method: 'GET', redirect: 'manual' });
    if (probe.status === 400) {
      const body = await probe.json().catch(() => null) as { msg?: string } | null;
      return {
        ok: false,
        error: body?.msg || 'Google sign-in is not enabled for this project yet.',
      };
    }
  } catch {
    // CORS / opaque responses — continue and let the browser complete OAuth.
  }

  if (isDesktopRuntime()) {
    const openExternal = window.mockupDesktop?.openExternal;
    if (!openExternal) {
      return { ok: false, error: 'Desktop browser sign-in is unavailable in this build.' };
    }
    try {
      await openExternal(data.url);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Could not open the browser.',
      };
    }
    return { ok: true, desktopBrowser: true };
  }

  window.location.assign(data.url);
  return { ok: true };
}

export async function signOutCloud(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}

export function onAuthChange(handler: (snapshot: AuthSnapshot) => void): () => void {
  const sb = getSupabase();
  if (!sb) return () => undefined;
  const { data } = sb.auth.onAuthStateChange((event, session) => {
    // TEMP: session email seen when the dev allowlist is applied. Remove after checking.
    console.info('[dev-access] session email', session?.user?.email ?? null, event);
    handler({ user: session?.user ?? null, session });
  });
  return () => data.subscription.unsubscribe();
}
