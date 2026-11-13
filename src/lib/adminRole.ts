/**
 * Server-backed administrator role (mokstudio_admins).
 * UI may hide controls; RLS remains the security boundary.
 */

import { ensureFreshSession, getSupabase, isSupabaseConfigured } from './supabaseClient';
import { isDevAccessEmail } from './modelingMode';

let cachedAdmin: { userId: string; isAdmin: boolean; at: number } | null = null;
const CACHE_MS = 60_000;
const listeners = new Set<(isAdmin: boolean) => void>();

function notify(isAdmin: boolean) {
  listeners.forEach((listener) => {
    try {
      listener(isAdmin);
    } catch {
      /* ignore */
    }
  });
}

export function subscribeAdminRole(listener: (isAdmin: boolean) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function clearAdminRoleCache(): void {
  cachedAdmin = null;
}

/** True when the signed-in user has a row in mokstudio_admins (or legacy Dev email while offline). */
export async function fetchIsAdmin(options?: { force?: boolean }): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }
  const auth = await ensureFreshSession();
  const user = auth.user;
  if (!user?.id) {
    cachedAdmin = null;
    notify(false);
    return false;
  }

  const now = Date.now();
  if (
    !options?.force
    && cachedAdmin
    && cachedAdmin.userId === user.id
    && now - cachedAdmin.at < CACHE_MS
  ) {
    return cachedAdmin.isAdmin;
  }

  const sb = getSupabase();
  if (!sb) {
    const fallback = isDevAccessEmail(user.email);
    cachedAdmin = { userId: user.id, isAdmin: fallback, at: now };
    notify(fallback);
    return fallback;
  }

  const { data, error } = await sb
    .from('mokstudio_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    // Table missing / network — fall back to known Dev email for local continuity.
    const fallback = isDevAccessEmail(user.email);
    cachedAdmin = { userId: user.id, isAdmin: fallback, at: now };
    notify(fallback);
    return fallback;
  }

  const isAdmin = Boolean(data?.user_id);
  cachedAdmin = { userId: user.id, isAdmin, at: now };
  notify(isAdmin);
  return isAdmin;
}

export function getCachedIsAdmin(): boolean {
  return Boolean(cachedAdmin?.isAdmin);
}
