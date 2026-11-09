/** GitHub releases for mokstudio downloads. */

export const RELEASES_REPO = 'jppferreira/Mockup-Studio';
export const RELEASES_API = `https://api.github.com/repos/${RELEASES_REPO}/releases`;
export const RELEASES_PAGE_URL = `https://github.com/${RELEASES_REPO}/releases`;

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface AppRelease {
  tag: string;
  name: string;
  publishedAt: string;
  prerelease: boolean;
  htmlUrl: string;
  /** GitHub release body / release notes (markdown or plain text). */
  notes: string;
  /** Preferred Mac .dmg when present */
  dmg: ReleaseAsset | null;
  assets: ReleaseAsset[];
}

/** Offline / rate-limit fallback — keep in sync when shipping a new GitHub Release. */
export const FALLBACK_RELEASES: AppRelease[] = [
  {
    tag: 'v0.1.0',
    name: 'mokstudio 0.1.0',
    publishedAt: '2026-11-04T11:23:17Z',
    prerelease: false,
    htmlUrl: `https://github.com/${RELEASES_REPO}/releases/tag/v0.1.0`,
    notes: 'First public Mac build (Apple Silicon). Unsigned — Gatekeeper may warn on open.',
    dmg: {
      name: 'Mockup-Studio-0.1.0-arm64.dmg',
      url: `https://github.com/${RELEASES_REPO}/releases/download/v0.1.0/Mockup-Studio-0.1.0-arm64.dmg`,
      size: 178_804_531,
    },
    assets: [
      {
        name: 'Mockup-Studio-0.1.0-arm64.dmg',
        url: `https://github.com/${RELEASES_REPO}/releases/download/v0.1.0/Mockup-Studio-0.1.0-arm64.dmg`,
        size: 178_804_531,
      },
    ],
  },
];

type GhRelease = {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  created_at: string;
  prerelease: boolean;
  draft: boolean;
  html_url: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
    size: number;
  }>;
};

function pickDmg(assets: ReleaseAsset[]): ReleaseAsset | null {
  const dmg = assets.find((a) => /\.dmg$/i.test(a.name) && /arm64/i.test(a.name))
    ?? assets.find((a) => /\.dmg$/i.test(a.name));
  return dmg ?? null;
}

export function mapGithubRelease(raw: GhRelease): AppRelease | null {
  if (raw.draft) return null;
  const assets: ReleaseAsset[] = (raw.assets ?? []).map((a) => ({
    name: a.name,
    url: a.browser_download_url,
    size: a.size,
  }));
  return {
    tag: raw.tag_name,
    name: raw.name?.trim() || raw.tag_name,
    publishedAt: raw.published_at || raw.created_at,
    prerelease: Boolean(raw.prerelease),
    htmlUrl: raw.html_url,
    notes: (raw.body ?? '').trim(),
    dmg: pickDmg(assets),
    assets,
  };
}

export async function fetchAppReleases(): Promise<AppRelease[]> {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub releases HTTP ${res.status}`);
    const data = (await res.json()) as GhRelease[];
    const mapped = data.map(mapGithubRelease).filter((r): r is AppRelease => Boolean(r));
    return mapped.length ? mapped : FALLBACK_RELEASES;
  } catch {
    return FALLBACK_RELEASES;
  }
}

export function formatReleaseDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatAssetSize(bytes: number): string {
  if (!bytes || bytes < 0) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 100) return `${Math.round(mb)} MB`;
  if (mb >= 10) return `${mb.toFixed(0)} MB`;
  return `${mb.toFixed(1)} MB`;
}

export function versionLabel(tag: string): string {
  return tag.replace(/^v/i, '');
}

/** Lightweight notes renderer — paragraphs + bullet lines, no full markdown parser. */
export function notesToBlocks(notes: string): Array<{ type: 'p' | 'ul'; lines: string[] }> {
  const trimmed = notes.trim();
  if (!trimmed) return [];
  const blocks: Array<{ type: 'p' | 'ul'; lines: string[] }> = [];
  let para: string[] = [];
  let bullets: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    blocks.push({ type: 'p', lines: [para.join(' ')] });
    para = [];
  };
  const flushBullets = () => {
    if (!bullets.length) return;
    blocks.push({ type: 'ul', lines: bullets });
    bullets = [];
  };

  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushPara();
      flushBullets();
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      flushPara();
      bullets.push(bullet[1]);
      continue;
    }
    flushBullets();
    para.push(line);
  }
  flushPara();
  flushBullets();
  return blocks;
}
