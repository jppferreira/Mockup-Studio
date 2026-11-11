import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { KeyRound, X } from 'lucide-react';
import type { PaidPlanId } from '@shared/checkout';
import { PLAN_PRICES_GBP, formatGbp, planById } from '@shared/pricing';
import { startStripeCheckout } from '../lib/stripeCheckout';
import { requestEmailOtp, verifyEmailOtp } from '../lib/supabaseAuth';

interface Props {
  open: boolean;
  plan: PaidPlanId;
  onClose: () => void;
}

function planCheckoutLabel(plan: PaidPlanId): string {
  if (plan === 'pro_max') return `Pro Max · ${formatGbp(PLAN_PRICES_GBP.pro_max)}`;
  if (plan === 'update_pass') return `Update Pass · ${formatGbp(PLAN_PRICES_GBP.update_pass)}/year`;
  return `Pro · ${formatGbp(PLAN_PRICES_GBP.pro)}`;
}

export function CheckoutAuthModal({ open, plan, onClose }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhase('email');
    setCode('');
    setMessage(null);
    setBusy(false);
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
  }, [open, onClose, plan]);

  if (!open) return null;

  const planMeta = planById(plan);

  const continueToCheckout = async () => {
    setBusy(true);
    setMessage(null);
    const result = await startStripeCheckout(plan);
    if (!result.ok) {
      setBusy(false);
      setMessage(result.error);
      return;
    }
    window.location.assign(result.url);
  };

  const onSendCode = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await requestEmailOtp(email);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setPhase('code');
    setMessage('Check your email for a one-time sign-in code.');
  };

  const onVerify = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await verifyEmailOtp(email, code);
    if (!result.ok) {
      setBusy(false);
      setMessage(result.error);
      return;
    }
    setMessage('Signed in — opening Stripe Checkout…');
    await continueToCheckout();
  };

  return (
    <div
      className="contact-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
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
            <KeyRound size={20} />
          </div>
          <button
            type="button"
            className="contact-modal-close"
            aria-label="Close sign in"
            onClick={onClose}
            disabled={busy}
          >
            <X size={18} />
          </button>
        </div>

        <h2 id={titleId}>Sign in to buy {planMeta.name}</h2>
        <p className="contact-modal-lede">
          Create or sign in to your mokstudio account, then continue to Stripe for{' '}
          {planCheckoutLabel(plan)}. Your licence unlocks on this account after payment.
        </p>

        {phase === 'email' ? (
          <form className="beta-form beta-form-stack" onSubmit={(e) => void onSendCode(e)}>
            <label htmlFor="checkout-auth-email">Email</label>
            <input
              id="checkout-auth-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@studio.com"
              disabled={busy}
            />
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Sending…' : 'Email me a code'}
            </button>
          </form>
        ) : (
          <form className="beta-form beta-form-stack" onSubmit={(e) => void onVerify(e)}>
            <label htmlFor="checkout-auth-code">One-time code</label>
            <input
              id="checkout-auth-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              disabled={busy}
            />
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Opening checkout…' : 'Verify & continue to Stripe'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                setPhase('email');
                setCode('');
                setMessage(null);
              }}
            >
              Use a different email
            </button>
          </form>
        )}

        {message ? <p className="contact-modal-lede" role="status">{message}</p> : null}
      </div>
    </div>
  );
}
