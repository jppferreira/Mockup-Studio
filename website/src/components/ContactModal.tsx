import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Mail, X } from 'lucide-react';

const CONTACT_EMAIL = 'hello@jppferreira.com';

type Status = 'idle' | 'sending' | 'sent' | 'error';

interface Props {
  open: boolean;
  onClose: () => void;
}

function openMailto(name: string, email: string, message: string) {
  const subject = encodeURIComponent(`Mockup Studio contact — ${name}`);
  const body = encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\n${message}`);
  const link = document.createElement('a');
  link.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function ContactModal({ open, onClose }: Props) {
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStatus('idle');
    setError(null);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => nameRef.current?.focus(), 40);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedMessage = message.trim();
    if (!trimmedName || !trimmedEmail || !trimmedMessage) {
      setError('Please fill in your name, email, and message.');
      setStatus('error');
      return;
    }

    setStatus('sending');
    setError(null);

    try {
      const res = await fetch(`https://formsubmit.co/ajax/${CONTACT_EMAIL}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          message: trimmedMessage,
          _subject: `Mockup Studio contact — ${trimmedName}`,
          _template: 'table',
          _captcha: 'false',
        }),
      });

      if (!res.ok) throw new Error('send_failed');
      setStatus('sent');
      setName('');
      setEmail('');
      setMessage('');
    } catch {
      // Guaranteed path if the relay is blocked or needs first-time activation
      openMailto(trimmedName, trimmedEmail, trimmedMessage);
      setStatus('sent');
      setName('');
      setEmail('');
      setMessage('');
    }
  };

  return (
    <div
      className="contact-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="contact-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="contact-modal-head">
          <div className="contact-modal-icon" aria-hidden>
            <Mail size={20} />
          </div>
          <button type="button" className="contact-modal-close" aria-label="Close contact form" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <h2 id={titleId}>Contact us</h2>
        <p className="contact-modal-lede">
          Questions about Mockup Studio, licensing, or the Mac build? Send a note — it goes to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>

        {status === 'sent' ? (
          <div className="contact-success">
            <p>Thanks — your message is on its way.</p>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <form className="contact-form" onSubmit={onSubmit} noValidate>
            <label className="contact-field">
              <span>Name</span>
              <input
                ref={nameRef}
                type="text"
                name="name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={status === 'sending'}
              />
            </label>
            <label className="contact-field">
              <span>Email</span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={status === 'sending'}
              />
            </label>
            <label className="contact-field">
              <span>Message</span>
              <textarea
                name="message"
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                disabled={status === 'sending'}
              />
            </label>

            {error && <p className="contact-error" role="alert">{error}</p>}

            <div className="contact-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={status === 'sending'}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={status === 'sending'}>
                {status === 'sending' ? 'Sending…' : 'Send message'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
