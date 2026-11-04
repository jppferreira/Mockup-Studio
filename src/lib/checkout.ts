import {
  LICENSE_KEY_HINTS,
  checkoutCtaLabel,
  checkoutHref,
  getCheckoutConfig,
  isCheckoutConfigured,
  type PaidPlanId,
} from '@shared/checkout';

export {
  LICENSE_KEY_HINTS,
  checkoutCtaLabel,
  checkoutHref,
  getCheckoutConfig,
  isCheckoutConfigured,
};
export type { PaidPlanId };

/** Open Lemon Squeezy / Paddle / Stripe checkout (or mailto fallback) in the system browser. */
export async function openCheckout(plan: PaidPlanId): Promise<{ ok: boolean; href: string }> {
  const href = checkoutHref(plan);
  try {
    if (window.mockupDesktop?.openExternal) {
      await window.mockupDesktop.openExternal(href);
      return { ok: true, href };
    }
    window.open(href, '_blank', 'noopener,noreferrer');
    return { ok: true, href };
  } catch {
    return { ok: false, href };
  }
}
