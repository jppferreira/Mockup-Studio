import { Link } from 'react-router-dom';
import {
  CREDITS_DISCLAIMER,
  CREDITS_INTRO,
  CREDIT_SECTIONS,
  MODEL_CREDITS,
  type CreditSectionId,
  type ModelCredit,
} from '@shared/credits';
import { SiteChrome } from '../components/SiteChrome';

function rowsForSection(sectionId: CreditSectionId): ModelCredit[] {
  return MODEL_CREDITS.filter((row) => (row.section ?? 'shipped') === sectionId);
}

function CreditsTable({ rows }: { rows: ModelCredit[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="credits-table-wrap">
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
          {rows.map((row) => (
            <tr key={`${row.section ?? 'shipped'}-${row.file}-${row.author}`}>
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
    </div>
  );
}

export function CreditsPage() {
  return (
    <SiteChrome>
      <main className="page credits-page">
        <header className="page-hero">
          <p className="section-kicker">Credits</p>
          <h1>Device model attribution</h1>
          <p className="page-lede">{CREDITS_INTRO}</p>
        </header>

        {CREDIT_SECTIONS.map((section) => {
          const rows = rowsForSection(section.id);
          if (rows.length === 0) return null;
          return (
            <section key={section.id} className="credits-section">
              <h2>{section.title}</h2>
              {section.intro ? <p className="credits-section-intro">{section.intro}</p> : null}
              <CreditsTable rows={rows} />
            </section>
          );
        })}

        <section className="page-note">
          <p>{CREDITS_DISCLAIMER}</p>
        </section>

        <section className="page-cta">
          <Link className="btn btn-primary" to="/#beta">
            Sign up to beta
          </Link>
          <Link className="btn btn-ghost" to="/terms">
            Terms of use
          </Link>
        </section>
      </main>
    </SiteChrome>
  );
}
