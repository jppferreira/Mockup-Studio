/**
 * Locally installed catalog templates.
 * User library starts empty — download from the Template Store.
 * Dev toolset bypasses this and sees the full master catalog.
 */

const INSTALLED_KEY = 'mockup-studio.installed-templates';

export type StorePackId =
  | 'starter-layouts'
  | 'pro-max-motion'
  | 'multi-device'
  | 'art-director'
  | 'social-studio'
  | 'desk-set';

export type StorePackMeta = {
  id: StorePackId;
  name: string;
  priceLabel: string;
  /** License / commerce gate for download. */
  tier: 'free' | 'pro' | 'pro_max' | 'addon';
  includes: string[];
  /** Catalog template ids that install with this pack. */
  templateIds: string[];
};

/** Every shipped composition belongs to exactly one downloadable pack. */
export const TEMPLATE_STORE_PACKS: Record<StorePackId, StorePackMeta> = {
  'starter-layouts': {
    id: 'starter-layouts',
    name: 'Starter Layouts',
    priceLabel: 'Free download',
    tier: 'free',
    includes: [
      'Solo & blank starters',
      'Product rotate',
      'Portrait & depth frames',
      'Watch pair',
    ],
    templateIds: [
      'solo-hero',
      'product-rotate',
      'portrait-parade',
      'depth-stage',
      'android-focus',
      'watch-pair',
      'blank',
    ],
  },
  'multi-device': {
    id: 'multi-device',
    name: 'Multi-Device Pack',
    priceLabel: 'Included with Pro',
    tier: 'pro',
    includes: [
      'Duo & trio layouts',
      'Phone + tablet pairs',
      'Launch comparison frames',
      'Shared camera angles',
    ],
    templateIds: [
      'ios-android',
      'duo-stack',
      'triple-fan',
    ],
  },
  'social-studio': {
    id: 'social-studio',
    name: 'Social Studio Pack',
    priceLabel: 'Included with Pro',
    tier: 'pro',
    includes: [
      'Story frames',
      'Feed heroes',
      'Duo posts',
      'White studio looks',
    ],
    templateIds: [
      'social-feed-hero',
      'social-story-portrait',
      'social-duo-post',
    ],
  },
  'pro-max-motion': {
    id: 'pro-max-motion',
    name: 'Pro Max Template & Motion Pack',
    priceLabel: 'Included with Pro Max',
    tier: 'pro_max',
    includes: [
      'Scenic template library',
      'Staged compositions',
      'Motion presets',
      'Pro Max lighting',
    ],
    templateIds: [
      'obsidian-plinth',
      'chrome-floor',
      'watch-still',
      'headphone-drift',
      'vision-bay',
      'launch-pair',
      'white-studio',
      'rock-lean',
      'open-stage',
    ],
  },
  'art-director': {
    id: 'art-director',
    name: 'Art Director Pack',
    priceLabel: 'Included with Pro Max',
    tier: 'pro_max',
    includes: [
      'Art-directed scenes',
      'Prop & pedestal kits',
      'Campaign lighting',
      'Portfolio grades',
    ],
    templateIds: [
      'clay-desk',
      'pedestal-stage',
      'soft-geometry',
      'brutalist-nook',
      'clay-pair',
    ],
  },
  'desk-set': {
    id: 'desk-set',
    name: 'Desk & Workspace Pack',
    priceLabel: 'Included with Pro Max',
    tier: 'pro_max',
    includes: [
      'Laptop desk scenes',
      'Concrete lean',
      'Workspace props',
      'Soft daylight looks',
    ],
    templateIds: [
      'ivory-laptop',
      'concrete-lean',
    ],
  },
};

const PACK_BY_TEMPLATE = (() => {
  const map = new Map<string, StorePackId>();
  for (const pack of Object.values(TEMPLATE_STORE_PACKS)) {
    for (const id of pack.templateIds) map.set(id, pack.id);
  }
  return map;
})();

export function packIdForTemplate(templateId: string): StorePackId | null {
  return PACK_BY_TEMPLATE.get(templateId) ?? null;
}

export function packForTemplate(templateId: string): StorePackMeta | null {
  const id = packIdForTemplate(templateId);
  return id ? TEMPLATE_STORE_PACKS[id] : null;
}

function readInstalledIds(): string[] {
  try {
    const raw = localStorage.getItem(INSTALLED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))];
  } catch {
    return [];
  }
}

function writeInstalledIds(ids: string[]) {
  localStorage.setItem(INSTALLED_KEY, JSON.stringify([...new Set(ids)].sort()));
}

/** Installed catalog template ids. Empty until the user downloads from the store. */
export function loadInstalledTemplateIds(): string[] {
  return readInstalledIds();
}

export function isTemplateInstalled(id: string): boolean {
  return readInstalledIds().includes(id);
}

export function installTemplates(ids: string[]): string[] {
  const next = [...new Set([...readInstalledIds(), ...ids.filter(Boolean)])];
  writeInstalledIds(next);
  return next;
}

export function installTemplatePack(packId: StorePackId): string[] {
  const pack = TEMPLATE_STORE_PACKS[packId];
  if (!pack) return readInstalledIds();
  return installTemplates(pack.templateIds);
}

export function uninstallTemplates(ids: string[]): string[] {
  const drop = new Set(ids);
  const next = readInstalledIds().filter((id) => !drop.has(id));
  writeInstalledIds(next);
  return next;
}

export function uninstallTemplatePack(packId: StorePackId): string[] {
  const pack = TEMPLATE_STORE_PACKS[packId];
  if (!pack) return readInstalledIds();
  return uninstallTemplates(pack.templateIds);
}

export function isPackFullyInstalled(packId: StorePackId): boolean {
  const pack = TEMPLATE_STORE_PACKS[packId];
  if (!pack?.templateIds.length) return false;
  const installed = new Set(readInstalledIds());
  return pack.templateIds.every((id) => installed.has(id));
}

export function isPackPartiallyInstalled(packId: StorePackId): boolean {
  const pack = TEMPLATE_STORE_PACKS[packId];
  if (!pack?.templateIds.length) return false;
  const installed = new Set(readInstalledIds());
  const hits = pack.templateIds.filter((id) => installed.has(id)).length;
  return hits > 0 && hits < pack.templateIds.length;
}
