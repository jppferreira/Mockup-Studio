import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BetaSignupModal } from './BetaSignupModal';
import { ContactModal, type ContactIntent } from './ContactModal';
import { SHOW_RELEASE_DOWNLOADS } from '../content';
import { Logo } from './Logo';
import { SiteNav } from './SiteNav';
import { useParallax } from '../hooks/useParallax';

export function SiteChrome({ children }: { children: ReactNode }) {
  const parallax = useParallax();
  const location = useLocation();
  const [contactOpen, setContactOpen] = useState(false);
  const [contactIntent, setContactIntent] = useState<ContactIntent>('contact');
  const [betaOpen, setBetaOpen] = useState(false);
  const openContact = (intent: ContactIntent = 'contact') => {
    setContactIntent(intent);
    setContactOpen(true);
  };

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="site" data-theme="dark">
      <div className="noise" aria-hidden />
      <div className="parallax-field" aria-hidden>
        <div className="orb orb-a" style={parallax.layer(0.1, 20)} />
        <div className="orb orb-b" style={parallax.layer(0.18, -24)} />
        <div className="grid-wash" style={parallax.layer(0.04, 0)} />
      </div>

      <SiteNav onBeta={() => setBetaOpen(true)} onContact={openContact} />

      {children}

      <footer className="footer">
        <Logo size={22} className="footer-brand" to={null} showBeta={false} />
        <nav className="footer-links" aria-label="Footer">
          <Link to="/features">Features</Link>
          <Link to="/workflow">Workflow</Link>
          <Link to="/pricing">Pricing</Link>
          {SHOW_RELEASE_DOWNLOADS ? <Link to="/releases">Releases</Link> : null}
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
      <BetaSignupModal
        open={betaOpen}
        source={`page:${location.pathname}`}
        onClose={() => setBetaOpen(false)}
      />
    </div>
  );
}
