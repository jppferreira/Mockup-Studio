/**
 * Single source of truth for mokstudio pricing + entitlements.
 * Used by the marketing website and the desktop app so prices / “what you get” stay in sync.
 */

export type PlanId = 'free' | 'pro' | 'pro_max' | 'update_pass';

export interface PlanFeature {
  label: string;
  /** false = explicitly not included (shown as a dash / locked) */
  included: boolean;
  note?: string;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  tagline: string;
  /** Display price string, GBP */
  priceLabel: string;
  /** Numeric GBP amount for checkout UIs (0 for free) */
  priceGbp: number;
  /** Billing hint under the price */
  billing: string;
  /** Highlight as the recommended / hero SKU */
  highlighted?: boolean;
  cta: string;
  /** Short bullets for cards */
  includes: string[];
  /** Comparison-matrix rows */
  features: PlanFeature[];
}

export const PRICING_CURRENCY = 'GBP' as const;
export const PRICING_TAGLINE =
  'Rotato’s serious Mac alternative — buy once, keep forever. No subscription required.';

/** Canonical list prices (GBP). Change here; website + app both read this. */
export const PLAN_PRICES_GBP = {
  free: 0,
  pro: 49,
  pro_max: 99,
  update_pass: 29,
} as const;

export const FREE_DEVICE_IDS = [
  'iphone_15_pro_max',
  'galaxy_s26_ultra',
] as const;

export const ENTITLEMENTS = {
  free: {
    maxDevicesInScene: 1,
    maxStillLongEdge: 1920,
    videoExport: false,
    videoWatermark: true,
    allDevices: false,
    multiDevice: false,
    commercialUse: false,
    proMaxTemplates: false,
    dualMac: false,
    updateMonths: 0,
  },
  pro: {
    maxDevicesInScene: 6,
    maxStillLongEdge: 4096,
    videoExport: true,
    videoWatermark: false,
    allDevices: true,
    multiDevice: true,
    commercialUse: true,
    proMaxTemplates: false,
    dualMac: false,
    updateMonths: 12,
  },
  pro_max: {
    maxDevicesInScene: 6,
    maxStillLongEdge: 4096,
    videoExport: true,
    videoWatermark: false,
    allDevices: true,
    multiDevice: true,
    commercialUse: true,
    proMaxTemplates: true,
    dualMac: true,
    updateMonths: 12,
  },
} as const;

export type LicenseTier = keyof typeof ENTITLEMENTS;

const SHARED_MATRIX_ORDER = [
  'Compose in the full editor',
  'Phones unlocked',
  'Devices per scene',
  'PNG export',
  'MP4 / GIF export',
  'Templates & scene presets',
  'Commercial use',
  'Updates included',
  'Pro Max template pack',
  '2 Macs / license transfer',
] as const;

function matrixFor(
  values: Record<(typeof SHARED_MATRIX_ORDER)[number], Omit<PlanFeature, 'label'>>,
): PlanFeature[] {
  return SHARED_MATRIX_ORDER.map((label) => ({ ...values[label], label }));
}

export const PLANS: PlanDefinition[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Try the studio. Learn the workflow.',
    priceLabel: '£0',
    priceGbp: PLAN_PRICES_GBP.free,
    billing: 'Forever free',
    cta: 'Sign up to beta',
    includes: [
      'Full editor to compose and frame',
      '2 flagship phones (iPhone + Galaxy)',
      '1 device per scene',
      'PNG export up to Full HD (1080p)',
      'Starter templates',
      'Personal use only',
    ],
    features: matrixFor({
      'Compose in the full editor': { included: true },
      'Phones unlocked': { included: true, note: '2 flagship phones' },
      'Devices per scene': { included: true, note: '1' },
      'PNG export': { included: true, note: 'Up to Full HD' },
      'MP4 / GIF export': { included: false, note: 'Upgrade to Pro' },
      'Templates & scene presets': { included: true, note: 'Starter set' },
      'Commercial use': { included: false },
      'Updates included': { included: true, note: 'App updates' },
      'Pro Max template pack': { included: false },
      '2 Macs / license transfer': { included: false },
    }),
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'The plan most designers need.',
    priceLabel: `£${PLAN_PRICES_GBP.pro}`,
    priceGbp: PLAN_PRICES_GBP.pro,
    billing: 'One-time · keep forever',
    highlighted: true,
    cta: 'Buy Pro',
    includes: [
      'Everything in Free',
      'All phones (iPhone, Pixel, Galaxy)',
      'Multi-device scenes (up to 6)',
      'Full-res PNG · App Store sizes',
      'MP4 + GIF export',
      'Full templates & presets',
      'Commercial use',
      '12 months of device & feature updates',
    ],
    features: matrixFor({
      'Compose in the full editor': { included: true },
      'Phones unlocked': { included: true, note: 'Full library' },
      'Devices per scene': { included: true, note: 'Up to 6' },
      'PNG export': { included: true, note: 'Full-res & App Store' },
      'MP4 / GIF export': { included: true },
      'Templates & scene presets': { included: true, note: 'Full library' },
      'Commercial use': { included: true },
      'Updates included': { included: true, note: '12 months' },
      'Pro Max template pack': { included: false },
      '2 Macs / license transfer': { included: false },
    }),
  },
  {
    id: 'pro_max',
    name: 'Pro Max',
    tagline: 'For agencies and heavy motion work.',
    priceLabel: `£${PLAN_PRICES_GBP.pro_max}`,
    priceGbp: PLAN_PRICES_GBP.pro_max,
    billing: 'One-time · keep forever',
    cta: 'Buy Pro Max',
    includes: [
      'Everything in Pro',
      'Biggest template & motion pack',
      'Priority access to new device drops',
      '2 Macs or easy license transfer',
      '12 months of updates',
    ],
    features: matrixFor({
      'Compose in the full editor': { included: true },
      'Phones unlocked': { included: true, note: 'Full library' },
      'Devices per scene': { included: true, note: 'Up to 6' },
      'PNG export': { included: true, note: 'Full-res & App Store' },
      'MP4 / GIF export': { included: true },
      'Templates & scene presets': { included: true, note: 'Full + Pro Max pack' },
      'Commercial use': { included: true },
      'Updates included': { included: true, note: '12 months' },
      'Pro Max template pack': { included: true },
      '2 Macs / license transfer': { included: true },
    }),
  },
];

export const UPDATE_PASS: PlanDefinition = {
  id: 'update_pass',
  name: 'Update Pass',
  tagline: 'Optional after year one — new devices & major features.',
  priceLabel: `£${PLAN_PRICES_GBP.update_pass}`,
  priceGbp: PLAN_PRICES_GBP.update_pass,
  billing: 'Per year · app keeps working without it',
  cta: 'Renew updates',
  includes: [
    'New device models as phones launch',
    'Major feature drops',
    'New templates',
    'Not required to keep using what you already bought',
  ],
  features: [],
};

export const BUYER_GUIDE = [
  { who: 'Trying it / student', plan: 'Free' },
  { who: 'Freelancer / indie / in-house', plan: 'Pro' },
  { who: 'Agency / heavy motion', plan: 'Pro Max' },
  { who: 'Year 2+ new devices', plan: 'Update Pass' },
] as const;

export function planById(id: PlanId): PlanDefinition {
  if (id === 'update_pass') return UPDATE_PASS;
  return PLANS.find((p) => p.id === id) ?? PLANS[0];
}

export function formatGbp(amount: number): string {
  if (amount === 0) return '£0';
  return `£${amount}`;
}

/** Upgrade copy used in-app when a Free user hits a Pro gate. */
export function upgradeCopy(feature: string): string {
  return `${feature} is included in Pro (${formatGbp(PLAN_PRICES_GBP.pro)} one-time).`;
}
