import { Link } from 'react-router-dom';
import { AppScreenshot } from '../components/AppScreenshot';
import { FeatureIcon } from '../components/FeatureIcon';
import { Reveal } from '../components/Reveal';
import { SiteChrome } from '../components/SiteChrome';
import { FEATURES } from '../content';
import { useParallax } from '../hooks/useParallax';

export function FeaturesPage() {
  const parallax = useParallax();

  return (
    <SiteChrome>
      <main className="page">
        <header className="page-hero">
          <p className="section-kicker">Features</p>
          <h1>Everything in the studio.</h1>
          <p className="page-lede">
            Devices, custom backgrounds, light, motion, templates, props, and export — arranged so you can stay with the
            shot instead of hunting panels.
          </p>
        </header>

        <Reveal as="section" className="page-shot">
          <AppScreenshot style={parallax.layer(0.08, 6)} />
        </Reveal>

        <ul className="feature-grid feature-grid-detailed">
          {FEATURES.map((feature, i) => (
            <Reveal as="li" key={feature.title} className="feature-tile" delay={i * 80}>
              <span className="feature-index">{String(i + 1).padStart(2, '0')}</span>
              <FeatureIcon id={feature.icon} size={24} />
              <h2>{feature.title}</h2>
              <p>{feature.copy}</p>
              <p className="feature-detail">{feature.detail}</p>
            </Reveal>
          ))}
        </ul>

        <Reveal as="section" className="page-cta">
          <Link className="btn btn-primary" to="/pricing">
            See pricing
          </Link>
          <Link className="btn btn-ghost" to="/workflow">
            See the workflow
          </Link>
        </Reveal>
      </main>
    </SiteChrome>
  );
}
