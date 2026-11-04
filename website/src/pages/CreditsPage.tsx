import { Link } from 'react-router-dom';
import { CREDITS_DISCLAIMER, CREDITS_INTRO, MODEL_CREDITS } from '@shared/credits';
import { DownloadButton } from '../components/DownloadButton';
import { Reveal } from '../components/Reveal';
import { SiteChrome } from '../components/SiteChrome';

export function CreditsPage() {
  return (
    <SiteChrome>
      <main className="page credits-page">
        <header className="page-hero">
          <p className="section-kicker">Credits</p>
          <h1>Device model attribution</h1>
          <p className="page-lede">{CREDITS_INTRO}</p>
        </header>

        <Reveal as="div" className="credits-table-wrap">
          <table className="credits-table">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Model</th>
                <th scope="col">Author</th>
                <th scope="col">License</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {MODEL_CREDITS.map((row) => (
                <tr key={row.file}>
                  <td>
                    <code>{row.file.replace('public/models/', '')}</code>
                  </td>
                  <td>
                    {row.model}
                    {row.note ? <span className="credits-note">{row.note}</span> : null}
                  </td>
                  <td>
                    {row.authorUrl ? (
                      <a href={row.authorUrl} target="_blank" rel="noreferrer">
                        {row.author}
                      </a>
                    ) : (
                      row.author
                    )}
                  </td>
                  <td>
                    {row.licenseUrl ? (
                      <a href={row.licenseUrl} target="_blank" rel="noreferrer">
                        {row.license}
                      </a>
                    ) : (
                      row.license
                    )}
                  </td>
                  <td>
                    <a href={row.sourceUrl} target="_blank" rel="noreferrer">
                      {row.sourceLabel}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>

        <Reveal as="section" className="page-note">
          <p>{CREDITS_DISCLAIMER}</p>
        </Reveal>

        <Reveal as="section" className="page-cta">
          <DownloadButton className="btn btn-primary" fallbackHref="/#download">
            Download Free
          </DownloadButton>
          <Link className="btn btn-ghost" to="/terms">
            Terms of use
          </Link>
        </Reveal>
      </main>
    </SiteChrome>
  );
}
