import { useEffect, useId, useRef } from 'react';
import { Sparkles, X } from 'lucide-react';
import { BetaSignupForm } from './BetaSignupForm';

interface Props {
  open: boolean;
  onClose: () => void;
  source?: string;
}

export function BetaSignupModal({ open, onClose, source = 'hero' }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLInputElement>('input[type="email"]')?.focus();
    }, 40);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="contact-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="contact-modal beta-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="contact-modal-head">
          <div className="contact-modal-icon" aria-hidden>
            <Sparkles size={20} />
          </div>
          <button type="button" className="contact-modal-close" aria-label="Close beta signup" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <h2 id={titleId}>Sign up to beta</h2>
        <p className="contact-modal-lede">
          Leave your email and we’ll send the Mac build when it’s ready. Apple Silicon · macOS 13+.
        </p>

        <BetaSignupForm source={source} id="beta-modal-email" layout="stack" />
      </div>
    </div>
  );
}
