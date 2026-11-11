/**
 * Client-side Stripe mode + publishable key selection.
 * Secret keys never live here — checkout still goes through Supabase Edge Functions.
 *
 * VITE_STRIPE_MODE=test|live (default: test)
 * VITE_STRIPE_PUBLISHABLE_KEY_TEST=pk_test_...
 * VITE_STRIPE_PUBLISHABLE_KEY_LIVE=pk_live_...
 */

export type StripeMode = 'test' | 'live';

export function stripeMode(): StripeMode {
  const raw = String(import.meta.env.VITE_STRIPE_MODE || 'test').trim().toLowerCase();
  return raw === 'live' ? 'live' : 'test';
}

export function stripePublishableKey(mode: StripeMode = stripeMode()): string | undefined {
  if (mode === 'live') {
    const live = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY_LIVE?.trim();
    return live || undefined;
  }
  const test =
    import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY_TEST?.trim() ||
    import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY?.trim();
  return test || undefined;
}

export function isStripePublishableConfigured(mode: StripeMode = stripeMode()): boolean {
  return Boolean(stripePublishableKey(mode));
}
