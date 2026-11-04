const STORAGE_KEY = 'mockup-studio.recent-screenshots.v1';
export const MAX_RECENT_SCREENSHOTS = 4;
/** Skip persisting individual shots larger than this (keep in-session only). */
const MAX_PERSIST_BYTES = 2_500_000;

export interface RecentScreenshot {
  id: string;
  addedAt: number;
  name: string;
  dataUrl: string;
}

function canPersist(dataUrl: string) {
  return dataUrl.length <= MAX_PERSIST_BYTES;
}

export function loadRecentScreenshots(): RecentScreenshot[] {
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
          && typeof row.dataUrl === 'string'
          && row.dataUrl.startsWith('data:image/')
          && typeof row.addedAt === 'number';
      })
      .map((row) => ({
        id: row.id,
        addedAt: row.addedAt,
        name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : 'Screenshot',
        dataUrl: row.dataUrl,
      }))
      .slice(0, MAX_RECENT_SCREENSHOTS);
  } catch {
    return [];
  }
}

function persist(entries: RecentScreenshot[]) {
  const durable = entries.filter((entry) => canPersist(entry.dataUrl));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(durable));
  } catch {
    // Quota — drop oldest until it fits, then give up quietly.
    for (let i = durable.length - 1; i >= 0; i -= 1) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(durable.slice(0, i)));
        return;
      } catch {
        /* continue */
      }
    }
  }
}

export function rememberRecentScreenshot(
  current: RecentScreenshot[],
  dataUrl: string,
  name?: string,
): RecentScreenshot[] {
  if (!dataUrl.startsWith('data:image/')) return current;
  const entry: RecentScreenshot = {
    id: `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    addedAt: Date.now(),
    name: (name?.replace(/\.[^.]+$/, '') || 'Screenshot').slice(0, 48),
    dataUrl,
  };
  const next = [entry, ...current.filter((item) => item.dataUrl !== dataUrl)].slice(0, MAX_RECENT_SCREENSHOTS);
  persist(next);
  return next;
}
