import { useCallback, useEffect, useState } from 'react';
import {
  getAuthSnapshot,
  isSupabaseConfigured,
  onAuthChange,
} from '../lib/supabaseClient';
import {
  fetchAccountEntitlement,
  listDevices,
  activateThisDevice,
  deactivateDevice,
  refreshOfflineEntitlement,
  type AccountEntitlement,
  type DeviceSeat,
} from '../lib/entitlements';
import { formatGbp, loadLicense, planLabel, PLAN_PRICES_GBP, type LicenseState } from '../lib/license';
import {
  getDistributionChannel,
  supportsAppleIap,
  supportsDeviceSeats,
  supportsElectronUpdater,
  supportsStripeBilling,
} from '../lib/distribution';
import { openBillingPortal, startStripeCheckout } from '../lib/stripeCheckout';
import type { CheckoutSku } from '@shared/entitlementModel';

type UpdateStatus = {
  state: 'idle' | 'checking' | 'downloading' | 'ready' | 'error' | 'up-to-date';
  version?: string | null;
  percent?: number;
  message?: string | null;
};

async function openUrl(url: string) {
  try {
    if (window.mockupDesktop?.openExternal) {
      await window.mockupDesktop.openExternal(url);
      return;
    }
  } catch {
    /* fall through */
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export default function AccountLicencePanel({
  license,
  onLicenseChange,
  onOpenPlans,
}: {
  license: LicenseState;
  onLicenseChange: (next: LicenseState) => void;
  onOpenPlans: () => void;
}) {
  const channel = getDistributionChannel();
  const [email, setEmail] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountEntitlement | null>(null);
  const [devices, setDevices] = useState<DeviceSeat[]>([]);
  const [maxDevices, setMaxDevices] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const appVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.1.1';

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    const snap = await getAuthSnapshot();
    setEmail(snap.user?.email ?? null);
    const ent = await fetchAccountEntitlement();
    setAccount(ent);
    if (supportsDeviceSeats() && snap.user) {
      const listed = await listDevices();
      if (listed.ok) {
        setDevices(listed.devices.filter((d) => !d.revoked_at));
        setMaxDevices(listed.maxDevices);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onAuthChange(() => {
      void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    const api = window.mockupDesktop;
    if (!api?.onUpdateStatus) return undefined;
    void api.updateStatus?.().then((current) => {
      if (current) setUpdate(current);
    });
    return api.onUpdateStatus(setUpdate);
  }, []);

  const providerLabel = (() => {
    const source = account?.provider || account?.source || license.source;
    if (source === 'stripe') return 'Stripe';
    if (source === 'mas') return 'Mac App Store';
    if (source === 'key' || source === 'account') return license.source === 'key' ? 'License key' : 'Account';
    if (source === 'lemon' || source === 'paddle') return source === 'lemon' ? 'Lemon Squeezy' : 'Paddle';
    return '—';
  })();

  const statusLine = (() => {
    if (license.tier === 'free') return 'Free';
    const plan = account?.plan;
    if (plan === 'lifetime' || (!account?.periodEnd && (plan === 'pro' || plan === 'pro_max'))) {
      return `${planLabel(license.tier)} · Lifetime`;
    }
    if (plan === 'monthly') return `${planLabel(license.tier)} · Monthly`;
    if (plan === 'yearly') return `${planLabel(license.tier)} · Yearly`;
    if (plan === 'trial') return `${planLabel(license.tier)} · Trial`;
    return planLabel(license.tier);
  })();

  const renewalLine = account?.periodEnd
    ? `Access through ${new Date(account.periodEnd).toLocaleDateString()}`
    : account?.updatesUntil
      ? `Updates included until ${new Date(account.updatesUntil).toLocaleDateString()}`
      : license.updatesUntil
        ? `Updates included until ${new Date(license.updatesUntil).toLocaleDateString()}`
        : null;

  const startCheckout = async (sku: CheckoutSku) => {
    setBusy(true);
    setMessage(null);
    try {
      if (!email) {
        setMessage('Sign in to continue to checkout.');
        return;
      }
      const result = await startStripeCheckout(sku);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      await openUrl(result.url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="account-licence-panel" aria-label="Account and licence">
      <h3>Account &amp; licence</h3>
      <dl className="account-licence-grid">
        <div>
          <dt>Account</dt>
          <dd>{email ?? 'Not signed in'}</dd>
        </div>
        <div>
          <dt>Licence</dt>
          <dd>{statusLine}</dd>
        </div>
        <div>
          <dt>Provider</dt>
          <dd>{providerLabel}</dd>
        </div>
        {renewalLine && (
          <div>
            <dt>Renewal</dt>
            <dd>{renewalLine}</dd>
          </div>
        )}
        <div>
          <dt>Channel</dt>
          <dd>
            {channel === 'mac_mas'
              ? 'Mac App Store'
              : channel === 'mac_direct'
                ? 'Direct download'
                : 'Web'}
          </dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{appVersion}</dd>
        </div>
      </dl>

      <div className="account-licence-actions">
        <button type="button" className="button subtle-button" onClick={onOpenPlans}>
          View plans
        </button>

        {supportsStripeBilling() && (
          <>
            <button
              type="button"
              className="button subtle-button"
              disabled={busy || !email}
              onClick={() => void startCheckout('pro')}
            >
              Upgrade to Pro · {formatGbp(PLAN_PRICES_GBP.pro)}
            </button>
            <button
              type="button"
              className="button subtle-button"
              disabled={busy || !email}
              onClick={() => void startCheckout('pro_max')}
            >
              Upgrade to Pro Max · {formatGbp(PLAN_PRICES_GBP.pro_max)}
            </button>
            <button
              type="button"
              className="button subtle-button"
              disabled={busy || !email}
              onClick={() => void startCheckout('update_pass')}
            >
              Update Pass · {formatGbp(PLAN_PRICES_GBP.update_pass)}/year
            </button>
            <button
              type="button"
              className="button subtle-button"
              disabled={busy || !email || account?.provider !== 'stripe'}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  setMessage(null);
                  const result = await openBillingPortal();
                  setBusy(false);
                  if (!result.ok) {
                    setMessage(result.error);
                    return;
                  }
                  await openUrl(result.url);
                })();
              }}
            >
              Manage billing
            </button>
          </>
        )}

        {supportsAppleIap() && (
          <button
            type="button"
            className="button subtle-button"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true);
                setMessage(null);
                const result = await window.mockupDesktop?.restorePurchases?.();
                setBusy(false);
                if (!result?.ok) {
                  setMessage(result?.error || 'Restore Purchases is not available yet on this build.');
                  return;
                }
                setMessage('Purchases restored. Refreshing licence…');
                const next = loadLicense();
                onLicenseChange(next);
                await refresh();
              })();
            }}
          >
            Restore purchases
          </button>
        )}

        {supportsElectronUpdater() && (
          <button
            type="button"
            className="button subtle-button"
            disabled={busy || update?.state === 'downloading'}
            onClick={() => {
              void (async () => {
                setBusy(true);
                setMessage(null);
                const result = await window.mockupDesktop?.checkForUpdates?.();
                setBusy(false);
                if (!result?.ok) {
                  setMessage(result?.error || 'Could not check for updates.');
                  return;
                }
                if (result.state === 'up-to-date') setMessage('You’re on the latest version.');
                else if (result.state === 'ready') setMessage(`Update ${result.version ?? ''} is ready to install.`);
                else setMessage(null);
              })();
            }}
          >
            Check for updates
          </button>
        )}

        {update?.state === 'downloading' && (
          <p className="account-licence-note">
            Downloading update
            {typeof update.percent === 'number' ? ` ${update.percent}%` : '…'}
          </p>
        )}
        {update?.state === 'ready' && (
          <button
            type="button"
            className="button primary-button"
            onClick={() => void window.mockupDesktop?.installUpdate?.()}
          >
            Restart to update{update.version ? ` (${update.version})` : ''}
          </button>
        )}
      </div>

      {supportsDeviceSeats() && email && (
        <div className="account-licence-devices">
          <h4>Devices ({devices.length}/{maxDevices})</h4>
          <p className="account-licence-note">
            Direct-download Pro can activate up to {maxDevices} Macs. App Store installs are not limited here.
          </p>
          <ul>
            {devices.map((device) => (
              <li key={device.id}>
                <span>{device.label || 'Mac'} · {new Date(device.last_seen_at).toLocaleDateString()}</span>
                <button
                  type="button"
                  className="button subtle-button"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      setBusy(true);
                      const result = await deactivateDevice(device.id);
                      setBusy(false);
                      if (!result.ok) {
                        setMessage(result.error);
                        return;
                      }
                      await refresh();
                    })();
                  }}
                >
                  Deactivate
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="button subtle-button"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true);
                setMessage(null);
                const activated = await activateThisDevice();
                if (!activated.ok) {
                  setBusy(false);
                  setMessage(activated.error);
                  return;
                }
                const offline = await refreshOfflineEntitlement();
                setBusy(false);
                if (!offline.ok && !offline.skipped) setMessage(offline.error);
                else setMessage('This Mac is activated.');
                await refresh();
              })();
            }}
          >
            Activate this Mac
          </button>
        </div>
      )}

      {message && <p className="account-licence-note" role="status">{message}</p>}
    </section>
  );
}
