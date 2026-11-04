import { placeholderForDevice } from './demo';
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

function writeRecent(entries: RecentProjectEntry[]) {
  const payload = JSON.stringify(entries.slice(0, MAX_RECENT));
  try {
    localStorage.setItem(STORAGE_KEY, payload);
  } catch {
    // Quota exceeded — drop previews and retry.
    const stripped = entries.map((entry) => ({
      ...entry,
      preview: null,
      project: {
        ...entry.project,
        screenshot: placeholderForDevice(entry.project.deviceId),
        reflectionMapImage: null,
      },
    }));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped.slice(0, MAX_RECENT)));
    } catch {
      /* give up quietly */
    }
  }
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
