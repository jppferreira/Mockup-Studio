/**
 * Desktop update discovery + release notes.
 * Prefer Electron auto-updater events; probe the public feed for version/notes
 * so the home modal can show what changed before the user downloads in-app.
 */

export type DesktopUpdateStatus = {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'up-to-date';
  version?: string | null;
  percent?: number;
  message?: string | null;
  /** Short changelog lines for the update modal. */
  notes?: string[];
  title?: string | null;
};

const LATEST_YML_URL =
  'https://github.com/jppferreira/Mockup-Studio/releases/latest/download/latest-mac.yml';
const LATEST_RELEASE_API =
  'https://api.github.com/repos/jppferreira/Mockup-Studio/releases/latest';
const RELEASE_BY_TAG_API =
  'https://api.github.com/repos/jppferreira/Mockup-Studio/releases/tags';

function parseVersion(raw: string | null | undefined): number[] {
  if (!raw) return [0];
  return raw
    .trim()
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

/** Semver-ish compare: 1 if a>b, -1 if a<b, 0 if equal. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

export function currentAppVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
}

function parseLatestYml(text: string): { version: string | null; path: string | null } {
  const version = text.match(/^version:\s*['"]?([^\s'"]+)/m)?.[1] ?? null;
  const path = text.match(/^path:\s*['"]?([^\s'"]+)/m)?.[1] ?? null;
  return { version, path };
}

/** Turn GitHub release markdown into short plain bullets for the modal. */
export function parseReleaseNotes(body: string | null | undefined, limit = 8): string[] {
  if (!body?.trim()) return [];
  const lines = body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const bullets: string[] = [];
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) continue;
    if (/^---+$/.test(line)) continue;
    if (/^```/.test(line)) continue;
    const bullet = line
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim();
    if (!bullet || /^(downloads?|gatekeeper note)\b/i.test(bullet)) continue;
    bullets.push(bullet);
    if (bullets.length >= limit) break;
  }
  return bullets;
}

type ReleasePayload = {
  version: string | null;
  title: string | null;
  notes: string[];
};

async function fetchReleaseJson(url: string): Promise<ReleasePayload | null> {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) return null;
  const data = await response.json() as {
    tag_name?: string;
    name?: string;
    body?: string;
  };
  const version = (data.tag_name || '').replace(/^v/i, '') || null;
  return {
    version,
    title: data.name?.trim() || (version ? `mokstudio ${version}` : null),
    notes: parseReleaseNotes(data.body),
  };
}

export async function fetchReleaseNotesForVersion(version: string | null | undefined): Promise<ReleasePayload | null> {
  const cleaned = version?.replace(/^v/i, '').trim();
  if (cleaned) {
    const byTag = await fetchReleaseJson(`${RELEASE_BY_TAG_API}/v${cleaned}`);
    if (byTag) return byTag;
  }
  return fetchReleaseJson(LATEST_RELEASE_API);
}

export async function fetchLatestReleaseInfo(): Promise<{
  version: string | null;
  title: string | null;
  notes: string[];
}> {
  const fromApi = await fetchReleaseJson(LATEST_RELEASE_API);
  if (fromApi?.version) return fromApi;

  const response = await fetch(LATEST_YML_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not reach update feed (${response.status})`);
  const text = await response.text();
  const { version } = parseLatestYml(text);
  const notes = version ? await fetchReleaseNotesForVersion(version) : null;
  return {
    version,
    title: notes?.title ?? (version ? `mokstudio ${version}` : null),
    notes: notes?.notes ?? [],
  };
}

/** If Electron has not reported a newer build, probe the public feed + notes. */
export async function probeExternalUpdate(
  current = currentAppVersion(),
): Promise<DesktopUpdateStatus | null> {
  try {
    const latest = await fetchLatestReleaseInfo();
    if (!latest.version || compareVersions(latest.version, current) <= 0) {
      return { state: 'up-to-date', version: current };
    }
    return {
      state: 'available',
      version: latest.version,
      title: latest.title,
      notes: latest.notes,
      message: `Version ${latest.version} is available.`,
    };
  } catch (err) {
    return {
      state: 'error',
      message: err instanceof Error ? err.message : 'Update check failed',
    };
  }
}
