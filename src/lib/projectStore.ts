/**
 * Local-first durable project store (IndexedDB).
 * Scene documents are saved with externalised media blobs; hydrate on read for the editor.
 */

import { canonicalProjectJson } from './cloudLibrary';
import { libraryDelete, libraryGet, libraryGetAll, libraryKeys, libraryPut } from './libraryDb';
import {
  bumpDocument,
  createDocumentId,
  externalizeSceneAssets,
  hydrateSceneAssets,
  isSceneDocument,
  migrateDocument,
  wrapProject,
  type SceneDocument,
} from './sceneDocument';
import { validateProject } from './project';
import type { MockupProject } from '../types';

const PROJECT_INDEX_KEY = 'project-document-ids';
const RECENT_IDS_KEY = 'recent-project-ids';
const TOMBSTONES_KEY = 'project-tombstones';
const MIGRATION_FLAG = 'project-store-migrated-v1';

export type OutboxOp = 'upsert' | 'delete' | 'rename';

export interface OutboxEntry {
  id: string;
  projectId: string;
  op: OutboxOp;
  updatedAt: number;
  /** Rename ops carry only the new label — never a scene blob. */
  name?: string;
  payload?: SceneDocument;
}

export interface StoredAssetBlob {
  mime: string;
  bytes: ArrayBuffer;
}

/** Legacy recent-entry shape previously stored in the projects object store. */
interface LegacyRecentRow {
  id: string;
  updatedAt?: number;
  project: unknown;
}

async function readIndex(): Promise<string[]> {
  const ids = await libraryGet<string[]>('meta', PROJECT_INDEX_KEY);
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id.length > 0) : [];
}

async function writeIndex(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
  await libraryPut('meta', PROJECT_INDEX_KEY, unique);
}

export async function putAssetBlob(hash: string, mime: string, bytes: Uint8Array): Promise<void> {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  await libraryPut('assets', hash, { mime, bytes: copy } satisfies StoredAssetBlob);
}

export async function getAssetBlob(hash: string): Promise<StoredAssetBlob | null> {
  const raw = await libraryGet<StoredAssetBlob>('assets', hash);
  if (!raw || typeof raw !== 'object' || !(raw.bytes instanceof ArrayBuffer)) return null;
  return raw;
}

async function resolveAsset(hash: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const blob = await getAssetBlob(hash);
  if (!blob) return null;
  return { mime: blob.mime, bytes: new Uint8Array(blob.bytes) };
}

async function hydrateDocument(doc: SceneDocument): Promise<SceneDocument> {
  const scene = await hydrateSceneAssets(doc.scene, resolveAsset);
  return { ...doc, scene: validateProject(scene) };
}

function looksLikeLegacyRecent(raw: unknown): raw is LegacyRecentRow {
  if (!raw || typeof raw !== 'object') return false;
  if (isSceneDocument(raw)) return false;
  const row = raw as Partial<LegacyRecentRow>;
  return !!row.project && typeof row.id === 'string';
}

/** Load a durable document and hydrate asset refs for editing. */
export async function getProjectDocument(id: string): Promise<SceneDocument | null> {
  const raw = await libraryGet<unknown>('projects', id);
  if (!raw) return null;
  try {
    if (looksLikeLegacyRecent(raw)) {
      const doc = wrapProject(validateProject(raw.project), {
        id: raw.id,
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
      });
      return hydrateDocument(doc);
    }
    return hydrateDocument(migrateDocument(raw));
  } catch {
    return null;
  }
}

/** Persist a document: externalise media, store blobs, write slim scene JSON. */
export async function putProjectDocument(
  input: SceneDocument | MockupProject,
  options?: { id?: string; previous?: SceneDocument | null; enqueueOutbox?: boolean },
): Promise<SceneDocument> {
  const previous = options?.previous
    ?? (options?.id ? await getRawProjectDocument(options.id) : null);
  const base = isSceneDocument(input)
    ? migrateDocument(input)
    : wrapProject(validateProject(input), {
      id: options?.id ?? previous?.id ?? createDocumentId(),
      revision: previous?.revision,
      baseRevision: previous?.baseRevision,
      updatedAt: previous?.updatedAt,
      assets: previous?.assets,
    });

  const id = options?.id ?? base.id;
  const withId = base.id === id ? base : { ...base, id };

  // A cloud document is already versioned. Store it as given so a pull does not
  // look like a new local edit and get pushed back over the desktop save.
  const authoritative = isSceneDocument(input) && options?.enqueueOutbox === false;

  // Cheap no-op for already-slim SceneDocument writes (cloud pull / seal).
  // MockupProject inputs are hydrated (data URLs) and must externalize first.
  if (previous && !authoritative && isSceneDocument(input)) {
    const incomingScene = migrateDocument(input).scene;
    if (canonicalProjectJson(previous.scene) === canonicalProjectJson(incomingScene)) {
      return hydrateDocument({ ...previous, id });
    }
  }

  // Hydrate first so we never double-externalise existing asset refs into empty blobs.
  const hydrated = await hydrateDocument(withId);
  const { scene, assets, blobs } = await externalizeSceneAssets(hydrated.scene);
  for (const [hash, blob] of blobs) {
    await putAssetBlob(hash, blob.mime, blob.bytes);
  }

  // Reopening a tab rewrites the same scene. Bumping that rewrite makes this
  // browser look newer than the desktop save and uploads the old file over it.
  if (
    previous
    && !authoritative
    && canonicalProjectJson(previous.scene) === canonicalProjectJson(scene)
  ) {
    return hydrateDocument({ ...previous, id });
  }

  const next = authoritative
    ? {
      ...withId,
      id,
      scene,
      assets,
      deviceRefs: withId.deviceRefs,
    }
    : previous
    ? bumpDocument({ ...previous, id }, scene, assets)
    : {
      ...wrapProject(scene, {
        id,
        revision: withId.revision,
        baseRevision: withId.baseRevision,
        updatedAt: Date.now(),
        assets,
      }),
      scene,
      assets,
      deviceRefs: withId.deviceRefs,
    };

  // Keep deviceRefs in sync after externalise (scene may have been revalidated).
  const stored: SceneDocument = {
    ...next,
    id,
    scene,
    assets,
    deviceRefs: next.deviceRefs,
  };

  await libraryPut('projects', id, stored);
  const index = await readIndex();
  if (!index.includes(id)) await writeIndex([id, ...index]);

  // Clear tombstone if re-saving.
  const tombs = await listTombstones();
  if (tombs.includes(id)) {
    await libraryPut('meta', TOMBSTONES_KEY, tombs.filter((item) => item !== id));
  }

  if (options?.enqueueOutbox !== false) {
    await enqueueOutbox({
      id: `outbox-${id}-${stored.revision}`,
      projectId: id,
      op: 'upsert',
      updatedAt: stored.updatedAt,
      payload: stored,
    });
  }

  return hydrateDocument(stored);
}

async function getRawProjectDocument(id: string): Promise<SceneDocument | null> {
  const raw = await libraryGet<unknown>('projects', id);
  if (!raw) return null;
  try {
    if (looksLikeLegacyRecent(raw)) {
      return wrapProject(validateProject(raw.project), {
        id: raw.id,
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
      });
    }
    return migrateDocument(raw);
  } catch {
    return null;
  }
}

export async function listProjectDocuments(): Promise<SceneDocument[]> {
  await ensureLegacyMigration();
  const index = await readIndex();
  const keys = index.length ? index : await libraryKeys('projects');
  const docs: SceneDocument[] = [];
  for (const id of keys) {
    if (id === RECENT_IDS_KEY) continue;
    const doc = await getProjectDocument(id);
    if (doc) docs.push(doc);
  }
  return docs.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProjectDocument(id: string, options?: { enqueueOutbox?: boolean }): Promise<void> {
  await libraryDelete('projects', id);
  const index = await readIndex();
  await writeIndex(index.filter((item) => item !== id));
  const tombs = await listTombstones();
  if (!tombs.includes(id)) {
    await libraryPut('meta', TOMBSTONES_KEY, [id, ...tombs].slice(0, 200));
  }
  if (options?.enqueueOutbox !== false) {
    await enqueueOutbox({
      id: `outbox-del-${id}-${Date.now()}`,
      projectId: id,
      op: 'delete',
      updatedAt: Date.now(),
    });
  }
}

export async function listTombstones(): Promise<string[]> {
  const raw = await libraryGet<string[]>('meta', TOMBSTONES_KEY);
  return Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : [];
}

export async function enqueueOutbox(entry: OutboxEntry): Promise<void> {
  await libraryPut('outbox', entry.id, entry);
}

/** Queue a metadata rename. The payload is the label only, not the scene. */
export async function enqueueProjectRename(projectId: string, name: string): Promise<void> {
  const nextName = name.trim();
  if (!projectId || !nextName) return;
  await enqueueOutbox({
    id: `outbox-rename-${projectId}-${Date.now()}`,
    projectId,
    op: 'rename',
    name: nextName,
    updatedAt: Date.now(),
  });
}

export async function clearProjectRenames(projectId: string): Promise<void> {
  const rows = await listOutbox();
  for (const row of rows) {
    if (row.projectId === projectId && row.op === 'rename') {
      await clearOutboxEntry(row.id);
    }
  }
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  const rows = await libraryGetAll<OutboxEntry>('outbox');
  return rows
    .map((row) => row.value)
    .filter((entry): entry is OutboxEntry => (
      !!entry
      && typeof entry === 'object'
      && typeof entry.id === 'string'
      && typeof entry.projectId === 'string'
      && (
        entry.op === 'upsert'
        || entry.op === 'delete'
        || (entry.op === 'rename' && typeof entry.name === 'string' && entry.name.trim().length > 0)
      )
    ))
    .sort((a, b) => a.updatedAt - b.updatedAt);
}

export async function clearOutboxEntry(id: string): Promise<void> {
  await libraryDelete('outbox', id);
}

/**
 * Persist a document tip without bumping revision or enqueueing the outbox.
 * Used after a successful cloud push to seal `baseRevision`.
 */
export async function sealProjectDocument(doc: SceneDocument): Promise<SceneDocument> {
  const scene = validateProject(doc.scene);
  const sealed: SceneDocument = {
    schemaVersion: doc.schemaVersion,
    id: doc.id,
    revision: Math.max(1, doc.revision),
    baseRevision: Math.max(0, doc.baseRevision),
    updatedAt: doc.updatedAt,
    deviceRefs: doc.deviceRefs,
    assets: doc.assets,
    scene,
  };
  await libraryPut('projects', sealed.id, sealed);
  const index = await readIndex();
  if (!index.includes(sealed.id)) await writeIndex([sealed.id, ...index]);
  return hydrateDocument(sealed);
}

/**
 * One-time: lift legacy recent-entry mirrors into durable SceneDocuments
 * without deleting them from the recent index.
 */
export async function ensureLegacyMigration(): Promise<void> {
  const done = await libraryGet<boolean>('meta', MIGRATION_FLAG);
  if (done) return;

  const recentIds = await libraryGet<string[]>('meta', RECENT_IDS_KEY);
  const ids = Array.isArray(recentIds) ? recentIds.filter((id) => typeof id === 'string') : [];
  const index = await readIndex();
  const nextIndex = [...index];

  for (const id of ids) {
    const raw = await libraryGet<unknown>('projects', id);
    if (!raw) continue;
    try {
      if (isSceneDocument(raw)) {
        if (!nextIndex.includes(id)) nextIndex.push(id);
        continue;
      }
      if (looksLikeLegacyRecent(raw)) {
        const doc = wrapProject(validateProject(raw.project), {
          id: raw.id,
          updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
        });
        const { scene, assets, blobs } = await externalizeSceneAssets(doc.scene);
        for (const [hash, blob] of blobs) {
          await putAssetBlob(hash, blob.mime, blob.bytes);
        }
        const stored: SceneDocument = { ...doc, scene, assets };
        await libraryPut('projects', id, stored);
        if (!nextIndex.includes(id)) nextIndex.push(id);
      }
    } catch {
      /* skip corrupt legacy rows */
    }
  }

  await writeIndex(nextIndex);
  await libraryPut('meta', MIGRATION_FLAG, true);
}

/** Touch the recent-ids ranking without deleting durable documents. */
export async function setRecentProjectIds(ids: string[]): Promise<void> {
  await libraryPut('meta', RECENT_IDS_KEY, ids.slice(0, 48));
}

export async function getRecentProjectIds(): Promise<string[]> {
  const ids = await libraryGet<string[]>('meta', RECENT_IDS_KEY);
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
}
