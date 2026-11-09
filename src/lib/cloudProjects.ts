import { validateProject } from './project';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';
import type { RecentProjectEntry } from './recentProjects';
import type { MockupProject } from '../types';
import { placeholderForDevice } from './demo';

export type CloudProjectRow = {
  id: string;
  local_id: string;
  name: string;
  device_id: string;
  device_count: number;
  state: unknown;
  preview_url: string | null;
  updated_at: string;
  created_at: string;
};

const MAX_STATE_CHARS = 3_500_000;

/** Strip heavy data-URLs before upload — keep reopenable structure, avoid leaking huge blobs. */
export function slimForCloud(project: MockupProject): MockupProject {
  const scrub = (value: string | null | undefined, deviceId: string) => {
    if (typeof value !== 'string') return null;
    if (value.startsWith('data:image/') && value.length > 120_000) {
      return placeholderForDevice(deviceId);
    }
    if (value.length > 400_000) return null;
    return value;
  };
  const deviceId = project.deviceId || project.devices?.[0]?.deviceId || 'iphone-17-pro';
  return {
    ...project,
    screenshot: scrub(project.screenshot, deviceId),
    reflectionMapImage: scrub(project.reflectionMapImage, deviceId),
    devices: (project.devices ?? []).map((device) => ({
      ...device,
      screenshot: scrub(device.screenshot, device.deviceId),
    })),
  };
}

function rowToRecent(row: CloudProjectRow): RecentProjectEntry | null {
  try {
    const project = validateProject(row.state);
    const updatedAt = Date.parse(row.updated_at);
    return {
      id: row.local_id,
      name: row.name || project.name,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
      deviceId: row.device_id || project.deviceId,
      deviceCount: row.device_count || Math.max(1, project.devices?.length ?? 1),
      preview: null,
      project,
    };
  } catch {
    return null;
  }
}

export function isCloudSyncAvailable(): boolean {
  return isSupabaseConfigured();
}

/** Upsert one local recent entry for the signed-in user only (RLS-enforced). */
export async function pushRecentToCloud(
  entry: RecentProjectEntry,
): Promise<{ ok: true; id: string } | { ok: false; error: string; skipped?: boolean }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Cloud sync is not configured.', skipped: true };

  const { data: sessionData } = await sb.auth.getSession();
  if (!sessionData.session?.user) {
    return { ok: false, error: 'Sign in to sync projects to the cloud.', skipped: true };
  }

  const slim = slimForCloud(entry.project);
  const payload = JSON.stringify(slim);
  if (payload.length > MAX_STATE_CHARS) {
    return { ok: false, error: 'Project is too large to sync. Remove large custom images and try again.' };
  }

  // Never send user_id — DB trigger sets it from auth.uid().
  const { data, error } = await sb
    .from('mokstudio_projects')
    .upsert(
      {
        local_id: entry.id,
        name: (entry.name || slim.name || 'Untitled composition').slice(0, 200),
        device_id: entry.deviceId || slim.deviceId || 'iphone-17-pro',
        device_count: Math.max(1, entry.deviceCount || slim.devices?.length || 1),
        state: slim,
        updated_at: new Date(entry.updatedAt).toISOString(),
      },
      { onConflict: 'user_id,local_id' },
    )
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data?.id ?? '' };
}

/** Pull only the current user's rows (RLS). Merge into local recent list by local_id. */
export async function pullCloudProjects(): Promise<
  { ok: true; entries: RecentProjectEntry[] } | { ok: false; error: string; skipped?: boolean }
> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Cloud sync is not configured.', skipped: true };

  const { data: sessionData } = await sb.auth.getSession();
  if (!sessionData.session?.user) {
    return { ok: false, error: 'Sign in to load cloud projects.', skipped: true };
  }

  const { data, error } = await sb
    .from('mokstudio_projects')
    .select('id, local_id, name, device_id, device_count, state, preview_url, updated_at, created_at')
    .order('updated_at', { ascending: false })
    .limit(50);

  if (error) return { ok: false, error: error.message };

  const entries = (data as CloudProjectRow[] | null ?? [])
    .map(rowToRecent)
    .filter((entry): entry is RecentProjectEntry => entry != null);

  return { ok: true, entries };
}

export async function deleteCloudProject(localId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Cloud sync is not configured.' };
  const { data: sessionData } = await sb.auth.getSession();
  if (!sessionData.session?.user) return { ok: false, error: 'Sign in required.' };

  const { error } = await sb.from('mokstudio_projects').delete().eq('local_id', localId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Push every local recent project for the signed-in user. */
export async function pushAllRecentToCloud(
  entries: RecentProjectEntry[],
): Promise<{ ok: true; synced: number } | { ok: false; error: string; synced: number }> {
  let synced = 0;
  for (const entry of entries) {
    const result = await pushRecentToCloud(entry);
    if (!result.ok && !result.skipped) return { ok: false, error: result.error, synced };
    if (result.ok) synced += 1;
  }
  return { ok: true, synced };
}
