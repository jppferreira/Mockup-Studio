import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { Logo } from './Logo';
import type { ContactIntent } from './ContactModal';

interface Props {
  onBeta: () => void;
  onContact: (intent?: ContactIntent) => void;
}

const NAV_LINKS: { to: string; label: string }[] = [
  { to: '/features', label: 'Features' },
  { to: '/workflow', label: 'Workflow' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/releases', label: 'Releases' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms' },
];

function NavLink({
  to,
  children,
  onNavigate,
}: {
  to: string;
  children: ReactNode;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const active = location.pathname === to;
  return (
    <Link to={to} className={active ? 'is-active' : undefined} onClick={onNavigate}>
      {children}
    </Link>
  );
}

export function SiteNav({ onBeta, onContact }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className={`nav-shell${open ? ' is-open' : ''}`}>
      <header className="nav">
        <Logo size={28} className="nav-brand" />
        <nav className="nav-links" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to}>
              {link.label}
            </NavLink>
          ))}
          <button type="button" className="nav-text-btn" onClick={() => onContact('feedback')}>
            Feedback
          </button>
          <button type="button" className="nav-text-btn" onClick={() => onContact('contact')}>
            Contact
          </button>
        </nav>
        <button type="button" className="nav-cta" onClick={onBeta}>
          Sign up to beta
        </button>
        <button
          type="button"
          className="nav-menu-btn"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={20} strokeWidth={2.25} /> : <Menu size={20} strokeWidth={2.25} />}
        </button>
      </header>

      <div
        className={`nav-drawer-backdrop${open ? ' is-open' : ''}`}
        hidden={!open}
        onClick={close}
        aria-hidden
      />
      <nav
        id={panelId}
        className={`nav-drawer${open ? ' is-open' : ''}`}
        aria-label="Mobile"
        hidden={!open}
      >
        {NAV_LINKS.map((link) => (
          <NavLink key={link.to} to={link.to} onNavigate={close}>
            {link.label}
          </NavLink>
        ))}
        <button
          type="button"
          className="nav-drawer-btn"
          onClick={() => {
            close();
            onContact('feedback');
          }}
        >
          Feedback
        </button>
        <button
          type="button"
          className="nav-drawer-btn"
          onClick={() => {
            close();
            onContact('contact');
          }}
        >
          Contact
        </button>
        <button
          type="button"
          className="nav-drawer-cta"
          onClick={() => {
            close();
            onBeta();
          }}
        >
          Sign up to beta
        </button>
      </nav>
    </div>
  );
}
