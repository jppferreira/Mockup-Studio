import { ensureFreshSession } from './supabaseClient';
import type { CheckoutSku } from '@shared/entitlementModel';

async function edgeFetch<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '');
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return { ok: false, error: 'Cloud account is not configured.' };

  const snap = await ensureFreshSession();
  if (!snap.session?.access_token) {
    return { ok: false, error: 'Sign in to continue to checkout.' };
  }

  const response = await fetch(`${url}/functions/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${snap.session.access_token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    return { ok: false, error: payload.error || `Request failed (${response.status})` };
  }
  return { ok: true, data: payload };
}

export async function startStripeCheckout(sku: CheckoutSku): Promise<
  { ok: true; url: string } | { ok: false; error: string }
> {
  const siteUrl = (import.meta.env.VITE_SITE_URL || 'https://mokstudio.io').replace(/\/$/, '');
  const result = await edgeFetch<{ url?: string }>('create-checkout', {
    sku,
    successUrl: `${siteUrl}/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${siteUrl}/pricing`,
  });
  if (!result.ok) return result;
  if (!result.data.url) return { ok: false, error: 'Checkout URL missing.' };
  return { ok: true, url: result.data.url };
}

export async function openBillingPortal(): Promise<
  { ok: true; url: string } | { ok: false; error: string }
> {
  const siteUrl = (import.meta.env.VITE_SITE_URL || 'https://mokstudio.io').replace(/\/$/, '');
  const result = await edgeFetch<{ url?: string }>('billing-portal', {
    returnUrl: `${siteUrl}/pricing`,
  });
  if (!result.ok) return result;
  if (!result.data.url) return { ok: false, error: 'Billing portal URL missing.' };
  return { ok: true, url: result.data.url };
}
