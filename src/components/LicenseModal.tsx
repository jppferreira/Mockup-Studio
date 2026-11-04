import { useState, type FormEvent } from 'react';
import { ExternalLink, KeyRound, Sparkles, X } from 'lucide-react';
import {
  checkoutCtaLabel,
  openCheckout,
  type PaidPlanId,
} from '../lib/checkout';
import {
  PLAN_PRICES_GBP,
  PLANS,
  UPDATE_PASS,
  activateLicenseKey,
  clearLicense,
  formatGbp,
  planLabel,
  type LicenseState,
} from '../lib/license';
import { getCheckoutConfig } from '@shared/checkout';

interface Props {
  open: boolean;
  license: LicenseState;
  onClose: () => void;
  onChange: (next: LicenseState) => void;
  onNotify: (message: string) => void;
}

export default function LicenseModal({ open, license, onClose, onChange, onNotify }: Props) {
  const [keyDraft, setKeyDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState<PaidPlanId | null>(null);
  const [activating, setActivating] = useState(false);

  if (!open) return null;

  const creditsUrl = `${getCheckoutConfig().siteUrl}/credits`;
  const termsUrl = `${getCheckoutConfig().siteUrl}/terms`;
  const recoverUrl = `${getCheckoutConfig().siteUrl}/recover`;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void (async () => {
      setActivating(true);
      const result = await activateLicenseKey(keyDraft, license);
      setActivating(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setKeyDraft('');
      onChange(result.state);
      onNotify(
        result.state.key?.startsWith('MS-UPDATE')
          ? `Update Pass active until ${result.state.updatesUntil ? new Date(result.state.updatesUntil).toLocaleDateString() : '—'}`
          : `Activated ${planLabel(result.state.tier)}`,
      );
      onClose();
    })();
  };

  const onClear = () => {
    const next = clearLicense();
    onChange(next);
    onNotify('Back on Free plan');
  };

  const buy = async (plan: PaidPlanId) => {
    setBuying(plan);
    const result = await openCheckout(plan);
    setBuying(null);
    if (result.ok) {
      onNotify(
        plan === 'update_pass'
          ? 'Opened Update Pass checkout'
          : `Opened ${plan === 'pro_max' ? 'Pro Max' : 'Pro'} checkout — activate your key when it arrives`,
      );
    } else {
      onNotify('Could not open checkout');
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
          {license.updatesUntil
            ? ` · updates until ${new Date(license.updatesUntil).toLocaleDateString()}`
            : ''}.
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
                    {buying === paidId ? 'Opening…' : checkoutCtaLabel(paidId)}
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
                    Upgrade to Pro Max · {formatGbp(PLAN_PRICES_GBP.pro_max)}
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
            {buying === 'update_pass' ? 'Opening…' : checkoutCtaLabel('update_pass')}
          </button>
        </div>

        <form className="license-activate" onSubmit={onSubmit}>
          <label htmlFor="license-key">Activate a license key</label>
          <div className="license-activate-row">
            <input
              id="license-key"
              value={keyDraft}
              onChange={(e) => { setKeyDraft(e.target.value); setError(null); }}
              placeholder="MS-PRO.<payload>.<sig>"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="button primary-button" disabled={activating}>
              {activating ? 'Checking…' : 'Activate'}
            </button>
          </div>
          {error && <p className="license-error">{error}</p>}
          <p className="license-hint">
            After checkout, paste the signed key from your email. Lost it?{' '}
            <button type="button" className="license-inline-link" onClick={() => void openExternal(recoverUrl)}>
              Recover key
            </button>
            . Random <code>MS-PRO-…</code> strings will not unlock Pro.
          </p>
          {license.tier === 'pro_max' && (
            <p className="license-hint">
              Pro Max: activate on up to 2 Macs you own, or email support to transfer. See{' '}
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
        </form>

        <p className="license-hint">
          Device models are third-party CC BY assets —{' '}
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
