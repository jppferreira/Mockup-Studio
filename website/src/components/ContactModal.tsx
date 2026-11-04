import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Mail, MessageSquarePlus, X } from 'lucide-react';
import { FEEDBACK_EMAIL, submitFeedbackBrowser } from '@shared/feedbackSubmit';

export type ContactIntent = 'contact' | 'feedback';
export type ContactTopic = 'question' | 'bug' | 'idea' | 'praise' | 'licensing' | 'other';

const TOPICS: { id: ContactTopic; label: string; intents: ContactIntent[] }[] = [
  { id: 'question', label: 'Question', intents: ['contact'] },
  { id: 'licensing', label: 'Licensing', intents: ['contact'] },
  { id: 'bug', label: 'Bug', intents: ['feedback', 'contact'] },
  { id: 'idea', label: 'Idea', intents: ['feedback', 'contact'] },
  { id: 'praise', label: 'Praise', intents: ['feedback'] },
  { id: 'other', label: 'Other', intents: ['feedback', 'contact'] },
];

type Status = 'idle' | 'sending' | 'sent' | 'error';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Defaults to contact; feedback opens a product-feedback framing. */
  intent?: ContactIntent;
}

function topicLabel(topic: ContactTopic) {
  return TOPICS.find((item) => item.id === topic)?.label ?? topic;
}

function fulfillBase(): string | null {
  const fromEnv = import.meta.env.VITE_FULFILL_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (typeof window !== 'undefined' && /localhost|127\.0\.0\.1/.test(window.location.hostname)) {
    return 'http://127.0.0.1:8787';
  }
  return null;
}

function openMailtoHref(href: string) {
  const link = document.createElement('a');
  link.href = href;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function ContactModal({ open, onClose, intent = 'contact' }: Props) {
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [topic, setTopic] = useState<ContactTopic>(intent === 'feedback' ? 'idea' : 'question');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sentChannel, setSentChannel] = useState<'api' | 'formsubmit' | 'mailto' | null>(null);

  const topics = TOPICS.filter((item) => item.intents.includes(intent));

  useEffect(() => {
    if (!open) return;
    setStatus('idle');
    setError(null);
    setSentChannel(null);
    setTopic(intent === 'feedback' ? 'idea' : 'question');
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
  }, [open, onClose, intent]);

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
    const kind = intent === 'feedback' ? 'feedback' : 'contact';

    const result = await submitFeedbackBrowser(
      {
        name: trimmedName,
        email: trimmedEmail,
        message: trimmedMessage,
        topic: topicLabel(topic),
        intent: kind,
        platform: navigator.platform || 'unknown',
        userAgent: navigator.userAgent,
        fulfillApiUrl: fulfillBase(),
        inboxEmail: FEEDBACK_EMAIL,
      },
      openMailtoHref,
    );

    if (!result.ok) {
      setError(result.error);
      setStatus('error');
      return;
    }

    setSentChannel(result.channel);
    setStatus('sent');
    setName('');
    setEmail('');
    setMessage('');
  };

  const Icon = intent === 'feedback' ? MessageSquarePlus : Mail;

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
            <Icon size={20} />
          </div>
          <button type="button" className="contact-modal-close" aria-label="Close form" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <h2 id={titleId}>{intent === 'feedback' ? 'Send feedback' : 'Contact us'}</h2>
        <p className="contact-modal-lede">
          {intent === 'feedback'
            ? 'Bugs, ideas, or a quick note about Mockup Studio — we read every message.'
            : 'Questions about Mockup Studio, licensing, or the Mac build? Send a note and we’ll get back to you.'}
        </p>

        {status === 'sent' ? (
          <div className="contact-success">
            <p>
              {sentChannel === 'mailto'
                ? 'Your email app should have a draft ready — send it when you’re set.'
                : 'Thanks — your message is on its way.'}
            </p>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <form className="contact-form" onSubmit={onSubmit} noValidate>
            <div className="contact-topic-block">
              <span className="contact-topic-label">Topic</span>
              <div className="contact-topic-row" role="radiogroup" aria-label="Message topic">
                {topics.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={topic === item.id}
                    className={`contact-topic${topic === item.id ? ' is-active' : ''}`}
                    onClick={() => setTopic(item.id)}
                    disabled={status === 'sending'}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

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
                placeholder={
                  intent === 'feedback'
                    ? 'What worked, what broke, or what you’d love next…'
                    : undefined
                }
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
                {status === 'sending'
                  ? 'Sending…'
                  : intent === 'feedback'
                    ? 'Send feedback'
                    : 'Send message'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
