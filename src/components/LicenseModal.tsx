import { useState } from 'react';
import { ExternalLink, KeyRound, Sparkles, X } from 'lucide-react';
import { type PaidPlanId } from '../lib/checkout';
import {
  PLAN_PRICES_GBP,
  PLANS,
  UPDATE_PASS,
  clearLicense,
  formatGbp,
  planLabel,
  type LicenseState,
} from '../lib/license';
import { startStripeCheckout } from '../lib/stripeCheckout';
import { ensureFreshSession } from '../lib/supabaseClient';
import { getCheckoutConfig } from '@shared/checkout';
import {
  MODEL_LICENSING_NOTICE,
  NON_AFFILIATION_DISCLAIMER,
} from '@shared/legal';

function stripeBuyLabel(plan: PaidPlanId): string {
  if (plan === 'pro') return `Buy Pro — ${formatGbp(PLAN_PRICES_GBP.pro)}`;
  if (plan === 'pro_max') return `Buy Pro Max — ${formatGbp(PLAN_PRICES_GBP.pro_max)}`;
  return `Buy Update Pass — ${formatGbp(PLAN_PRICES_GBP.update_pass)}/year`;
}

interface Props {
  open: boolean;
  license: LicenseState;
  onClose: () => void;
  onChange: (next: LicenseState) => void;
  onNotify: (message: string) => void;
}

export default function LicenseModal({ open, license, onClose, onChange, onNotify }: Props) {
  const [buying, setBuying] = useState<PaidPlanId | null>(null);

  if (!open) return null;

  const creditsUrl = `${getCheckoutConfig().siteUrl}/credits`;
  const termsUrl = `${getCheckoutConfig().siteUrl}/terms`;

  const onClear = () => {
    const next = clearLicense();
    onChange(next);
    onNotify('Back on Free plan');
  };

  const buy = async (plan: PaidPlanId) => {
    setBuying(plan);
    try {
      const snap = await ensureFreshSession();
      if (!snap.session?.access_token) {
        onNotify('Sign in to your mokstudio account to continue to checkout.');
        return;
      }

      const result = await startStripeCheckout(plan);
      if (!result.ok) {
        onNotify(result.error || 'Could not open checkout');
        return;
      }

      await openExternal(result.url);
      onNotify(
        plan === 'update_pass'
          ? 'Opened Update Pass checkout'
          : `Opened ${plan === 'pro_max' ? 'Pro Max' : 'Pro'} checkout`,
      );
    } finally {
      setBuying(null);
    }
  };

  const openExternal = async (url: string) => {
    try {
      if (window.mockupDesktop?.openExternal) {
        await window.mockupDesktop.openExternal(url);
        return;
      }
    } catch {
      /* fall through */
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="export-modal export-modal-wide license-modal" role="dialog" aria-modal="true" aria-labelledby="license-title">
        <div className="modal-head">
          <div className="modal-icon"><KeyRound size={21} /></div>
          <button className="modal-close" aria-label="Close license" onClick={onClose}><X size={19} /></button>
        </div>
        <h2 id="license-title">License & plans</h2>
        <p>
          Same prices as the website. You are on <strong>{planLabel(license.tier)}</strong>
          {license.source === 'account' ? ' · linked to your cloud account' : ''}
          {license.updatesUntil
            ? ` · updates until ${new Date(license.updatesUntil).toLocaleDateString()}`
            : ''}.
        </p>
        <p className="license-hint">
          Sign in, buy with Stripe, and Pro unlocks on this account automatically — no license key to paste.
        </p>

        <div className="license-plan-grid">
          {PLANS.map((plan) => {
            const paidId: PaidPlanId | null =
              plan.id === 'pro' || plan.id === 'pro_max' ? plan.id : null;
            const isCurrent =
              license.tier === (plan.id === 'pro_max' ? 'pro_max' : plan.id === 'pro' ? 'pro' : 'free');
            return (
              <div
                key={plan.id}
                className={`license-plan-card ${plan.highlighted ? 'is-highlighted' : ''} ${isCurrent ? 'is-current' : ''}`}
              >
                <div className="license-plan-head">
                  <strong>{plan.name}</strong>
                  <span>{plan.priceLabel}</span>
                </div>
                <p>{plan.billing}</p>
                <ul>
                  {plan.includes.slice(0, 5).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                {paidId && license.tier === 'free' && (
                  <button
                    type="button"
                    className="button primary-button license-buy-btn"
                    disabled={buying !== null}
                    onClick={() => void buy(paidId)}
                  >
                    <ExternalLink size={14} />
                    {buying === paidId ? 'Opening…' : stripeBuyLabel(paidId)}
                  </button>
                )}
                {paidId && license.tier !== 'free' && license.tier !== paidId && paidId === 'pro_max' && (
                  <button
                    type="button"
                    className="button subtle-button license-buy-btn"
                    disabled={buying !== null}
                    onClick={() => void buy('pro_max')}
                  >
                    <ExternalLink size={14} />
                    {buying === 'pro_max' ? 'Opening…' : `Upgrade to Pro Max — ${formatGbp(PLAN_PRICES_GBP.pro_max)}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="license-update-pass">
          <Sparkles size={14} />
          <div>
            <strong>{UPDATE_PASS.name} · {UPDATE_PASS.priceLabel}/year</strong>
            <span>{UPDATE_PASS.tagline}</span>
          </div>
          <button
            type="button"
            className="button subtle-button"
            disabled={buying !== null}
            onClick={() => void buy('update_pass')}
          >
            {buying === 'update_pass' ? 'Opening…' : stripeBuyLabel('update_pass')}
          </button>
        </div>

        {license.tier === 'pro_max' && (
          <p className="license-hint">
            Pro Max: use on up to 2 Macs you own, or email support to transfer. See{' '}
            <button type="button" className="license-inline-link" onClick={() => void openExternal(termsUrl)}>
              Terms
            </button>
            .
          </p>
        )}
        {license.tier === 'pro' && (
          <p className="license-hint">
            Need a second Mac? Upgrade to Pro Max for dual-Mac / transfer policy.
          </p>
        )}

        <p className="license-hint">{NON_AFFILIATION_DISCLAIMER}</p>
        <p className="license-hint">
          {MODEL_LICENSING_NOTICE}{' '}
          <button type="button" className="license-inline-link" onClick={() => void openExternal(creditsUrl)}>
            Credits
          </button>
          {' · '}
          <button type="button" className="license-inline-link" onClick={() => void openExternal(termsUrl)}>
            Terms of use
          </button>
          .
        </p>

        <div className="export-modal-actions">
          {license.tier !== 'free' && (
            <button type="button" className="button subtle-button" onClick={onClear}>
              Remove license
            </button>
          )}
          <button type="button" className="button subtle-button" onClick={onClose}>Close</button>
          <button type="button" className="button primary-button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
