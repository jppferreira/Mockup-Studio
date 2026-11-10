/**
 * Outbox flush + conflict-aware pull for local-first cloud sync.
 */

import { useEffect, useState } from 'react';
import {
  cloudRowToDocument,
  deleteCloudProject,
  fetchCloudProjectMeta,
  fetchCloudProjectRow,
  listCloudProjectMeta,
  newerSyncCopy,
  pushDocumentToCloud,
  renameCloudProject,
  shouldAdoptRemoteDocument,
  type CloudProjectMeta,
  type CloudProjectRow,
} from './cloudProjects';
import {
  clearOutboxEntry,
  enqueueOutbox,
  getProjectDocument,
  listOutbox,
  listProjectDocuments,
  listTombstones,
  putProjectDocument,
  sealProjectDocument,
  type OutboxEntry,
} from './projectStore';
import { createDocumentId, wrapProject, type SceneDocument } from './sceneDocument';
import { documentToRecentEntry, loadRecentProjects, shouldAdoptCloudName } from './recentProjects';
import type { RecentProjectEntry } from './recentProjects';
import { ensureFreshSession } from './supabaseClient';

export type SyncConflict = {
  localId: string;
  localName: string;
  local: SceneDocument;
  remote: CloudProjectRow;
  remoteDocument: SceneDocument;
};

export type ConflictResolution = 'keep-local' | 'take-cloud' | 'duplicate';

export type FlushResult = {
  pushed: number;
  deleted: number;
  conflicts: SyncConflict[];
  errors: string[];
  /** Documents whose newer cloud copy was saved onto this device. */
  entries: RecentProjectEntry[];
  updatedIds: string[];
};

export type PullResult = {
  entries: RecentProjectEntry[];
  conflicts: SyncConflict[];
  deleted: CloudProjectRow[];
  applied: number;
  /** Document ids replaced with the account copy during this pull. */
  updatedIds: string[];
  errors: string[];
};

async function markSynced(doc: SceneDocument, revision: number): Promise<SceneDocument> {
  const live = await getProjectDocument(doc.id);
  // An autosave that landed while the upload was in flight must stay on disk.
  // Seal the base to the revision that actually reached the account.
  if (live && live.revision > revision && live.updatedAt >= doc.updatedAt) {
    return sealProjectDocument({
      ...live,
      baseRevision: revision,
    });
  }
  return sealProjectDocument({
    ...doc,
    revision,
    baseRevision: revision,
  });
}

async function clearProjectOutbox(projectId: string): Promise<void> {
  const rows = await listOutbox();
  for (const row of rows) {
    if (row.projectId === projectId) await clearOutboxEntry(row.id);
  }
}

/** Seal a successful upload, drop the queued copy, and keep a newer local edit queued. */
async function releaseSynced(doc: SceneDocument, revision: number): Promise<SceneDocument> {
  const sealed = await markSynced(doc, revision);
  await clearProjectOutbox(doc.id);
  if (sealed.revision > revision) {
    await enqueueOutbox({
      id: `outbox-${sealed.id}-${sealed.revision}`,
      projectId: sealed.id,
      op: 'upsert',
      updatedAt: sealed.updatedAt,
      payload: sealed,
    });
  }
  return sealed;
}

const emptyFlush = (errors: string[] = []): FlushResult => ({
  pushed: 0,
  deleted: 0,
  conflicts: [],
  errors,
  entries: [],
  updatedIds: [],
});

/**
 * Both sides moved. Keep the newer save and continue.
 * The account copy replaces this device only when it is clearly newer.
 */
async function settleDivergence(
  local: SceneDocument,
  remote: CloudProjectRow,
): Promise<{ pushed: boolean; entry: RecentProjectEntry | null; updatedId: string | null; error: string | null }> {
  const current = (await getProjectDocument(local.id)) ?? local;
  const remoteUpdated = Date.parse(remote.updated_at);
  const choice = newerSyncCopy(current.updatedAt, Number.isFinite(remoteUpdated) ? remoteUpdated : 0);
  if (choice === 'take-cloud') {
    const remoteDocument = await cloudRowToDocument(remote);
    const saved = await putProjectDocument(remoteDocument, {
      id: current.id,
      enqueueOutbox: false,
    });
    const sealed = await releaseSynced(saved, remoteDocument.revision);
    const appliedCloud = sealed.revision <= remoteDocument.revision;
    return {
      pushed: false,
      entry: documentToRecentEntry(sealed),
      updatedId: appliedCloud ? current.id : null,
      error: null,
    };
  }
  const result = await pushDocumentToCloud(current, { force: true });
  if (!result.ok) {
    return { pushed: false, entry: null, updatedId: null, error: result.error };
  }
  const sealed = await releaseSynced(current, result.revision);
  return {
    pushed: true,
    entry: documentToRecentEntry(sealed),
    updatedId: null,
    error: null,
  };
}

/** Flush IndexedDB outbox to Supabase. A diverged file keeps the newer save. */
export async function flushOutbox(): Promise<FlushResult> {
  const snap = await ensureFreshSession();
  if (!snap.user) {
    return emptyFlush(['Sign in to sync.']);
  }

  const queue = await listOutbox();
  // Collapse to latest upsert/delete per project. Renames stay beside them so a
  // label change does not replace a real scene push, and a scene push does not
  // drop the label if it lands first.
  const latest = new Map<string, OutboxEntry>();
  const renames = new Map<string, OutboxEntry>();
  const errors: string[] = [];
  for (const entry of queue) {
    if (entry.op === 'rename') {
      const prev = renames.get(entry.projectId);
      if (!prev || entry.updatedAt >= prev.updatedAt) renames.set(entry.projectId, entry);
      continue;
    }
    latest.set(entry.projectId, entry);
  }

  for (const [projectId, rename] of renames) {
    if (latest.has(projectId)) continue;
    const name = rename.name?.trim();
    if (!name) {
      await clearOutboxEntry(rename.id);
      continue;
    }
    const result = await renameCloudProject(projectId, name);
    if (result.ok) {
      for (const row of queue.filter((item) => item.projectId === projectId && item.op === 'rename')) {
        await clearOutboxEntry(row.id);
      }
      continue;
    }
    if (result.skipped) continue;
    errors.push(result.error);
  }

  let pushed = 0;
  let deleted = 0;
  const conflicts: SyncConflict[] = [];
  const entries: RecentProjectEntry[] = [];
  const updatedIds: string[] = [];

  for (const entry of latest.values()) {
    if (entry.op === 'delete') {
      const result = await deleteCloudProject(entry.projectId);
      if (!result.ok) {
        errors.push(result.error);
        continue;
      }
      deleted += 1;
      // Clear all outbox rows for this project.
      for (const row of queue.filter((item) => item.projectId === entry.projectId)) {
        await clearOutboxEntry(row.id);
      }
      continue;
    }

    const local = (entry.payload
      ? await getProjectDocument(entry.projectId).then((live) => live ?? entry.payload!)
      : await getProjectDocument(entry.projectId));
    if (!local) {
      await clearOutboxEntry(entry.id);
      continue;
    }

    const result = await pushDocumentToCloud(local);
    if (result.ok) {
      await releaseSynced(local, result.revision);
      pushed += 1;
      continue;
    }
    if (result.superseded) {
      // The account already has a newer revision. Drop the stale upload so the pull can apply it.
      await clearProjectOutbox(entry.projectId);
      continue;
    }
    if (result.skipped) continue;
    if (result.conflict) {
      const settled = await settleDivergence(local, result.conflict);
      if (settled.error) errors.push(settled.error);
      else {
        if (settled.pushed) pushed += 1;
        if (settled.entry) entries.push(settled.entry);
        if (settled.updatedId) updatedIds.push(settled.updatedId);
      }
      continue;
    }
    errors.push(result.error);
  }

  return { pushed, deleted, conflicts, errors, entries, updatedIds };
}

/**
 * Pull cloud projects and merge into the local store.
 * When both sides moved, the newer save wins and the open file can update.
 */
export async function pullAndReconcile(): Promise<PullResult> {
  const pull = await listCloudProjectMeta({ includeDeleted: true });
  if (!pull.ok) {
    return {
      entries: [],
      conflicts: [],
      deleted: [],
      applied: 0,
      updatedIds: [],
      errors: [pull.error],
    };
  }

  const conflicts: SyncConflict[] = [];
  const entries: RecentProjectEntry[] = [];
  const updatedIds: string[] = [];
  const errors: string[] = [];
  let applied = 0;
  const MAX_FULL_PULLS = 8;
  let fullPulls = 0;

  const adoptRemote = async (localId: string, fallback: SceneDocument | null) => {
    if (fullPulls >= MAX_FULL_PULLS) {
      if (fallback) entries.push(documentToRecentEntry(fallback));
      return;
    }
    const row = await fetchCloudProjectRow(localId);
    if (!row || row.deleted_at) {
      if (fallback) entries.push(documentToRecentEntry(fallback));
      return;
    }
    fullPulls += 1;
    const remoteDoc = await cloudRowToDocument(row);
    await putProjectDocument(remoteDoc, { id: remoteDoc.id, enqueueOutbox: false });
    entries.push(documentToRecentEntry(remoteDoc));
    updatedIds.push(remoteDoc.id);
    applied += 1;
  };

  for (const meta of pull.rows) {
    try {
      const local = await getProjectDocument(meta.local_id);
      const remoteRevision = typeof meta.revision === 'number' ? meta.revision : 0;

      if (!local) {
        // Cap heavy downloads so Sync now finishes; remaining rows land on later syncs.
        await adoptRemote(meta.local_id, null);
        continue;
      }

      const remoteUpdated = Date.parse(meta.updated_at) || 0;
      // Latest edit wins: a device, angle, or light saved on the other side
      // replaces this copy. An older account row never covers a newer local save.
      if (newerSyncCopy(local.updatedAt, remoteUpdated) === 'take-cloud') {
        await adoptRemote(meta.local_id, local);
        continue;
      }
      if (local.updatedAt > remoteUpdated) {
        entries.push(documentToRecentEntry(local));
        continue;
      }

      if (shouldAdoptRemoteDocument(
        { revision: local.revision, baseRevision: local.baseRevision },
        remoteRevision,
      )) {
        await adoptRemote(meta.local_id, local);
        continue;
      }

      const localDirty = local.revision > local.baseRevision;
      const remoteAdvanced = remoteRevision > local.baseRevision;

      if (localDirty && remoteAdvanced && remoteRevision !== local.revision) {
        if (fullPulls >= MAX_FULL_PULLS) {
          entries.push(documentToRecentEntry(local));
          continue;
        }
        const row = await fetchCloudProjectRow(meta.local_id);
        if (!row || row.deleted_at) {
          entries.push(documentToRecentEntry(local));
          continue;
        }
        fullPulls += 1;
        const settled = await settleDivergence(local, row);
        if (settled.error) errors.push(settled.error);
        entries.push(settled.entry ?? documentToRecentEntry(local));
        if (settled.updatedId) {
          updatedIds.push(settled.updatedId);
          applied += 1;
        }
        continue;
      }

      const adopted = shouldAdoptCloudName(
        local.scene.name,
        local.updatedAt,
        meta.name,
        Date.parse(meta.updated_at) || 0,
        localDirty,
      );
      if (adopted) {
        const renamed = await sealProjectDocument({
          ...local,
          updatedAt: Date.parse(meta.updated_at) || local.updatedAt,
          scene: { ...local.scene, name: adopted },
        });
        entries.push(documentToRecentEntry(renamed));
        applied += 1;
        continue;
      }

      // Local is same or ahead — keep local.
      entries.push(documentToRecentEntry(local));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Failed to merge a cloud project.');
    }
  }

  return {
    entries: entries.sort((a, b) => b.updatedAt - a.updatedAt),
    conflicts,
    deleted: pull.deleted as CloudProjectRow[],
    applied,
    updatedIds,
    errors,
  };
}

export async function resolveSyncConflict(
  conflict: SyncConflict,
  choice: ConflictResolution,
): Promise<{ ok: true; entry: RecentProjectEntry } | { ok: false; error: string }> {
  if (choice === 'keep-local') {
    const result = await pushDocumentToCloud(conflict.local, { force: true });
    if (!result.ok) return { ok: false, error: result.error };
    const sealed = await releaseSynced(conflict.local, result.revision);
    return { ok: true, entry: documentToRecentEntry(sealed) };
  }

  if (choice === 'take-cloud') {
    const saved = await putProjectDocument(conflict.remoteDocument, {
      id: conflict.localId,
      enqueueOutbox: false,
    });
    const sealed = await releaseSynced(saved, conflict.remoteDocument.revision);
    return { ok: true, entry: documentToRecentEntry(sealed) };
  }

  // duplicate — keep local as-is, store remote under a new id
  const copyId = createDocumentId();
  const copy = wrapProject(
    {
      ...conflict.remoteDocument.scene,
      name: `${conflict.remoteDocument.scene.name || 'Cloud'} (from cloud)`.slice(0, 100),
    },
    {
      id: copyId,
      revision: conflict.remoteDocument.revision,
      baseRevision: conflict.remoteDocument.revision,
      updatedAt: conflict.remoteDocument.updatedAt,
      assets: conflict.remoteDocument.assets,
    },
  );
  const savedCopy = await putProjectDocument(copy, { id: copyId, enqueueOutbox: false });
  // Force-push local to reclaim the shared local_id.
  const push = await pushDocumentToCloud(conflict.local, { force: true });
  if (!push.ok) return { ok: false, error: push.error };
  await releaseSynced(conflict.local, push.revision);
  // Also ensure the cloud duplicate exists under the new id.
  await pushDocumentToCloud(savedCopy, { force: true });
  return { ok: true, entry: documentToRecentEntry(conflict.local) };
}

/**
 * Upload local projects that never entered the outbox (created before sign-in,
 * or left behind when the recent list was truncated). Without this, web and the
 * desktop app keep divergent project lists forever.
 */
export async function pushUnsyncedLocalProjects(): Promise<FlushResult> {
  const snap = await ensureFreshSession();
  if (!snap.user) {
    return emptyFlush(['Sign in to sync.']);
  }

  const tombs = new Set(await listTombstones());
  const conflicts: SyncConflict[] = [];
  const errors: string[] = [];

  // Older projects often live only in the recent localStorage index (never IndexedDB).
  // Promote a few newest ones per sync so we never stall on a huge library.
  let promoted = 0;
  for (const entry of loadRecentProjects()) {
    if (promoted >= 8) break;
    if (!entry?.id || tombs.has(entry.id)) continue;
    const existing = await getProjectDocument(entry.id);
    if (existing) continue;
    try {
      await putProjectDocument(entry.project, { id: entry.id, enqueueOutbox: false });
      promoted += 1;
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : `Could not prepare “${entry.name || 'project'}” for sync.`,
      );
    }
  }

  const docs = (await listProjectDocuments())
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const queued = new Set(
    (await listOutbox())
      .filter((entry) => entry.op !== 'rename')
      .map((entry) => entry.projectId),
  );

  // Metadata only — downloading every project `state` is what made Sync now hang.
  const remoteList = await listCloudProjectMeta({ includeDeleted: true });
  const remoteById = new Map<string, CloudProjectMeta>();
  if (remoteList.ok) {
    for (const row of remoteList.rows) remoteById.set(row.local_id, row);
    for (const row of remoteList.deleted) remoteById.set(row.local_id, row);
  } else if (!remoteList.skipped) {
    errors.push(remoteList.error);
  }

  let pushed = 0;
  const entries: RecentProjectEntry[] = [];
  const updatedIds: string[] = [];
  const MAX_BACKFILL = 12;

  for (const doc of docs) {
    if (pushed >= MAX_BACKFILL) break;
    if (tombs.has(doc.id) || queued.has(doc.id)) continue;

    const remote = remoteById.get(doc.id) ?? null;
    const remoteRevision = typeof remote?.revision === 'number' ? remote.revision : 0;
    const needsPush = !remote
      || Boolean(remote.deleted_at)
      || doc.revision > doc.baseRevision
      || doc.revision > remoteRevision;

    if (!needsPush) continue;

    const result = await pushDocumentToCloud(doc);
    if (result.ok) {
      await releaseSynced(doc, result.revision);
      pushed += 1;
      continue;
    }
    if (result.superseded || result.skipped) continue;
    if (result.conflict) {
      const settled = await settleDivergence(doc, result.conflict);
      if (settled.error) errors.push(settled.error);
      else {
        if (settled.pushed) pushed += 1;
        if (settled.entry) entries.push(settled.entry);
        if (settled.updatedId) updatedIds.push(settled.updatedId);
      }
      continue;
    }
    errors.push(result.error);
  }

  return { pushed, deleted: 0, conflicts, errors, entries, updatedIds };
}

/**
 * Pull the files that are open right now.
 * A full library download is too heavy for the background timer, but the other
 * device still needs the latest camera, light, position, and screen.
 */
export async function pullOpenProjects(localIds: string[]): Promise<{
  entries: RecentProjectEntry[];
  updatedIds: string[];
  errors: string[];
}> {
  const entries: RecentProjectEntry[] = [];
  const updatedIds: string[] = [];
  const errors: string[] = [];
  const ids = [...new Set(localIds.map((id) => id.trim()).filter(Boolean))].slice(0, 8);
  for (const localId of ids) {
    try {
      const local = await getProjectDocument(localId);
      const meta = await fetchCloudProjectMeta(localId);
      if (!meta || meta.deleted_at) continue;
      const remoteRevision = typeof meta.revision === 'number' ? meta.revision : 0;
      const remoteUpdated = Date.parse(meta.updated_at) || 0;
      const localUpdated = local?.updatedAt ?? 0;
      if (local && newerSyncCopy(localUpdated, remoteUpdated) === 'take-cloud') {
        const row = await fetchCloudProjectRow(localId);
        if (!row || row.deleted_at) continue;
        const remoteDoc = await cloudRowToDocument(row);
        await putProjectDocument(remoteDoc, { id: remoteDoc.id, enqueueOutbox: false });
        entries.push(documentToRecentEntry(remoteDoc));
        updatedIds.push(remoteDoc.id);
        continue;
      }
      if (local && localUpdated > remoteUpdated) continue;
      const diverged = Boolean(
        local
        && local.revision > local.baseRevision
        && remoteRevision > local.baseRevision
        && remoteRevision !== local.revision,
      );
      if (!shouldAdoptRemoteDocument(
        local ? { revision: local.revision, baseRevision: local.baseRevision } : null,
        remoteRevision,
      )) {
        if (!diverged || !local) continue;
        const row = await fetchCloudProjectRow(localId);
        if (!row || row.deleted_at) continue;
        const settled = await settleDivergence(local, row);
        if (settled.error) errors.push(settled.error);
        if (settled.entry) entries.push(settled.entry);
        if (settled.updatedId) updatedIds.push(settled.updatedId);
        continue;
      }
      const row = await fetchCloudProjectRow(localId);
      if (!row || row.deleted_at) continue;
      const remoteDoc = await cloudRowToDocument(row);
      await putProjectDocument(remoteDoc, { id: remoteDoc.id, enqueueOutbox: false });
      entries.push(documentToRecentEntry(remoteDoc));
      updatedIds.push(remoteDoc.id);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Could not update an open project.');
    }
  }
  return { entries, updatedIds, errors };
}

/** Push queued edits for the open files. Does not download the library. */
export async function pushPendingChanges(): Promise<FlushResult> {
  return flushOutbox();
}

/** Full sync: backfill newest locals first, flush outbox, then a light pull. */
export async function syncNow(): Promise<{
  flush: FlushResult;
  pull: PullResult;
}> {
  // Push first so a brand-new file is in the cloud even if pull is slow.
  const backfill = await pushUnsyncedLocalProjects();
  const flush = await flushOutbox();
  const pull = await pullAndReconcile();
  return {
    flush: {
      pushed: flush.pushed + backfill.pushed,
      deleted: flush.deleted + backfill.deleted,
      conflicts: [...flush.conflicts, ...backfill.conflicts],
      errors: [...flush.errors.filter((error) => error !== 'Sign in to sync.'), ...backfill.errors]
        .filter((error, index, all) => all.indexOf(error) === index),
      entries: [...backfill.entries, ...flush.entries],
      updatedIds: [...new Set([...backfill.updatedIds, ...flush.updatedIds])],
    },
    pull,
  };
}

const LAST_SYNCED_KEY = 'mokstudio-last-synced-at';
const lastSyncedListeners = new Set<(at: number | null) => void>();

export function readLastSyncedAt(): number | null {
  try {
    const value = Number(localStorage.getItem(LAST_SYNCED_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Remember a finished account sync so the status button can show when it happened. */
export function noteLastSynced(at = Date.now()): number {
  try {
    localStorage.setItem(LAST_SYNCED_KEY, String(at));
  } catch {
    /* private mode */
  }
  for (const listener of lastSyncedListeners) listener(at);
  return at;
}

export function useLastSyncedAt(): number | null {
  const [at, setAt] = useState<number | null>(() => readLastSyncedAt());
  const [, setClock] = useState(0);
  useEffect(() => {
    const notify = (next: number | null) => setAt(next);
    lastSyncedListeners.add(notify);
    setAt(readLastSyncedAt());
    const clock = window.setInterval(() => setClock((tick) => tick + 1), 30_000);
    return () => {
      lastSyncedListeners.delete(notify);
      window.clearInterval(clock);
    };
  }, []);
  return at;
}

export function formatSyncedClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function lastSyncedStatus(signedIn: boolean, at: number | null): string {
  if (!signedIn) return 'Sync';
  if (!at) return 'Synced';
  return `Synced · ${formatSyncedClock(at)}`;
}

export async function peekRemoteRevision(localId: string): Promise<number | null> {
  const row = await fetchCloudProjectRow(localId);
  if (!row || row.deleted_at) return null;
  return typeof row.revision === 'number' ? row.revision : 1;
}
