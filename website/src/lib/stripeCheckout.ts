import type { PaidPlanId } from '@shared/checkout';
import { ensureFreshSession, isWebsiteAuthConfigured } from './supabaseAuth';

export async function startStripeCheckout(sku: PaidPlanId): Promise<
  { ok: true; url: string } | { ok: false; error: string; needsAuth?: boolean }
> {
  if (!isWebsiteAuthConfigured()) {
    return { ok: false, error: 'Checkout is not configured yet.' };
  }

  const url = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '');
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return { ok: false, error: 'Checkout is not configured yet.' };

  const snap = await ensureFreshSession();
  if (!snap.session?.access_token) {
    return { ok: false, error: 'Sign in to continue to checkout.', needsAuth: true };
  }

  const siteUrl = (import.meta.env.VITE_SITE_URL || 'https://mokstudio.io').replace(/\/$/, '');
  const response = await fetch(`${url}/functions/v1/create-checkout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${snap.session.access_token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sku,
      successUrl: `${siteUrl}/thanks?session_id={CHECKOUT_SESSION_ID}&plan=${sku}`,
      cancelUrl: `${siteUrl}/pricing`,
    }),
  });

  const payload = await response.json().catch(() => ({})) as { url?: string; error?: string };
  if (!response.ok) {
    return { ok: false, error: payload.error || `Request failed (${response.status})` };
  }
  if (!payload.url) return { ok: false, error: 'Checkout URL missing.' };
  return { ok: true, url: payload.url };
}
