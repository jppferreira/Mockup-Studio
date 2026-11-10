/**
 * Cloud project rows + push/pull helpers.
 * SceneDocuments are the sync unit; media lives in `project-assets` (content-addressed).
 */

import { validateProject } from './project';
import { ensureFreshSession, getSupabase, isSupabaseConfigured } from './supabaseClient';
import { normalizeProjectName, type RecentProjectEntry } from './recentProjects';
import {
  collectDeviceRefs,
  createDocumentId,
  externalizeSceneAssets,
  isSceneDocument,
  migrateDocument,
  parseProjectPayload,
  wrapProject,
  type SceneAssetRef,
  type SceneDocument,
} from './sceneDocument';
import {
  createSignedAssetUrl,
  hydrateCloudMediaUrls,
  uploadDocumentAssets,
} from './cloudAssets';
import { compressSceneImagesForCloud } from './compressImage';
import { getAssetBlob, getProjectDocument, putAssetBlob, putProjectDocument } from './projectStore';
import type { DeviceInstance, MaterialTweak, MockupProject, SceneStage } from '../types';

export type CloudProjectRow = {
  id: string;
  local_id: string;
  name: string;
  device_id: string;
  device_count: number;
  state: unknown;
  preview_url: string | null;
  preview_hash?: string | null;
  revision: number;
  deleted_at: string | null;
  updated_at: string;
  created_at: string;
};

export type CloudProjectMeta = Pick<
  CloudProjectRow,
  'id' | 'local_id' | 'name' | 'device_id' | 'device_count' | 'preview_url' | 'preview_hash' | 'revision' | 'deleted_at' | 'updated_at' | 'created_at'
>;

export type CloudPushResult =
  | { ok: true; id: string; revision: number }
  | {
    ok: false;
    error: string;
    skipped?: boolean;
    /** Remote row is ahead of this device. Do not upload, and do not treat it as a conflict. */
    superseded?: boolean;
    conflict?: CloudProjectRow;
  };

/**
 * Cloud must be this much newer than the copy on this device before it replaces it.
 * Saves a couple of seconds apart are the same editing session, so this device keeps its file.
 */
/**
 * Which copy to keep when both sides have a save.
 * The later edit wins, including devices, angles, lights, and position.
 * An equal timestamp keeps this device so a push is not undone.
 */
export function newerSyncCopy(
  localUpdatedAt: number,
  remoteUpdatedAt: number,
): 'keep-local' | 'take-cloud' {
  const local = Number.isFinite(localUpdatedAt) ? localUpdatedAt : 0;
  const remote = Number.isFinite(remoteUpdatedAt) ? remoteUpdatedAt : 0;
  if (remote > local) return 'take-cloud';
  return 'keep-local';
}

/**
 * True when the account row should replace the copy stored on this device.
 * A browser that merely reopened an older session must not win over a desktop save.
 */
export function shouldAdoptRemoteDocument(
  local: { revision: number; baseRevision: number } | null,
  remoteRevision: number,
): boolean {
  if (!(remoteRevision > 0)) return false;
  if (!local) return true;
  if (remoteRevision > local.revision) return true;
  if (local.baseRevision <= 0 && remoteRevision >= local.revision) return true;
  const dirty = local.revision > local.baseRevision;
  if (!dirty && remoteRevision > local.baseRevision) return true;
  // Same revision counter as the cloud, but this device never sealed that sync.
  // The account row is the saved file; a local bump to the same number is not a newer edit.
  if (dirty && remoteRevision === local.revision && remoteRevision > local.baseRevision) return true;
  return false;
}

export const MAX_STATE_CHARS = 3_500_000;
/** Anything bigger than this that is not an asset ref is media — never put it in the row. */
const MAX_INLINE_CHARS = 8_192;

function scrubInlineMedia(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  // Keep short content-addressed refs so the other device can download the file.
  if (value.startsWith('asset:sha256:')) return value;
  // data: URLs (images, video, audio) blow past PostgREST/JSON limits.
  if (/^data:/i.test(value)) return null;
  if (/^blob:/i.test(value)) return null;
  if (value.length > MAX_INLINE_CHARS) return null;
  return value;
}

/**
 * Walk the whole cloud JSON and drop leftover heavy strings.
 * Catches material maps / path blobs that the typed slim pass can miss.
 */
function deepScrubHeavyStrings(value: unknown): unknown {
  if (typeof value === 'string') return scrubInlineMedia(value);
  if (Array.isArray(value)) return value.map(deepScrubHeavyStrings);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = deepScrubHeavyStrings(entry);
  }
  return out;
}

/**
 * Open projects are hydrated for editing (full data: URLs). Turn those bytes
 * back into asset refs before the cloud size check, or every screenshot is
 * counted twice and sync fails as "too large".
 */
async function prepareDocumentForCloud(doc: SceneDocument): Promise<SceneDocument> {
  // Shrink bulky stills before externalise so storage and any leftover inline
  // media stay under the sync size limit.
  const compressedScene = await compressSceneImagesForCloud(doc.scene);
  const { scene, assets, blobs } = await externalizeSceneAssets(compressedScene);
  for (const [hash, blob] of blobs) {
    await putAssetBlob(hash, blob.mime, blob.bytes);
  }
  const byHash = new Map<string, SceneAssetRef>();
  for (const ref of [...(doc.assets ?? []), ...assets]) {
    if (ref?.hash) byHash.set(ref.hash, ref);
  }
  const nextScene = validateProject(scene);
  return {
    ...doc,
    scene: nextScene,
    assets: [...byHash.values()],
    deviceRefs: collectDeviceRefs(nextScene),
  };
}

function slimMaterialTweaks(
  tweaks: DeviceInstance['materialTweaks'],
): DeviceInstance['materialTweaks'] {
  if (!tweaks) return tweaks;
  return Object.fromEntries(
    Object.entries(tweaks).map(([name, tweak]) => {
      if (!tweak || typeof tweak !== 'object') return [name, tweak];
      const next: MaterialTweak = { ...tweak };
      for (const key of Object.keys(next)) {
        const value = next[key];
        if (typeof value !== 'string') continue;
        const scrubbed = scrubInlineMedia(value);
        if (scrubbed == null) delete next[key];
        else next[key] = scrubbed;
      }
      return [name, next];
    }),
  );
}

function slimDevice(device: DeviceInstance): DeviceInstance {
  return {
    ...device,
    screenshot: scrubInlineMedia(device.screenshot),
    screenLayers: Array.isArray(device.screenLayers)
      ? device.screenLayers
        .map((plate) => ({ ...plate, dataUrl: scrubInlineMedia(plate.dataUrl) || '' }))
        .filter((plate) => plate.dataUrl.length > 0)
      : undefined,
    materialTweaks: slimMaterialTweaks(device.materialTweaks),
  };
}

function slimOverlays<T extends { imageData?: string | null }>(overlays: T[] | undefined): T[] | undefined {
  if (!overlays) return overlays;
  return overlays.map((overlay) => ({
    ...overlay,
    imageData: scrubInlineMedia(overlay.imageData),
  }));
}

function slimStage(stage: SceneStage): SceneStage {
  return {
    ...stage,
    reflectionMapImage: scrubInlineMedia(stage.reflectionMapImage),
    devices: (stage.devices ?? []).map(slimDevice),
    overlays: slimOverlays(stage.overlays) ?? stage.overlays,
  };
}

/**
 * Strip heavy inline media before upload.
 * Never embed raw data: URLs in cloud JSON — full-res placeholders alone can exceed
 * the row size limit. Real media should already be in `project-assets` via uploadDocumentAssets.
 * Each composition scene keeps its own stage copy of those images; those copies are stripped too.
 */
export function slimForCloud(project: MockupProject): MockupProject {
  return {
    ...project,
    screenshot: scrubInlineMedia(project.screenshot),
    reflectionMapImage: scrubInlineMedia(project.reflectionMapImage),
    soundtrackData: scrubInlineMedia(project.soundtrackData),
    devices: (project.devices ?? []).map(slimDevice),
    overlays: slimOverlays(project.overlays) ?? project.overlays,
    scenes: (project.scenes ?? []).map((scene) => (
      scene.stage ? { ...scene, stage: slimStage(scene.stage) } : scene
    )),
  };
}

/** Last-resort slim when a file still exceeds the row limit after normal scrubbing. */
function emergencySlimForCloud(project: MockupProject): MockupProject {
  const stripDevice = (device: DeviceInstance): DeviceInstance => ({
    ...device,
    screenshot: typeof device.screenshot === 'string' && device.screenshot.startsWith('asset:sha256:')
      ? device.screenshot
      : null,
    screenLayers: undefined,
    materialTweaks: device.materialTweaks
      ? Object.fromEntries(
        Object.entries(device.materialTweaks).map(([name, tweak]) => {
          if (!tweak || typeof tweak !== 'object') return [name, tweak];
          const next: MaterialTweak = {};
          for (const [key, value] of Object.entries(tweak)) {
            if (typeof value === 'string') {
              if (value.startsWith('asset:sha256:')) next[key] = value;
              continue;
            }
            next[key] = value;
          }
          return [name, next];
        }),
      )
      : undefined,
  });
  return {
    ...project,
    screenshot: typeof project.screenshot === 'string' && project.screenshot.startsWith('asset:sha256:')
      ? project.screenshot
      : null,
    reflectionMapImage: typeof project.reflectionMapImage === 'string'
      && project.reflectionMapImage.startsWith('asset:sha256:')
      ? project.reflectionMapImage
      : null,
    soundtrackData: null,
    soundtrackName: null,
    devices: (project.devices ?? []).map(stripDevice),
    overlays: (project.overlays ?? []).map((overlay) => ({
      ...overlay,
      imageData: typeof overlay.imageData === 'string' && overlay.imageData.startsWith('asset:sha256:')
        ? overlay.imageData
        : null,
    })),
    scenes: (project.scenes ?? []).map((scene) => (
      scene.stage
        ? {
          ...scene,
          stage: {
            ...scene.stage,
            reflectionMapImage: typeof scene.stage.reflectionMapImage === 'string'
              && scene.stage.reflectionMapImage.startsWith('asset:sha256:')
              ? scene.stage.reflectionMapImage
              : null,
            devices: (scene.stage.devices ?? []).map(stripDevice),
            overlays: (scene.stage.overlays ?? []).map((overlay) => ({
              ...overlay,
              imageData: typeof overlay.imageData === 'string'
                && overlay.imageData.startsWith('asset:sha256:')
                ? overlay.imageData
                : null,
            })),
          },
        }
        : scene
    )),
  };
}

function projectFromCloudState(state: unknown): MockupProject {
  if (isSceneDocument(state)) return parseProjectPayload(state).project;
  return validateProject(state);
}

function documentFromCloudState(state: unknown, localId: string, revision: number, updatedAt: number): SceneDocument {
  if (isSceneDocument(state)) {
    const doc = migrateDocument(state);
    return {
      ...doc,
      id: localId,
      revision: Math.max(doc.revision, revision),
      baseRevision: revision,
      updatedAt,
    };
  }
  return wrapProject(validateProject(state), {
    id: localId,
    revision,
    baseRevision: revision,
    updatedAt,
  });
}

async function rowToRecent(row: CloudProjectRow): Promise<RecentProjectEntry | null> {
  try {
    const source = isSceneDocument(row.state) ? migrateDocument(row.state) : null;
    const project = slimForCloud(await hydrateCloudMediaUrls(
      source?.scene ?? projectFromCloudState(row.state),
      source?.assets ?? [],
    ));
    const updatedAt = Date.parse(row.updated_at);
    let preview: string | null = null;
    if (row.preview_url) {
      const signed = await createSignedAssetUrl(row.preview_url);
      preview = signed;
    }
    const named = withCloudName(project, row.name);
    return {
      id: row.local_id,
      name: named.name,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
      deviceId: row.device_id || named.deviceId,
      deviceCount: row.device_count || Math.max(1, named.devices?.length ?? 1),
      preview,
      project: named,
    };
  } catch {
    return null;
  }
}

export function isCloudSyncAvailable(): boolean {
  return isSupabaseConfigured();
}

async function requireUser() {
  const sb = getSupabase();
  if (!sb) return { sb: null as null, userId: null as null, error: 'Cloud sync is not configured.', skipped: true as const };
  const snap = await ensureFreshSession();
  if (!snap.session?.user) {
    return {
      sb: null as null,
      userId: null as null,
      error: 'Sign in to sync projects to the cloud.',
      skipped: true as const,
    };
  }
  return { sb, userId: snap.session.user.id, error: null as null, skipped: false as const };
}

export async function fetchCloudProjectMeta(localId: string): Promise<CloudProjectMeta | null> {
  const auth = await requireUser();
  if (!auth.sb) return null;
  const { data, error } = await auth.sb
    .from('mokstudio_projects')
    .select('id, local_id, name, device_id, device_count, preview_url, preview_hash, revision, deleted_at, updated_at, created_at')
    .eq('local_id', localId)
    .maybeSingle();
  if (error || !data) return null;
  return data as CloudProjectMeta;
}

export async function fetchCloudProjectRow(localId: string): Promise<CloudProjectRow | null> {
  const auth = await requireUser();
  if (!auth.sb) return null;
  const { data, error } = await auth.sb
    .from('mokstudio_projects')
    .select('id, local_id, name, device_id, device_count, state, preview_url, preview_hash, revision, deleted_at, updated_at, created_at')
    .eq('local_id', localId)
    .maybeSingle();
  if (error || !data) return null;
  return data as CloudProjectRow;
}

function toCloudState(doc: SceneDocument, emergency = false): SceneDocument {
  const scene = emergency ? emergencySlimForCloud(doc.scene) : slimForCloud(doc.scene);
  const scrubbed = deepScrubHeavyStrings({
    ...doc,
    scene,
  }) as SceneDocument;
  return scrubbed;
}

/** JSON measured by the sync size check. Media is stripped before this string is built. */
export function cloudSyncPayload(doc: SceneDocument, emergency = false): string {
  return JSON.stringify(toCloudState(doc, emergency));
}

/** Push one SceneDocument. Detects conflicts when remote revision advanced past local baseRevision. */
export async function pushDocumentToCloud(
  doc: SceneDocument,
  options?: { force?: boolean },
): Promise<CloudPushResult> {
  const auth = await requireUser();
  if (!auth.sb || !auth.userId) {
    return { ok: false, error: auth.error || 'Sign in required.', skipped: auth.skipped };
  }

  // One-row lookup. Skipping it for baseRevision 0 let a stale browser copy
  // upsert over a newer desktop save of the same file.
  const remoteMeta = options?.force ? null : await fetchCloudProjectMeta(doc.id);
  if (remoteMeta && !remoteMeta.deleted_at && !options?.force) {
    const remoteRevision = typeof remoteMeta.revision === 'number' ? remoteMeta.revision : 1;
    const remoteUpdated = Date.parse(remoteMeta.updated_at) || 0;
    // The later save is the file. Do not overwrite a newer account copy, and
    // do not stop for a conflict — the other device just picks up this save.
    if (newerSyncCopy(doc.updatedAt, remoteUpdated) === 'take-cloud') {
      return { ok: false, error: 'Cloud copy is newer.', skipped: true, superseded: true };
    }
    if (shouldAdoptRemoteDocument(
      { revision: doc.revision, baseRevision: doc.baseRevision },
      remoteRevision,
    ) && remoteUpdated >= doc.updatedAt) {
      return { ok: false, error: 'Cloud copy is newer.', skipped: true, superseded: true };
    }
  }

  // Editor copies are hydrated. Externalise first so the row only carries asset
  // refs — otherwise inline screenshots trip the size limit and never sync.
  let prepared: SceneDocument;
  try {
    prepared = await prepareDocumentForCloud(doc);
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not prepare this project for sync.',
    };
  }

  // Screenshots are stored as asset refs in the row. Upload the bytes first so
  // the other device can download them when it opens the file.
  try {
    await uploadDocumentAssets(auth.userId, prepared);
  } catch (error: unknown) {
    console.warn(
      '[cloud] asset upload warnings',
      error instanceof Error ? error.message : 'Asset upload failed',
    );
  }
  const previewKey: string | null = null;
  const previewHash: string | null = null;

  let payload = cloudSyncPayload(prepared);
  if (payload.length > MAX_STATE_CHARS) {
    // Drop leftover inline maps / soundtrack bytes; keep asset refs for screens.
    payload = cloudSyncPayload(prepared, true);
  }
  if (payload.length > MAX_STATE_CHARS) {
    return { ok: false, error: 'Project is too large to sync. Remove large custom images and try again.' };
  }
  const stateDoc = JSON.parse(payload) as SceneDocument;

  const scene = stateDoc.scene;
  const revision = Math.max(1, prepared.revision);

  const row = {
    user_id: auth.userId,
    local_id: prepared.id,
    name: (scene.name || 'Untitled composition').slice(0, 200),
    device_id: scene.deviceId || scene.devices?.[0]?.deviceId || 'iphone-17-pro',
    device_count: Math.max(1, scene.devices?.length || 1),
    state: stateDoc,
    revision,
    preview_url: previewKey,
    preview_hash: previewHash,
    deleted_at: null,
    updated_at: new Date(prepared.updatedAt).toISOString(),
  };

  // Prefer insert for brand-new local ids — avoids rewriting huge existing rows by accident.
  // Fall back to upsert when the row already exists.
  const attemptWrite = async (payload: typeof row, mode: 'insert' | 'upsert') => {
    if (mode === 'insert') {
      return auth.sb.from('mokstudio_projects').insert(payload).select('id, revision').maybeSingle();
    }
    return auth.sb
      .from('mokstudio_projects')
      .upsert(payload, { onConflict: 'user_id,local_id' })
      .select('id, revision')
      .maybeSingle();
  };

  const mode: 'insert' | 'upsert' = remoteMeta && !remoteMeta.deleted_at ? 'upsert' : 'insert';
  let { data, error } = await attemptWrite(row, mode);

  // Concurrent create → row exists; retry as upsert.
  if (error && mode === 'insert' && /duplicate|unique/i.test(error.message)) {
    ({ data, error } = await attemptWrite(row, 'upsert'));
  }

  // Preview keys that fail the CHECK should not block the project body from syncing.
  if (error && row.preview_url && /preview_url|check constraint/i.test(error.message)) {
    ({ data, error } = await attemptWrite({ ...row, preview_url: null, preview_hash: null }, mode === 'insert' ? 'upsert' : mode));
  }

  // Stale JWT → PostgREST runs as anon → permission denied. Refresh once and retry.
  if (error && /permission denied|JWT|expired|not authorized/i.test(error.message)) {
    const refreshed = await ensureFreshSession();
    if (refreshed.session?.user) {
      ({ data, error } = await attemptWrite({ ...row, user_id: refreshed.session.user.id }, 'upsert'));
    }
  }

  if (error) return { ok: false, error: error.message };
  if (!data?.id) {
    return {
      ok: false,
      error: 'Cloud did not confirm the save. Sign in again, then use Sync now.',
    };
  }
  return { ok: true, id: data.id, revision: typeof data.revision === 'number' ? data.revision : revision };
}

/** @deprecated Prefer pushDocumentToCloud — kept for recent-entry callers. */
export async function pushRecentToCloud(
  entry: RecentProjectEntry,
): Promise<CloudPushResult> {
  const existing = await getProjectDocument(entry.id);
  const doc = existing ?? wrapProject(entry.project, {
    id: entry.id,
    updatedAt: entry.updatedAt,
  });
  // Prefer the in-memory project tip when newer than the stored doc.
  const tip = entry.updatedAt >= doc.updatedAt
    ? wrapProject(entry.project, {
      id: doc.id,
      revision: doc.revision,
      baseRevision: doc.baseRevision,
      updatedAt: entry.updatedAt,
      assets: doc.assets,
    })
    : doc;
  return pushDocumentToCloud(tip);
}

/** Lightweight index for Sync now — never downloads full `state` blobs. */
export async function listCloudProjectMeta(options?: { includeDeleted?: boolean }): Promise<
  { ok: true; rows: CloudProjectMeta[]; deleted: CloudProjectMeta[] }
  | { ok: false; error: string; skipped?: boolean }
> {
  const auth = await requireUser();
  if (!auth.sb) return { ok: false, error: auth.error || 'Sign in required.', skipped: auth.skipped };

  let query = auth.sb
    .from('mokstudio_projects')
    .select('id, local_id, name, device_id, device_count, preview_url, preview_hash, revision, deleted_at, updated_at, created_at')
    .order('updated_at', { ascending: false })
    .limit(80);

  if (!options?.includeDeleted) {
    query = query.is('deleted_at', null);
  }

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };

  const rows = (data as CloudProjectMeta[] | null ?? []);
  return {
    ok: true,
    rows: rows.filter((row) => !row.deleted_at),
    deleted: rows.filter((row) => Boolean(row.deleted_at)),
  };
}

export async function pullCloudProjects(options?: { includeDeleted?: boolean }): Promise<
  { ok: true; entries: RecentProjectEntry[]; rows: CloudProjectRow[]; deleted: CloudProjectRow[] }
  | { ok: false; error: string; skipped?: boolean }
> {
  const meta = await listCloudProjectMeta(options);
  if (!meta.ok) return meta;

  const active: CloudProjectRow[] = [];
  const deleted: CloudProjectRow[] = [];
  const entries: RecentProjectEntry[] = [];

  for (const item of meta.rows) {
    const row = await fetchCloudProjectRow(item.local_id);
    if (!row || row.deleted_at) continue;
    active.push(row);
    const entry = await rowToRecent(row);
    if (entry) entries.push(entry);
  }
  for (const item of meta.deleted) {
    deleted.push({ ...item, state: null });
  }
  return { ok: true, entries, rows: active, deleted };
}

/**
 * Update the account row's name only.
 * Does not read or write `state`, so a rename never uploads the scene blob.
 */
export async function renameCloudProject(
  localId: string,
  name: string,
): Promise<{ ok: true; missing?: boolean } | { ok: false; error: string; skipped?: boolean }> {
  const nextName = normalizeProjectName(name);
  if (!localId || !nextName) return { ok: false, error: 'Enter a project name.' };

  const auth = await requireUser();
  if (!auth.sb) {
    return { ok: false, error: auth.error || 'Sign in required.', skipped: auth.skipped };
  }

  const { data, error } = await auth.sb
    .from('mokstudio_projects')
    .update({ name: nextName })
    .eq('local_id', localId)
    .is('deleted_at', null)
    .select('local_id');

  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: true, missing: true };
  return { ok: true };
}

/** Soft-delete on the server so other devices drop the project on next sync. Not user-restorable. */
export async function deleteCloudProject(localId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireUser();
  if (!auth.sb) return { ok: false, error: auth.error || 'Sign in required.' };

  const { error } = await auth.sb
    .from('mokstudio_projects')
    .update({ deleted_at: new Date().toISOString() })
    .eq('local_id', localId)
    .is('deleted_at', null);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Permanently remove a soft-deleted cloud row. */
export async function purgeCloudProject(localId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireUser();
  if (!auth.sb) return { ok: false, error: auth.error || 'Sign in required.' };
  const { error } = await auth.sb.from('mokstudio_projects').delete().eq('local_id', localId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function restoreCloudProject(localId: string): Promise<
  { ok: true; entry: RecentProjectEntry } | { ok: false; error: string }
> {
  const auth = await requireUser();
  if (!auth.sb) return { ok: false, error: auth.error || 'Sign in required.' };

  const { data, error } = await auth.sb
    .from('mokstudio_projects')
    .update({ deleted_at: null, updated_at: new Date().toISOString() })
    .eq('local_id', localId)
    .select('id, local_id, name, device_id, device_count, state, preview_url, preview_hash, revision, deleted_at, updated_at, created_at')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Project not found.' };
  const entry = await rowToRecent(data as CloudProjectRow);
  if (!entry) return { ok: false, error: 'Restored project could not be opened.' };

  const row = data as CloudProjectRow;
  const doc = documentFromCloudState(
    row.state,
    row.local_id,
    typeof row.revision === 'number' ? row.revision : 1,
    entry.updatedAt,
  );
  await putProjectDocument({ ...doc, scene: entry.project }, { id: entry.id, enqueueOutbox: false });
  return { ok: true, entry };
}

/** Duplicate a cloud (or local) project under a new local_id and push. */
export async function duplicateCloudProject(localId: string): Promise<
  { ok: true; entry: RecentProjectEntry } | { ok: false; error: string }
> {
  const source = await getProjectDocument(localId);
  const remote = source ? null : await fetchCloudProjectRow(localId);
  let doc: SceneDocument | null = source;
  if (!doc && remote) {
    const updatedAt = Date.parse(remote.updated_at) || Date.now();
    doc = documentFromCloudState(
      remote.state,
      remote.local_id,
      typeof remote.revision === 'number' ? remote.revision : 1,
      updatedAt,
    );
    doc = {
      ...doc,
      scene: await hydrateCloudMediaUrls(doc.scene, doc.assets),
    };
  }
  if (!doc) return { ok: false, error: 'Project not found.' };

  const copyId = createDocumentId();
  const named = {
    ...doc.scene,
    name: `${doc.scene.name || 'Untitled'} copy`.slice(0, 100),
  };
  const copy = wrapProject(named, {
    id: copyId,
    revision: 1,
    baseRevision: 0,
    updatedAt: Date.now(),
    assets: doc.assets,
  });
  // Copy referenced local blobs stay addressable by hash — no re-encode needed.
  for (const asset of doc.assets) {
    const blob = await getAssetBlob(asset.hash);
    if (blob) {
      // already in IDB
    }
  }
  const saved = await putProjectDocument(copy, { id: copyId, enqueueOutbox: true });
  const push = await pushDocumentToCloud(saved, { force: true });
  if (!push.ok && !push.skipped) return { ok: false, error: push.error };

  return {
    ok: true,
    entry: {
      id: saved.id,
      name: saved.scene.name,
      updatedAt: saved.updatedAt,
      deviceId: saved.scene.deviceId,
      deviceCount: Math.max(1, saved.scene.devices.length),
      preview: null,
      project: saved.scene,
    },
  };
}

export async function pushAllRecentToCloud(
  entries: RecentProjectEntry[],
): Promise<{ ok: true; synced: number; conflicts: CloudProjectRow[] } | { ok: false; error: string; synced: number; conflicts: CloudProjectRow[] }> {
  let synced = 0;
  const conflicts: CloudProjectRow[] = [];
  for (const entry of entries) {
    const result = await pushRecentToCloud(entry);
    if (result.ok) {
      synced += 1;
      continue;
    }
    if (result.skipped) continue;
    if (result.conflict) {
      conflicts.push(result.conflict);
      continue;
    }
    return { ok: false, error: result.error, synced, conflicts };
  }
  return { ok: true, synced, conflicts };
}

export async function cloudRowToDocument(row: CloudProjectRow): Promise<SceneDocument> {
  const updatedAt = Date.parse(row.updated_at) || Date.now();
  const revision = typeof row.revision === 'number' && row.revision >= 1 ? row.revision : 1;
  const doc = documentFromCloudState(row.state, row.local_id, revision, updatedAt);
  const scene = withCloudName(await hydrateCloudMediaUrls(doc.scene, doc.assets), row.name);
  return { ...doc, scene, baseRevision: revision, revision };
}

/** Prefer the account row label over a stale name inside the scene blob. */
function withCloudName(project: MockupProject, rowName: string | null | undefined): MockupProject {
  const name = normalizeProjectName(rowName || '') || normalizeProjectName(project.name) || 'Untitled composition';
  if (project.name === name) return project;
  return { ...project, name };
}
