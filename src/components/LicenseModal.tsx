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

  if (!open) return null;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = activateLicenseKey(keyDraft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setKeyDraft('');
    onChange(result.state);
    onNotify(`Activated ${planLabel(result.state.tier)}`);
    onClose();
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
              placeholder="MS-PRO-XXXXXX or MS-PROMAX-XXXXXX"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="button primary-button">Activate</button>
          </div>
          {error && <p className="license-error">{error}</p>}
          <p className="license-hint">
            After checkout, paste the key from your email. Format: <code>MS-PRO-ABC123</code>.
          </p>
        </form>

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
