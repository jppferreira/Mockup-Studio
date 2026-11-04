import { Link } from 'react-router-dom';
import { DownloadButton } from '../components/DownloadButton';
import { Reveal } from '../components/Reveal';
import { SiteChrome } from '../components/SiteChrome';
import { PRIVACY_POINTS } from '../content';

export function PrivacyPage() {
  return (
    <SiteChrome>
      <main className="page">
        <header className="page-hero">
          <p className="section-kicker">Privacy</p>
          <h1>Local-first, on purpose.</h1>
          <p className="page-lede">
            Mockup Studio is built to keep screenshots and project files on your Mac. No account is required to open a scene.
          </p>
        </header>

        <ul className="privacy-list">
          {PRIVACY_POINTS.map((point, i) => (
            <Reveal as="li" key={point.title} className="privacy-row" delay={i * 80}>
              <h2>{point.title}</h2>
              <p>{point.copy}</p>
            </Reveal>
          ))}
        </ul>

        <Reveal as="section" className="page-note">
          <p>
            The marketing website may load fonts from Google when you are online. The desktop app itself does not upload
            project contents. Open-source npm dependencies apply their own licenses.
          </p>
        </Reveal>

        <Reveal as="section" className="page-cta">
          <DownloadButton className="btn btn-primary" fallbackHref="/#download">
            Get started
          </DownloadButton>
          <Link className="btn btn-ghost" to="/">
            Back to home
          </Link>
        </Reveal>
      </main>
    </SiteChrome>
  );
}
