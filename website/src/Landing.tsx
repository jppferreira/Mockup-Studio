import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppScreenshot } from './components/AppScreenshot';
import { ContactModal, type ContactIntent } from './components/ContactModal';
import { Logo } from './components/Logo';
import { Reveal } from './components/Reveal';
import { PLANS, PRICING_TAGLINE, UPDATE_PASS } from '@shared/pricing';
import { CheckoutButton } from './components/CheckoutButton';
import { DownloadButton } from './components/DownloadButton';
import { FeatureIcon, type FeatureIlloStyle } from './components/FeatureIcon';
import { FEATURES, HEADLINE_OPTIONS, STEPS } from './content';
import { useParallax } from './hooks/useParallax';
import { isMacDownloadConfigured } from '@shared/download';

type HeroLayout = 'stack' | 'side';

export function Landing() {
  const parallax = useParallax();
  const activeCopy = HEADLINE_OPTIONS[0];
  const [contactOpen, setContactOpen] = useState(false);
  const [contactIntent, setContactIntent] = useState<ContactIntent>('contact');
  const openContact = (intent: ContactIntent = 'contact') => {
    setContactIntent(intent);
    setContactOpen(true);
  };
  const [heroLayout, setHeroLayout] = useState<HeroLayout>('stack');
  const [illoStyle, setIlloStyle] = useState<FeatureIlloStyle>('charcoal');

  return (
    <div className="site" data-theme="dark">
      <div className="noise" aria-hidden />
      <div className="parallax-field" aria-hidden>
        <div className="orb orb-a" style={parallax.layer(0.1, 20)} />
        <div className="orb orb-b" style={parallax.layer(0.18, -28)} />
        <div className="orb orb-c" style={parallax.layer(0.06, 14)} />
      </div>

      <div className="nav-shell">
        <header className="nav">
          <Logo size={28} className="nav-brand" />
          <nav className="nav-links" aria-label="Primary">
            <Link to="/features">Features</Link>
            <Link to="/workflow">Workflow</Link>
            <Link to="/pricing">Pricing</Link>
            <Link to="/releases">Releases</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <button type="button" className="nav-text-btn" onClick={() => openContact('feedback')}>
              Feedback
            </button>
            <button type="button" className="nav-text-btn" onClick={() => openContact('contact')}>
              Contact
            </button>
          </nav>
          <DownloadButton className="nav-cta" short>
            Download Free
          </DownloadButton>
        </header>
      </div>

      <div className="layout-tester-stack" aria-label="Design testers">
        <div className="layout-tester" role="group" aria-label="Illustration style tester">
          <span className="layout-tester-label">Illos</span>
          <button
            type="button"
            className={`layout-tester-btn${illoStyle === 'charcoal' ? ' is-active' : ''}`}
            onClick={() => setIlloStyle('charcoal')}
            aria-pressed={illoStyle === 'charcoal'}
          >
            Charcoal
          </button>
          <button
            type="button"
            className={`layout-tester-btn${illoStyle === 'mint' ? ' is-active' : ''}`}
            onClick={() => setIlloStyle('mint')}
            aria-pressed={illoStyle === 'mint'}
          >
            Mint
          </button>
        </div>
        <div className="layout-tester" role="group" aria-label="Hero layout tester">
          <span className="layout-tester-label">Layout</span>
          <button
            type="button"
            className={`layout-tester-btn${heroLayout === 'stack' ? ' is-active' : ''}`}
            onClick={() => setHeroLayout('stack')}
            aria-pressed={heroLayout === 'stack'}
          >
            Stacked
          </button>
          <button
            type="button"
            className={`layout-tester-btn${heroLayout === 'side' ? ' is-active' : ''}`}
            onClick={() => setHeroLayout('side')}
            aria-pressed={heroLayout === 'side'}
          >
            Side by side
          </button>
        </div>
      </div>

      <main id="top">
        <section
          className={`hero hero-with-shot hero-layout-${heroLayout}`}
          data-hero-layout={heroLayout}
        >
          <div className="hero-copy">
            <h1 className="hero-headline">{activeCopy.headline}</h1>
            <p className="lede">{activeCopy.lede}</p>
            <div className="hero-actions">
              <DownloadButton className="btn btn-primary btn-hero-download" />
              <Link className="btn btn-ghost" to="/pricing">
                See pricing
              </Link>
            </div>
            <p className="hero-note">Free for Apple Silicon · macOS 13+</p>
          </div>

          <div className="hero-shot-wrap">
            <div className="hero-shot-cut">
              <AppScreenshot style={parallax.layer(-0.22, 0, 560)} />
            </div>
          </div>
        </section>

        <section
          className="body-cut"
          id="features"
          style={parallax.layer(-0.08, 0, 480)}
        >
          <Reveal as="div" className="features features-in-cut">
            <div className="section-head features-head">
              <p className="section-kicker">Product</p>
              <h2>Everything you need to finish the shot.</h2>
              <p className="features-lede">
                Devices, custom backgrounds, light, motion, templates, props, export, and local files — arranged like a
                modern creative tool, not a render farm.
              </p>
            </div>
            <ul className="feature-grid">
              {FEATURES.map((feature, i) => (
                <Reveal as="li" key={feature.title} className="feature-tile" delay={i * 70}>
                  <span className="feature-index">{String(i + 1).padStart(2, '0')}</span>
                  <FeatureIcon id={feature.icon} style={illoStyle} />
                  <h3>{feature.title}</h3>
                  <p>{feature.copy}</p>
                </Reveal>
              ))}
            </ul>
            <p className="section-more">
              <Link to="/features">Explore all features →</Link>
            </p>
          </Reveal>
        </section>

        <section className="workflow-band" id="workflow">
          <Reveal as="div" className="workflow">
            <p className="section-kicker">Workflow</p>
            <h2>Three steps. Then ship.</h2>
            <ol className="steps">
              {STEPS.map((step, i) => (
                <Reveal as="li" key={step.n} className="step" delay={i * 90}>
                  <span className="step-n">{step.n}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.copy}</p>
                  </div>
                </Reveal>
              ))}
            </ol>
            <p className="section-more">
              <Link to="/workflow">See the full workflow →</Link>
            </p>
          </Reveal>
        </section>

        <Reveal as="section" className="local" id="local">
          <div className="local-inner">
            <p className="section-kicker">Local-first</p>
            <h2>Your pixels stay on the machine.</h2>
            <p>
              Built as a native Mac app. Projects save as local files — no account, no sync service, no waiting on someone
              else’s queue.
            </p>
            <p className="section-more on-dark">
              <Link to="/privacy">Read privacy details →</Link>
            </p>
          </div>
        </Reveal>

        <Reveal as="section" className="pricing-teaser" id="pricing">
          <div className="section-head">
            <p className="section-kicker">Pricing</p>
            <h2>Start free. Upgrade once.</h2>
            <p className="pricing-teaser-copy">{PRICING_TAGLINE}</p>
          </div>
          <ul className="pricing-grid pricing-grid-home">
            {PLANS.map((plan, i) => (
              <Reveal
                as="li"
                key={plan.id}
                className={`pricing-card ${plan.highlighted ? 'is-highlighted' : ''}`}
                delay={i * 60}
              >
                {plan.highlighted && <span className="pricing-badge">Most popular</span>}
                <p className="pricing-name">{plan.name}</p>
                <p className="pricing-price">
                  {plan.priceLabel}
                  <span>{plan.billing}</span>
                </p>
                <p className="pricing-tagline">{plan.tagline}</p>
                <ul className="pricing-includes">
                  {plan.includes.slice(0, 5).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Reveal>
            ))}
          </ul>
          <p className="update-pass-inline">
            Optional {UPDATE_PASS.name}: {UPDATE_PASS.priceLabel}/year after the included update window.
          </p>
          <div className="pricing-teaser-actions">
            <CheckoutButton plan="pro" className="btn btn-primary" />
            <Link className="btn btn-ghost" to="/pricing">
              Compare plans
            </Link>
          </div>
        </Reveal>

        <Reveal as="section" className="download" id="download">
          <div className="download-panel">
            <p className="section-kicker">Get the app</p>
            <h2>Download mokstudio for Mac.</h2>
            <p>
              Free for Apple Silicon. Upgrade in-app to Pro ({PLANS.find((p) => p.id === 'pro')?.priceLabel}) or Pro Max (
              {PLANS.find((p) => p.id === 'pro_max')?.priceLabel}) when you need the full library and motion export.
            </p>
            <div className="download-actions">
              <DownloadButton className="btn btn-primary btn-hero-download" fallbackHref="#download">
                {isMacDownloadConfigured() ? 'Download for Mac' : 'Get Free'}
              </DownloadButton>
              <Link className="btn btn-ghost" to="/pricing">
                See pricing
              </Link>
            </div>
            {isMacDownloadConfigured() ? (
              <p className="install-hint">Apple Silicon · macOS 13+</p>
            ) : (
              <p className="install-hint">
                Set <code>VITE_DOWNLOAD_MAC_URL</code> to go live.
              </p>
            )}
          </div>
        </Reveal>
      </main>

      <footer className="footer">
        <Logo size={22} className="footer-brand" to={null} showBeta={false} />
        <nav className="footer-links" aria-label="Footer">
          <Link to="/features">Features</Link>
          <Link to="/workflow">Workflow</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/releases">Releases</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/credits">Credits</Link>
          <Link to="/recover">Recover key</Link>
          <button type="button" className="footer-text-btn" onClick={() => openContact('feedback')}>
            Feedback
          </button>
          <button type="button" className="footer-text-btn" onClick={() => openContact('contact')}>
            Contact
          </button>
        </nav>
        <p>Local-first 3D device mockups for macOS.</p>
      </footer>

      <ContactModal
        open={contactOpen}
        intent={contactIntent}
        onClose={() => setContactOpen(false)}
      />
    </div>
  );
}
