import { placeholderForDevice } from './demo';
import { libraryDelete, libraryGet, libraryPut } from './libraryDb';
import { validateProject } from './project';
import type { MockupProject } from '../types';

const STORAGE_KEY = 'mockup-studio.recent-projects.v1';
const MAX_RECENT = 12;

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
  // Keep enough to reopen; drop oversized reflection map images if needed later.
  return {
    ...project,
    reflectionMapImage: project.reflectionMapImage && project.reflectionMapImage.length > 400_000
      ? null
      : project.reflectionMapImage,
  };
}

function entryFromProject(project: MockupProject, existingId?: string): RecentProjectEntry {
  const slim = slimProject(project);
  const preview = typeof slim.screenshot === 'string' && slim.screenshot.startsWith('data:image/')
    ? slim.screenshot
    : null;
  return {
    id: existingId ?? `recent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: slim.name?.trim() || 'Untitled composition',
    updatedAt: Date.now(),
    deviceId: slim.deviceId || slim.devices?.[0]?.deviceId || 'iphone-17-pro',
    deviceCount: Math.max(1, slim.devices?.length ?? 1),
    preview,
    project: slim,
  };
}

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
            id: typeof row.id === 'string' ? row.id : entryFromProject(project).id,
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

const PROJECT_IDS_KEY = 'recent-project-ids';

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

async function mirrorProjects(entries: RecentProjectEntry[]) {
  const slice = entries.slice(0, MAX_RECENT);
  const previous = await libraryGet<string[]>('meta', PROJECT_IDS_KEY);
  const previousIds = Array.isArray(previous) ? previous.filter((id) => typeof id === 'string') : [];
  const nextIds = slice.map((entry) => entry.id);
  for (const id of previousIds) {
    if (!nextIds.includes(id)) await libraryDelete('projects', id);
  }
  for (const entry of slice) await libraryPut('projects', entry.id, entry);
  await libraryPut('meta', PROJECT_IDS_KEY, nextIds);
}

function writeRecent(entries: RecentProjectEntry[]) {
  const slice = entries.slice(0, MAX_RECENT);
  void mirrorProjects(slice).catch(() => undefined);
  const payload = JSON.stringify(slice);
  try {
    localStorage.setItem(STORAGE_KEY, payload);
  } catch {
    // Quota exceeded — keep a light index. The full project, including screenshots, stays in IndexedDB.
    const stripped = slice.map((entry) => ({
      ...entry,
      preview: null,
      project: {
        ...entry.project,
        screenshot: placeholderForDevice(entry.project.deviceId),
        reflectionMapImage: null,
        devices: entry.project.devices.map((device) => ({
          ...device,
          screenshot: placeholderForDevice(device.deviceId),
        })),
      },
    }));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped));
    } catch {
      /* give up quietly */
    }
  }
}

function richerProject(local: MockupProject, stored: MockupProject) {
  return projectWeight(stored) > projectWeight(local) ? stored : local;
}

/** Replace localStorage copies that lost their images with the IndexedDB originals. */
export async function hydrateRecentProjects(current = loadRecentProjects()): Promise<RecentProjectEntry[]> {
  const storedIds = await libraryGet<string[]>('meta', PROJECT_IDS_KEY);
  const ids = new Set<string>([
    ...current.map((entry) => entry.id),
    ...(Array.isArray(storedIds) ? storedIds.filter((id) => typeof id === 'string') : []),
  ]);
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  const next: RecentProjectEntry[] = [];
  for (const id of ids) {
    const local = byId.get(id) ?? null;
    let stored: RecentProjectEntry | null = null;
    try {
      const raw = await libraryGet<RecentProjectEntry>('projects', id);
      if (raw?.project) {
        const project = validateProject(raw.project);
        stored = {
          id,
          name: typeof raw.name === 'string' ? raw.name : project.name,
          updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : local?.updatedAt ?? Date.now(),
          deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : project.deviceId,
          deviceCount: typeof raw.deviceCount === 'number' ? raw.deviceCount : project.devices.length,
          preview: typeof raw.preview === 'string' ? raw.preview : local?.preview ?? null,
          project,
        };
      }
    } catch {
      stored = null;
    }
    if (stored && local) {
      next.push({ ...stored, project: richerProject(local.project, stored.project), updatedAt: Math.max(local.updatedAt, stored.updatedAt) });
    } else if (stored) next.push(stored);
    else if (local) next.push(local);
  }
  return next.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_RECENT);
}

/** Upsert a project into the recent list (by name match, else prepend). */
export function rememberRecentProject(project: MockupProject): RecentProjectEntry[] {
  const current = loadRecentProjects();
  const nameKey = (project.name || '').trim().toLowerCase();
  const existingIndex = current.findIndex((entry) => entry.name.trim().toLowerCase() === nameKey);
  const nextEntry = entryFromProject(project, existingIndex >= 0 ? current[existingIndex].id : undefined);
  const without = existingIndex >= 0
    ? current.filter((_, index) => index !== existingIndex)
    : current;
  const next = [nextEntry, ...without].slice(0, MAX_RECENT);
  writeRecent(next);
  return next;
}

export function removeRecentProject(id: string): RecentProjectEntry[] {
  const next = loadRecentProjects().filter((entry) => entry.id !== id);
  writeRecent(next);
  return next;
}

/** Merge cloud rows into local recents, keeping the newer copy per local_id. */
export function mergeRecentFromCloud(cloudEntries: RecentProjectEntry[]): RecentProjectEntry[] {
  const byId = new Map(loadRecentProjects().map((entry) => [entry.id, entry]));
  for (const remote of cloudEntries) {
    const existing = byId.get(remote.id);
    if (!existing || remote.updatedAt >= existing.updatedAt) byId.set(remote.id, remote);
  }
  const next = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_RECENT);
  writeRecent(next);
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
