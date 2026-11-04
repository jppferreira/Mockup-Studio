import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { MessageSquarePlus, X } from 'lucide-react';
import { submitFeedback } from '../lib/feedback';

export type FeedbackTopic = 'bug' | 'idea' | 'praise' | 'other';

const TOPICS: { id: FeedbackTopic; label: string }[] = [
  { id: 'bug', label: 'Bug' },
  { id: 'idea', label: 'Idea' },
  { id: 'praise', label: 'Praise' },
  { id: 'other', label: 'Other' },
];

type Status = 'idle' | 'sending' | 'sent' | 'error';

interface Props {
  open: boolean;
  onClose: () => void;
  onNotify?: (message: string) => void;
  appVersion?: string;
}

export default function FeedbackModal({
  open,
  onClose,
  onNotify,
  appVersion = '0.1.0',
}: Props) {
  const titleId = useId();
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [topic, setTopic] = useState<FeedbackTopic>('idea');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sentChannel, setSentChannel] = useState<'api' | 'formsubmit' | 'mailto' | null>(null);
  const sent = status === 'sent';

  // Only reset when the modal opens — not when parent re-renders with a new onClose
  // (toast notify after send used to wipe the success screen immediately).
  useEffect(() => {
    if (!open) return;
    setStatus('idle');
    setError(null);
    setSentChannel(null);
    const t = window.setTimeout(() => messageRef.current?.focus(), 40);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Success card is non-blocking — blur so Space+drag can pan the canvas underneath.
  useEffect(() => {
    if (!sent) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  }, [sent]);

  if (!open) return null;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const topicLabel = TOPICS.find((item) => item.id === topic)?.label ?? topic;
    setStatus('sending');
    setError(null);

    const result = await submitFeedback({
      topic: topicLabel,
      message,
      email,
      intent: 'feedback',
      appVersion,
      platform: navigator.platform || 'unknown',
      userAgent: navigator.userAgent,
    });

    if (!result.ok) {
      setError(result.error);
      setStatus('error');
      return;
    }

    setSentChannel(result.channel);
    setStatus('sent');
    setMessage('');
    setEmail('');
    setTopic('idea');
    onNotify?.(
      result.channel === 'mailto'
        ? 'Opened your email app with the feedback draft'
        : 'Thanks — feedback sent',
    );
  };

  return (
    <div
      className={`modal-backdrop${sent ? ' feedback-backdrop-pass' : ''}`}
      onMouseDown={(e) => {
        if (!sent && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="export-modal feedback-modal"
        role="dialog"
        aria-modal={sent ? undefined : true}
        aria-labelledby={titleId}
      >
        <div className="modal-head">
          <div className="modal-icon" aria-hidden>
            <MessageSquarePlus size={21} />
          </div>
          <button type="button" className="modal-close" aria-label="Close feedback" onClick={onClose}>
            <X size={19} />
          </button>
        </div>

        <h2 id={titleId}>Send feedback</h2>
        <p>
          Bugs, ideas, or a quick note — it goes straight to the inbox. Optional email if you want a reply.
        </p>

        {sent ? (
          <div className="feedback-success">
            <p>
              {sentChannel === 'mailto'
                ? 'Your email app should have a draft ready — send it when you’re set.'
                : 'Thanks — your note is on its way.'}
            </p>
            <button type="button" className="button primary-button modal-full-button" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <form className="feedback-form" onSubmit={onSubmit} noValidate>
            <div className="modal-field-label">TOPIC</div>
            <div className="feedback-topic-row" role="radiogroup" aria-label="Feedback topic">
              {TOPICS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={topic === item.id}
                  className={`feedback-topic${topic === item.id ? ' is-active' : ''}`}
                  onClick={() => setTopic(item.id)}
                  disabled={status === 'sending'}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <label className="feedback-field">
              <span>Message</span>
              <textarea
                ref={messageRef}
                name="message"
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What worked, what broke, or what you’d love next…"
                required
                disabled={status === 'sending'}
              />
            </label>

            <label className="feedback-field">
              <span>Email <em>(optional)</em></span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@studio.com"
                disabled={status === 'sending'}
              />
            </label>

            {/* Honeypot — leave empty */}
            <input
              type="text"
              name="_gotcha"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              style={{ position: 'absolute', left: '-9999px', height: 0, width: 0, opacity: 0 }}
              value=""
              readOnly
            />

            {error && (
              <p className="feedback-error" role="alert">
                {error}
              </p>
            )}

            <div className="export-modal-actions">
              <button type="button" className="button subtle-button" onClick={onClose} disabled={status === 'sending'}>
                Cancel
              </button>
              <button type="submit" className="button primary-button" disabled={status === 'sending'}>
                {status === 'sending' ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
