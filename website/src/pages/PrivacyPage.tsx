import { Link } from 'react-router-dom';
import { Reveal } from '../components/Reveal';
import { SiteChrome } from '../components/SiteChrome';
import { PRIVACY_BETA, PRIVACY_POINTS } from '../content';

export function PrivacyPage() {
  return (
    <SiteChrome>
      <main className="page">
        <header className="page-hero">
          <p className="section-kicker">Privacy</p>
          <h1>Local-first, on purpose.</h1>
          <p className="page-lede">
            mokstudio is built to keep screenshots and project files on your Mac. No account is required to open a scene.
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

        <Reveal as="section" className="privacy-beta" id={PRIVACY_BETA.id}>
          <h2>{PRIVACY_BETA.title}</h2>
          <ul>
            {PRIVACY_BETA.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <p>
            Messages sent through Contact or Feedback are used only to reply. They are not added to the beta list unless
            you also submit the signup form.
          </p>
        </Reveal>

        <Reveal as="section" className="page-note">
          <p>
            The desktop app does not upload project contents. The app is proprietary (see Terms); open-source npm
            dependencies and CC BY device models apply their own licenses — see <Link to="/credits">Credits</Link>.
            Site fonts are Manrope and Sora under the SIL Open Font License.
          </p>
        </Reveal>

        <Reveal as="section" className="page-cta">
          <Link className="btn btn-primary" to="/#beta">
            Sign up to beta
          </Link>
          <Link className="btn btn-ghost" to="/">
            Back to home
          </Link>
        </Reveal>
      </main>
    </SiteChrome>
  );
}
