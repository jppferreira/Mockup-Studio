import { placeholderForDevice } from './demo';
import { libraryGet } from './libraryDb';
import { validateProject } from './project';
import {
  deleteProjectDocument,
  ensureLegacyMigration,
  getProjectDocument,
  getRecentProjectIds,
  listProjectDocuments,
  putProjectDocument,
  sealProjectDocument,
  setRecentProjectIds,
} from './projectStore';
import { createDocumentId, type SceneDocument } from './sceneDocument';
import type { MockupProject } from '../types';

const STORAGE_KEY = 'mockup-studio.recent-projects.v1';
/** Keep in sync with cloud pull limit so web and desktop share the same library. */
export const MAX_RECENT = 80;
/** Matches `validateProject`, which stores `name.slice(0, 100)`. */
export const PROJECT_NAME_MAX = 100;

/** Trim, cap, and reject blank project names. */
export function normalizeProjectName(name: string): string | null {
  const trimmed = name.trim().slice(0, PROJECT_NAME_MAX);
  return trimmed ? trimmed : null;
}

/**
 * Cloud metadata name should replace the local label when the account row is
 * newer and this device has no unpushed scene edits.
 */
export function shouldAdoptCloudName(
  localName: string,
  localUpdatedAt: number,
  remoteName: string,
  remoteUpdatedAt: number,
  localDirty: boolean,
): string | null {
  if (localDirty) return null;
  const next = normalizeProjectName(remoteName);
  if (!next) return null;
  if (next === localName.trim()) return null;
  if (remoteUpdatedAt < localUpdatedAt) return null;
  return next;
}

export interface RecentProjectEntry {
  id: string;
  name: string;
  updatedAt: number;
  deviceId: string;
  deviceCount: number;
  /** Lightweight preview — may be null if storage was tight */
  preview: string | null;
  project: MockupProject;
}

function slimProject(project: MockupProject): MockupProject {
  return {
    ...project,
    reflectionMapImage: project.reflectionMapImage && project.reflectionMapImage.length > 400_000
      ? null
      : project.reflectionMapImage,
  };
}

function previewFromProject(project: MockupProject): string | null {
  const slim = slimProject(project);
  if (typeof slim.screenshot === 'string' && slim.screenshot.startsWith('data:image/')) {
    return slim.screenshot.length > 180_000 ? null : slim.screenshot;
  }
  const deviceShot = slim.devices?.[0]?.screenshot;
  if (typeof deviceShot === 'string' && deviceShot.startsWith('data:image/')) {
    return deviceShot.length > 180_000 ? null : deviceShot;
  }
  return null;
}

export function documentToRecentEntry(doc: SceneDocument, preview?: string | null): RecentProjectEntry {
  const project = slimProject(doc.scene);
  return {
    id: doc.id,
    name: project.name?.trim() || 'Untitled composition',
    updatedAt: doc.updatedAt,
    deviceId: project.deviceId || project.devices?.[0]?.deviceId || 'iphone-17-pro',
    deviceCount: Math.max(1, project.devices?.length ?? 1),
    preview: preview ?? previewFromProject(project),
    project,
  };
}

function entryFromProject(project: MockupProject, existingId?: string): RecentProjectEntry {
  const slim = slimProject(project);
  return {
    id: existingId && existingId.trim() ? existingId.trim() : createDocumentId(),
    name: slim.name?.trim() || 'Untitled composition',
    updatedAt: Date.now(),
    deviceId: slim.deviceId || slim.devices?.[0]?.deviceId || 'iphone-17-pro',
    deviceCount: Math.max(1, slim.devices?.length ?? 1),
    preview: previewFromProject(slim),
    project: slim,
  };
}

function lightIndex(entries: RecentProjectEntry[]) {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    updatedAt: entry.updatedAt,
    deviceId: entry.deviceId,
    deviceCount: entry.deviceCount,
    preview: null as string | null,
    // Keep a tiny stub so synchronous loaders still have a reopenable shape.
    project: {
      ...entry.project,
      screenshot: placeholderForDevice(entry.project.deviceId),
      reflectionMapImage: null,
      soundtrackData: null,
      devices: entry.project.devices.map((device) => ({
        ...device,
        screenshot: placeholderForDevice(device.deviceId),
        screenLayers: undefined,
      })),
    } satisfies MockupProject,
  }));
}

function writeRecentIndex(entries: RecentProjectEntry[]) {
  const slice = entries.slice(0, MAX_RECENT);
  void setRecentProjectIds(slice.map((entry) => entry.id)).catch(() => undefined);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slice));
  } catch {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lightIndex(slice)));
    } catch {
      /* give up quietly */
    }
  }
}

/** Synchronous recent list from localStorage (may be stubby until hydrate). */
export function loadRecentProjects(): RecentProjectEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        try {
          const row = item as Partial<RecentProjectEntry>;
          if (!row || typeof row !== 'object' || !row.project) return null;
          const project = validateProject(row.project);
          return {
            id: typeof row.id === 'string' && row.id ? row.id : entryFromProject(project).id,
            name: typeof row.name === 'string' ? row.name : project.name,
            updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : Date.now(),
            deviceId: typeof row.deviceId === 'string' ? row.deviceId : project.deviceId,
            deviceCount: typeof row.deviceCount === 'number' ? row.deviceCount : project.devices.length,
            preview: typeof row.preview === 'string' ? row.preview : null,
            project,
          } satisfies RecentProjectEntry;
        } catch {
          return null;
        }
      })
      .filter((item): item is RecentProjectEntry => item != null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function projectWeight(project: MockupProject) {
  let weight = 0;
  const add = (value: string | null | undefined) => {
    if (typeof value === 'string') weight += value.length;
  };
  add(project.screenshot);
  add(project.reflectionMapImage);
  for (const device of project.devices ?? []) add(device.screenshot);
  return weight;
}

/** Merge IndexedDB durable docs + localStorage index into a rich recent list. */
export async function hydrateRecentProjects(current = loadRecentProjects()): Promise<RecentProjectEntry[]> {
  await ensureLegacyMigration().catch(() => undefined);
  const storedIds = await getRecentProjectIds();
  const idOrder = [
    ...current.map((entry) => entry.id),
    ...(Array.isArray(storedIds) ? storedIds : []),
  ];
  const uniqueIds = [...new Set(idOrder)];
  const byId = new Map(current.map((entry) => [entry.id, entry]));

  for (const id of uniqueIds) {
    const doc = await getProjectDocument(id);
    if (!doc) continue;
    const fromDoc = documentToRecentEntry(doc);
    const local = byId.get(id);
    if (local) {
      const richer = projectWeight(local.project) > projectWeight(fromDoc.project)
        ? local.project
        : fromDoc.project;
      byId.set(id, {
        ...fromDoc,
        project: richer,
        preview: fromDoc.preview ?? local.preview,
        updatedAt: Math.max(local.updatedAt, fromDoc.updatedAt),
      });
    } else {
      byId.set(id, fromDoc);
    }
  }

  // Also surface durable projects that never hit the recent index yet.
  if (byId.size < MAX_RECENT) {
    const all = await listProjectDocuments().catch(() => [] as SceneDocument[]);
    for (const doc of all) {
      if (byId.has(doc.id)) continue;
      byId.set(doc.id, documentToRecentEntry(doc));
      if (byId.size >= MAX_RECENT * 2) break;
    }
  }

  // Persist localStorage-only projects into IndexedDB so cloud sync can find them.
  for (const entry of byId.values()) {
    const existing = await getProjectDocument(entry.id).catch(() => null);
    if (existing) continue;
    void putProjectDocument(entry.project, { id: entry.id, enqueueOutbox: true }).catch(() => undefined);
  }

  const next = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_RECENT);
  writeRecentIndex(next);
  return next;
}

export type RememberRecentOptions = {
  /** Stable scene-document id — preferred over name matching. */
  id?: string;
  /** Persist into durable project store (default true). */
  persist?: boolean;
};

/**
 * Upsert a project into the recent list by stable document id.
 * Falls back to creating a new id when none is provided.
 */
export function rememberRecentProject(
  project: MockupProject,
  options?: RememberRecentOptions,
): RecentProjectEntry[] {
  const current = loadRecentProjects();
  const id = options?.id?.trim() || undefined;
  const existingIndex = id
    ? current.findIndex((entry) => entry.id === id)
    : -1;
  const nextEntry = entryFromProject(project, existingIndex >= 0 ? current[existingIndex].id : id);
  const without = existingIndex >= 0
    ? current.filter((_, index) => index !== existingIndex)
    : current.filter((entry) => entry.id !== nextEntry.id);
  const next = [nextEntry, ...without].slice(0, MAX_RECENT);
  writeRecentIndex(next);

  if (options?.persist !== false) {
    void putProjectDocument(project, { id: nextEntry.id, enqueueOutbox: true }).catch(() => undefined);
  }
  return next;
}

/** Write a new name onto the durable document without bumping revision or the outbox. */
export async function sealProjectName(id: string, name: string): Promise<void> {
  const nextName = normalizeProjectName(name);
  if (!id || !nextName) return;
  const doc = await getProjectDocument(id);
  if (!doc || doc.scene.name === nextName) return;
  await sealProjectDocument({
    ...doc,
    updatedAt: Date.now() + 1,
    scene: { ...doc.scene, name: nextName },
  });
}

/**
 * Rename a recent-list entry and the stored scene name.
 * Does not enqueue a full scene upload — callers push the account name separately.
 * Returns null when the name is empty.
 */
export function renameRecentProject(id: string, name: string): RecentProjectEntry[] | null {
  const nextName = normalizeProjectName(name);
  if (!id || !nextName) return null;
  const current = loadRecentProjects();
  const index = current.findIndex((entry) => entry.id === id);
  if (index < 0) {
    void sealProjectName(id, nextName);
    return current;
  }
  const existing = current[index];
  if (existing.name === nextName && existing.project.name === nextName) return current;
  const nextEntry: RecentProjectEntry = {
    ...existing,
    name: nextName,
    updatedAt: Date.now(),
    project: { ...existing.project, name: nextName },
  };
  const next = [nextEntry, ...current.filter((entry) => entry.id !== id)].slice(0, MAX_RECENT);
  writeRecentIndex(next);
  void sealProjectName(id, nextName);
  return next;
}

export function removeRecentProject(
  id: string,
  options?: { enqueueOutbox?: boolean },
): RecentProjectEntry[] {
  const next = loadRecentProjects().filter((entry) => entry.id !== id);
  writeRecentIndex(next);
  void deleteProjectDocument(id, { enqueueOutbox: options?.enqueueOutbox }).catch(() => undefined);
  return next;
}

/** Drop several projects locally (e.g. after cloud soft-deletes). Does not re-enqueue deletes. */
export function removeRecentProjects(ids: string[]): RecentProjectEntry[] {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return loadRecentProjects();
  let next = loadRecentProjects();
  for (const id of unique) {
    next = removeRecentProject(id, { enqueueOutbox: false });
  }
  return next;
}

/**
 * Merge cloud rows into the recent index by document id.
 * Durable docs are expected to already be written by pull/push — this only updates
 * the visible recent list so we do not bump revisions and re-dirty synced projects.
 */
export function mergeRecentFromCloud(cloudEntries: RecentProjectEntry[]): RecentProjectEntry[] {
  const byId = new Map(loadRecentProjects().map((entry) => [entry.id, entry]));
  for (const remote of cloudEntries) {
    const existing = byId.get(remote.id);
    if (!existing || remote.updatedAt >= existing.updatedAt) {
      byId.set(remote.id, remote);
    }
  }
  const next = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_RECENT);
  writeRecentIndex(next);
  return next;
}

export function formatRecentTime(timestamp: number) {
  const delta = Date.now() - timestamp;
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

/** Dev/test helper — peek stored recent id ranking. */
export async function peekRecentIdsFromDb() {
  return libraryGet<string[]>('meta', 'recent-project-ids');
}
