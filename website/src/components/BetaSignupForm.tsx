import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { submitBetaSignup } from '../lib/betaSignup';

interface Props {
  source: string;
  id?: string;
  className?: string;
  /** Inline page form stays side-by-side; modal stacks the field and button. */
  layout?: 'inline' | 'stack';
}

export function BetaSignupForm({
  source,
  id = 'beta-email',
  className,
  layout = 'inline',
}: Props) {
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [trap, setTrap] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const consentId = `${id}-consent`;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!consent) {
      setStatus('error');
      setMessage('Please agree to the privacy notice before joining.');
      return;
    }
    if (trap.trim()) {
      setStatus('sent');
      setMessage('You’re on the list. We’ll email you when the beta build is ready.');
      setEmail('');
      setConsent(false);
      return;
    }

    setStatus('sending');
    setMessage(null);
    const result = await submitBetaSignup(email, source, true);
    if (!result.ok) {
      setStatus('error');
      setMessage(result.error);
      return;
    }
    setStatus('sent');
    setMessage(
      result.already
        ? 'You’re already on the list. We’ll email you when the beta build is ready.'
        : 'You’re on the list. We’ll email you when the beta build is ready.',
    );
    setEmail('');
    setConsent(false);
  };

  if (status === 'sent' && message) {
    return (
      <p className="beta-success" role="status">
        {message}
      </p>
    );
  }

  const formClass = [
    'beta-form',
    layout === 'stack' ? 'beta-form-stack' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <form className={formClass} onSubmit={onSubmit} noValidate>
      <div className="beta-row">
        <label className="beta-field" htmlFor={id}>
          <span className="sr-only">Email</span>
          <input
            id={id}
            type="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@studio.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={status === 'sending'}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={status === 'sending' || !consent}>
          {status === 'sending' ? 'Joining…' : 'Sign up to beta'}
        </button>
      </div>
      <label className="beta-trap" aria-hidden="true">
        Company
        <input
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          value={trap}
          onChange={(event) => setTrap(event.target.value)}
        />
      </label>
      <label className="beta-consent" htmlFor={consentId}>
        <input
          id={consentId}
          type="checkbox"
          name="consent"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          required
          disabled={status === 'sending'}
        />
        <span>
          I agree to mokstudio storing this email so it can send me the beta build. I can withdraw at any time.
          See the <Link to="/privacy#beta-signup">privacy notice</Link>.
        </span>
      </label>
      {message && status === 'error' ? (
        <p className="beta-error" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  );
}
