import { useEffect, useState } from 'react';
import { Reveal } from '../components/Reveal';
import { SiteChrome } from '../components/SiteChrome';
import {
  FALLBACK_RELEASES,
  RELEASES_PAGE_URL,
  type AppRelease,
  fetchAppReleases,
  formatAssetSize,
  formatReleaseDate,
  notesToBlocks,
  versionLabel,
} from '../lib/releases';

function ReleaseNotes({ notes }: { notes: string }) {
  const blocks = notesToBlocks(notes);
  if (!blocks.length) {
    return <p className="release-notes-empty">No release notes for this build.</p>;
  }
  return (
    <div className="release-notes">
      {blocks.map((block, i) => (
        block.type === 'ul' ? (
          <ul key={`ul-${i}`}>
            {block.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p key={`p-${i}`}>{block.lines[0]}</p>
        )
      ))}
    </div>
  );
}

export function ReleasesPage() {
  const [releases, setReleases] = useState<AppRelease[]>(FALLBACK_RELEASES);
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await fetchAppReleases();
      if (cancelled) return;
      setReleases(next);
      setStatus(next === FALLBACK_RELEASES ? 'fallback' : 'ready');
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <SiteChrome>
      <main className="page releases-page">
        <header className="page-hero">
          <p className="section-kicker">Downloads</p>
          <h1>Releases</h1>
          <p className="page-lede">
            Previous Mac builds with version, date, notes, and direct .dmg links.
            Apple Silicon only for now.
          </p>
        </header>

        {status === 'loading' && (
          <p className="releases-status" role="status">Loading releases…</p>
        )}

        <ol className="releases-list">
          {releases.map((release, index) => {
            const download = release.dmg ?? release.assets[0] ?? null;
            const isLatest = index === 0 && !release.prerelease;
            return (
              <Reveal as="li" key={release.tag} className="release-card" delay={index * 60}>
                <div className="release-card-top">
                  <div className="release-card-meta">
                    <p className="release-version">
                      <span className="release-version-num">{versionLabel(release.tag)}</span>
                      {isLatest && <span className="release-badge">Latest</span>}
                      {release.prerelease && <span className="release-badge is-pre">Pre-release</span>}
                    </p>
                    <p className="release-date">
                      <time dateTime={release.publishedAt}>{formatReleaseDate(release.publishedAt)}</time>
                      <span aria-hidden>·</span>
                      <span>{release.tag}</span>
                    </p>
                    <h2 className="release-title">{release.name}</h2>
                  </div>
                  <div className="release-card-actions">
                    {download ? (
                      <a
                        className="btn btn-primary"
                        href={download.url}
                        download={download.name}
                      >
                        Download .dmg
                        {download.size ? (
                          <span className="release-size">{formatAssetSize(download.size)}</span>
                        ) : null}
                      </a>
                    ) : (
                      <a className="btn btn-ghost" href={release.htmlUrl} target="_blank" rel="noreferrer">
                        View on GitHub
                      </a>
                    )}
                    <a className="release-github-link" href={release.htmlUrl} target="_blank" rel="noreferrer">
                      Release page
                    </a>
                  </div>
                </div>
                <ReleaseNotes notes={release.notes} />
                {release.assets.length > 1 && (
                  <ul className="release-assets">
                    {release.assets.map((asset) => (
                      <li key={asset.url}>
                        <a href={asset.url} download={asset.name}>{asset.name}</a>
                        {asset.size ? <span>{formatAssetSize(asset.size)}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Reveal>
            );
          })}
        </ol>

        <p className="releases-foot">
          All releases also live on{' '}
          <a href={RELEASES_PAGE_URL} target="_blank" rel="noreferrer">GitHub Releases</a>
          {status === 'fallback' ? ' · showing cached catalog (live fetch unavailable).' : '.'}
        </p>
      </main>
    </SiteChrome>
  );
}
