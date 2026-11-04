import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ContactModal } from './ContactModal';
import { DownloadButton } from './DownloadButton';
import { Logo } from './Logo';
import { useParallax } from '../hooks/useParallax';

export function SiteChrome({ children }: { children: ReactNode }) {
  const parallax = useParallax();
  const location = useLocation();
  const [contactOpen, setContactOpen] = useState(false);

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

      <div className="nav-shell">
        <header className="nav">
          <Logo size={28} className="nav-brand" />
          <nav className="nav-links" aria-label="Primary">
            <Link to="/features" className={location.pathname === '/features' ? 'is-active' : undefined}>
              Features
            </Link>
            <Link to="/workflow" className={location.pathname === '/workflow' ? 'is-active' : undefined}>
              Workflow
            </Link>
            <Link to="/pricing" className={location.pathname === '/pricing' ? 'is-active' : undefined}>
              Pricing
            </Link>
            <Link to="/privacy" className={location.pathname === '/privacy' ? 'is-active' : undefined}>
              Privacy
            </Link>
            <button type="button" className="nav-text-btn" onClick={() => setContactOpen(true)}>
              Contact
            </button>
          </nav>
          <DownloadButton className="nav-cta" short fallbackHref="/#download">
            Download Free
          </DownloadButton>
        </header>
      </div>

      {children}

      <footer className="footer">
        <Logo size={22} className="footer-brand" to={null} showBeta={false} />
        <nav className="footer-links" aria-label="Footer">
          <Link to="/features">Features</Link>
          <Link to="/workflow">Workflow</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/privacy">Privacy</Link>
          <button type="button" className="footer-text-btn" onClick={() => setContactOpen(true)}>
            Contact
          </button>
        </nav>
        <p>Local-first 3D device mockups for macOS.</p>
      </footer>

      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} />
    </div>
  );
}
