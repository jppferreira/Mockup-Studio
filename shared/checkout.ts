import { PLAN_PRICES_GBP, type PlanId } from './pricing';

/** Paid plans that can open a checkout / payment link. */
export type PaidPlanId = Exclude<PlanId, 'free'>;

export interface CheckoutConfig {
  /** Lemon Squeezy / Paddle / Stripe Payment Link URLs */
  urls: Partial<Record<PaidPlanId, string>>;
  /** Optional sales inbox when a URL is not configured yet */
  salesEmail: string;
  /** Website origin used for success redirects (no trailing slash) */
  siteUrl: string;
}

function readEnv(name: string): string | undefined {
  try {
    const value = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  } catch {
    /* non-vite contexts */
  }
  return undefined;
}

/** Runtime checkout config — set via Vite env (website + app share the same names). */
export function getCheckoutConfig(): CheckoutConfig {
  return {
    urls: {
      pro: readEnv('VITE_CHECKOUT_PRO_URL'),
      pro_max: readEnv('VITE_CHECKOUT_PRO_MAX_URL'),
      update_pass: readEnv('VITE_CHECKOUT_UPDATE_PASS_URL'),
    },
    salesEmail: readEnv('VITE_SALES_EMAIL') || 'sales@mokstudio.io',
    siteUrl: (readEnv('VITE_SITE_URL') || 'https://mokstudio.io').replace(/\/$/, ''),
  };
}

export function isCheckoutConfigured(plan: PaidPlanId, config = getCheckoutConfig()): boolean {
  return Boolean(config.urls[plan]);
}

export function checkoutHref(plan: PaidPlanId, config = getCheckoutConfig()): string {
  const url = config.urls[plan];
  if (url) return url;

  const price =
    plan === 'pro'
      ? PLAN_PRICES_GBP.pro
      : plan === 'pro_max'
        ? PLAN_PRICES_GBP.pro_max
        : PLAN_PRICES_GBP.update_pass;
  const label =
    plan === 'pro' ? 'Pro' : plan === 'pro_max' ? 'Pro Max' : 'Update Pass';
  const subject = encodeURIComponent(`Mockup Studio ${label} (£${price})`);
  const body = encodeURIComponent(
    `Hi — I'd like to buy Mockup Studio ${label} (£${price}).\n\nPlease send a checkout link or license key.\n`,
  );
  return `mailto:${config.salesEmail}?subject=${subject}&body=${body}`;
}

export function checkoutCtaLabel(plan: PaidPlanId, config = getCheckoutConfig()): string {
  if (isCheckoutConfigured(plan, config)) {
    if (plan === 'pro') return 'Buy Pro';
    if (plan === 'pro_max') return 'Buy Pro Max';
    return 'Buy Update Pass';
  }
  if (plan === 'pro') return 'Email to buy Pro';
  if (plan === 'pro_max') return 'Email to buy Pro Max';
  return 'Email for Update Pass';
}

/** Example shapes for signed offline keys (payload + Ed25519 signature). */
export const LICENSE_KEY_HINTS = {
  pro: 'MS-PRO.<payload>.<sig>',
  pro_max: 'MS-PROMAX.<payload>.<sig>',
  update_pass: 'MS-UPDATE.<payload>.<sig>',
} as const;
