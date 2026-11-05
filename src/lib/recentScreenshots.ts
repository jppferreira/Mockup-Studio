import { libraryDelete, libraryGet, libraryPut } from './libraryDb';

const STORAGE_KEY = 'mockup-studio.recent-screenshots.v1';
export const MAX_RECENT_SCREENSHOTS = 4;
/** localStorage cannot hold phone screenshots. Bytes go to IndexedDB; this is only a fallback. */
const MAX_INLINE_BYTES = 2_500_000;

export type RecentScreenshotPlatform = 'ios' | 'android';

export interface RecentScreenshot {
  id: string;
  addedAt: number;
  name: string;
  dataUrl: string;
  /** Platform env this shot was captured for — used to filter Recent by publish target. */
  platform?: RecentScreenshotPlatform;
}

function canInline(dataUrl: string) {
  return dataUrl.length <= MAX_INLINE_BYTES;
}

type StoredShot = RecentScreenshot;

function readStored(): StoredShot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is RecentScreenshot => {
        if (!item || typeof item !== 'object') return false;
        const row = item as Partial<RecentScreenshot>;
        return typeof row.id === 'string'
          && typeof row.addedAt === 'number'
          && (typeof row.dataUrl !== 'string' || row.dataUrl.startsWith('data:image/'));
      })
      .map((row) => ({
        id: row.id,
        addedAt: row.addedAt,
        name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : 'Screenshot',
        dataUrl: typeof row.dataUrl === 'string' ? row.dataUrl : '',
        platform: row.platform === 'ios' || row.platform === 'android' ? row.platform : undefined,
      }))
      .slice(0, MAX_RECENT_SCREENSHOTS);
  } catch {
    return [];
  }
}

/** Shots already in localStorage. Large images are filled in by `hydrateRecentScreenshots`. */
export function loadRecentScreenshots(): RecentScreenshot[] {
  return readStored().filter((row) => row.dataUrl.startsWith('data:image/'));
}

function writeIndex(entries: RecentScreenshot[], inlineIds: Set<string>) {
  const payload = entries.slice(0, MAX_RECENT_SCREENSHOTS).map((entry) => (
    inlineIds.has(entry.id)
      ? entry
      : { id: entry.id, addedAt: entry.addedAt, name: entry.name, platform: entry.platform }
  ));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    const slim = payload.map(({ id, addedAt, name, platform }) => ({ id, addedAt, name, platform }));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    } catch {
      /* The image bytes still live in IndexedDB. */
    }
  }
}

let persistChain: Promise<void> = Promise.resolve();

function persist(entries: RecentScreenshot[]) {
  const snapshot = entries.slice(0, MAX_RECENT_SCREENSHOTS);
  persistChain = persistChain.then(async () => {
    const inlineIds = new Set<string>();
    for (const entry of snapshot) {
      try {
        await libraryPut('shots', entry.id, entry.dataUrl);
      } catch {
        if (canInline(entry.dataUrl)) inlineIds.add(entry.id);
      }
    }
    writeIndex(snapshot, inlineIds);
  }).catch(() => undefined);
}

export function rememberRecentScreenshot(
  current: RecentScreenshot[],
  dataUrl: string,
  name?: string,
  platform?: RecentScreenshotPlatform,
): RecentScreenshot[] {
  if (!dataUrl.startsWith('data:image/')) return current;
  const entry: RecentScreenshot = {
    id: `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    addedAt: Date.now(),
    name: (name?.replace(/\.[^.]+$/, '') || 'Screenshot').slice(0, 48),
    dataUrl,
    platform,
  };
  const next = [entry, ...current.filter((item) => item.dataUrl !== dataUrl)].slice(0, MAX_RECENT_SCREENSHOTS);
  persist(next);
  const kept = new Set(next.map((item) => item.id));
  for (const previous of current) {
    if (!kept.has(previous.id)) {
      void libraryDelete('shots', previous.id).catch(() => undefined);
    }
  }
  return next;
}

/** Load screenshot bytes from IndexedDB so they survive a reload. */
export async function hydrateRecentScreenshots(): Promise<RecentScreenshot[]> {
  const rows = readStored();
  const shots: RecentScreenshot[] = [];
  const keepInline = new Set<string>();
  for (const row of rows) {
    let dataUrl = row.dataUrl;
    let durable = false;
    try {
      const stored = await libraryGet<string>('shots', row.id);
      if (typeof stored === 'string' && stored.startsWith('data:image/')) {
        dataUrl = stored;
        durable = true;
      } else if (dataUrl.startsWith('data:image/')) {
        await libraryPut('shots', row.id, dataUrl);
        durable = true;
      }
    } catch {
      /* Keep whatever was already inline. */
    }
    if (!dataUrl.startsWith('data:image/')) continue;
    if (!durable) keepInline.add(row.id);
    shots.push({ ...row, dataUrl });
  }
  if (rows.length > 0 && shots.length === 0) return [];
  writeIndex(shots, keepInline);
  return shots;
}

/** Prefer shots tagged for this platform; include untagged legacy entries. */
export function recentForPlatform(
  entries: RecentScreenshot[],
  platform: RecentScreenshotPlatform,
): RecentScreenshot[] {
  return entries.filter((item) => !item.platform || item.platform === platform);
}
