import { useState } from 'react';
import type { PaidPlanId } from '@shared/checkout';
import { startStripeCheckout } from '../lib/stripeCheckout';
import { ensureFreshSession, isWebsiteAuthConfigured } from '../lib/supabaseAuth';
import { CheckoutAuthModal } from './CheckoutAuthModal';

interface Props {
  plan: PaidPlanId;
  className?: string;
  children?: string;
}

function buyLabel(plan: PaidPlanId): string {
  if (plan === 'pro') return 'Buy Pro';
  if (plan === 'pro_max') return 'Buy Pro Max';
  return 'Buy Update Pass';
}

export function CheckoutButton({ plan, className = 'btn btn-primary', children }: Props) {
  const [authOpen, setAuthOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = isWebsiteAuthConfigured();
  const label = children ?? buyLabel(plan);

  const onBuy = async () => {
    setError(null);
    if (!configured) {
      setError('Checkout isn’t configured yet. Add Supabase env vars to enable Stripe.');
      return;
    }

    setBusy(true);
    const snap = await ensureFreshSession();
    if (!snap.session?.access_token) {
      setBusy(false);
      setAuthOpen(true);
      return;
    }

    const result = await startStripeCheckout(plan);
    if (!result.ok) {
      setBusy(false);
      if (result.needsAuth) {
        setAuthOpen(true);
        return;
      }
      setError(result.error);
      return;
    }
    window.location.assign(result.url);
  };

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => void onBuy()}
        disabled={busy}
        data-checkout-plan={plan}
        data-checkout-ready={configured ? 'true' : 'false'}
        aria-busy={busy}
      >
        {busy ? 'Opening…' : label}
      </button>
      {error ? (
        <p className="checkout-button-error" role="alert">
          {error}
        </p>
      ) : null}
      <CheckoutAuthModal open={authOpen} plan={plan} onClose={() => setAuthOpen(false)} />
    </>
  );
}
