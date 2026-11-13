/**
 * Master template catalog on Supabase.
 * Dev admin publishes; every signed-in user can read / download.
 * My Templates stay local — they are never pushed here.
 */

import { ensureFreshSession, getSupabase, isSupabaseConfigured } from './supabaseClient';
import { isDevAccessEmail } from './modelingMode';
import type { CompositionTemplate } from './templates';
import {
  loadShippedPackTemplates,
  loadShippedRemovedIds,
  parseShippedTemplatePack,
  serializeShippedTemplatePack,
} from './shippedTemplates';

const CATALOG_TABLE = 'mokstudio_template_catalog';
const MASTER_ID = 'master';

/** Publish the current master pack to Supabase (Dev admin only). */
export async function pushMasterTemplateCatalog(options?: {
  templates?: CompositionTemplate[];
  removedIds?: string[];
  contents?: string;
}): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Cloud account is not configured.', skipped: true };
  }
  const auth = await ensureFreshSession();
  if (!auth.session?.user || !auth.user) {
    return { ok: false, error: 'Sign in as Dev to publish the master catalog.', skipped: true };
  }
  if (!isDevAccessEmail(auth.user.email)) {
    return { ok: false, error: 'Only the Dev admin can publish master templates.', skipped: true };
  }
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Cloud account is not configured.', skipped: true };

  let payload: unknown;
  if (options?.contents) {
    try {
      payload = JSON.parse(options.contents);
    } catch {
      return { ok: false, error: 'Master catalog JSON is invalid' };
    }
  } else {
    const templates = options?.templates ?? loadShippedPackTemplates();
    const removedIds = options?.removedIds ?? loadShippedRemovedIds();
    payload = JSON.parse(serializeShippedTemplatePack(templates, removedIds));
  }

  const { error } = await sb
    .from(CATALOG_TABLE)
    .upsert(
      {
        id: MASTER_ID,
        payload,
      },
      { onConflict: 'id' },
    );

  if (error) {
    return { ok: false, error: error.message || 'Could not publish master catalog' };
  }
  return { ok: true };
}

/** Pull the shared master catalog pack (any signed-in user). */
export async function pullMasterTemplateCatalog(): Promise<{
  ok: boolean;
  templates?: CompositionTemplate[];
  removedIds?: string[];
  contents?: string;
  updatedAt?: string;
  error?: string;
  skipped?: boolean;
  missing?: boolean;
}> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Cloud account is not configured.', skipped: true };
  }
  const auth = await ensureFreshSession();
  if (!auth.session?.user) {
    return { ok: false, error: 'Sign in to load the template catalog.', skipped: true };
  }
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Cloud account is not configured.', skipped: true };

  const { data, error } = await sb
    .from(CATALOG_TABLE)
    .select('payload, updated_at')
    .eq('id', MASTER_ID)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message || 'Could not load master catalog' };
  }
  if (!data?.payload) {
    return { ok: true, missing: true, templates: [], removedIds: [] };
  }

  const contents = JSON.stringify(data.payload);
  const templates = parseShippedTemplatePack(data.payload);
  const removedIds = Array.isArray((data.payload as { removedIds?: unknown }).removedIds)
    ? (data.payload as { removedIds: unknown[] }).removedIds.flatMap((id) => (
      typeof id === 'string' && id.trim() ? [id.trim()] : []
    ))
    : [];

  return {
    ok: true,
    templates,
    removedIds,
    contents,
    updatedAt: typeof data.updated_at === 'string' ? data.updated_at : undefined,
  };
}
