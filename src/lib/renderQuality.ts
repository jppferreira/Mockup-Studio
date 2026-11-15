/**
 * Product-facing render quality presets (Performance / Balanced / Ultra).
 *
 * Stored as a local editor preference — switching presets must never rewrite
 * saved compositions. Budgets feed the existing Interactive → Preview → Export
 * path in studioShadows / progressiveShadows / renderRealism / DeviceCanvas.
 */

export type RenderQualityPreset = 'performance' | 'balanced' | 'ultra';

export const RENDER_QUALITY_PRESETS: {
  id: RenderQualityPreset;
  label: string;
  hint: string;
}[] = [
  {
    id: 'performance',
    label: 'Performance',
    hint: 'Smooth editing on lighter hardware — lower DPR and softer post',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    hint: 'Best default — premium studio look at interactive frame rates',
  },
  {
    id: 'ultra',
    label: 'Ultra',
    hint: 'Previews and exports — richer shadows, post, and anti-aliasing',
  },
];

export const DEFAULT_RENDER_QUALITY: RenderQualityPreset = 'balanced';

const STORAGE_KEY = 'mokstudio.renderQuality';

/** Per-preset GPU budgets consumed by resolvers and capture. */
export type RenderQualityBudget = {
  /** Live Canvas `dpr` range. */
  liveDpr: [number, number];
  /** Idle / interactive key-light atlas (stable — no thrash on orbit). */
  previewShadowMap: number;
  /** Export / stills key-light atlas. */
  exportShadowMap: number;
  /** ContactShadows plate — live. */
  floorPreview: number;
  /** ContactShadows plate — export. */
  floorExport: number;
  /** Extra scene lights (spot / dir). */
  sceneLightPreview: number;
  sceneLightExport: number;
  /** PCSS tap counts. Interactive stays thin for every preset. */
  pcssInteractive: { blockers: number; filter: number };
  pcssStudio: { blockers: number; filter: number };
  keyBlurSamplesLive: number;
  keyBlurSamplesExport: number;
  /** Extra gl.render passes after ContactShadows remount during capture. */
  exportSettleFrames: number;
  /** Grade / capture render-target MSAA samples (0 = none). */
  exportGradeSamples: number;
  /** Multiplier applied to project AO while idle (export uses full amount). */
  idleAoScale: number;
  /** Multiplier applied to project DoF while idle (export uses full amount). */
  idleDofScale: number;
  /** Neutral studio HDRI source width before PMREM. */
  hdriWidth: number;
};

export const RENDER_QUALITY_BUDGETS: Record<RenderQualityPreset, RenderQualityBudget> = {
  performance: {
    liveDpr: [1, 1],
    previewShadowMap: 1024,
    exportShadowMap: 2048,
    floorPreview: 512,
    floorExport: 1024,
    sceneLightPreview: 512,
    sceneLightExport: 1024,
    pcssInteractive: { blockers: 4, filter: 8 },
    pcssStudio: { blockers: 10, filter: 16 },
    keyBlurSamplesLive: 2,
    keyBlurSamplesExport: 6,
    exportSettleFrames: 2,
    exportGradeSamples: 0,
    idleAoScale: 0.35,
    idleDofScale: 0,
    hdriWidth: 512,
  },
  balanced: {
    liveDpr: [1, 1.25],
    previewShadowMap: 1024,
    exportShadowMap: 4096,
    floorPreview: 1024,
    floorExport: 2048,
    sceneLightPreview: 1024,
    sceneLightExport: 2048,
    pcssInteractive: { blockers: 6, filter: 10 },
    pcssStudio: { blockers: 16, filter: 24 },
    keyBlurSamplesLive: 4,
    keyBlurSamplesExport: 10,
    exportSettleFrames: 4,
    exportGradeSamples: 0,
    idleAoScale: 1,
    idleDofScale: 1,
    hdriWidth: 1024,
  },
  ultra: {
    liveDpr: [1, 1.5],
    previewShadowMap: 2048,
    exportShadowMap: 4096,
    floorPreview: 2048,
    floorExport: 2048,
    sceneLightPreview: 2048,
    sceneLightExport: 2048,
    pcssInteractive: { blockers: 6, filter: 10 },
    pcssStudio: { blockers: 20, filter: 32 },
    keyBlurSamplesLive: 4,
    keyBlurSamplesExport: 12,
    exportSettleFrames: 8,
    exportGradeSamples: 4,
    idleAoScale: 1,
    idleDofScale: 1,
    hdriWidth: 1536,
  },
};

export function isRenderQualityPreset(value: unknown): value is RenderQualityPreset {
  return value === 'performance' || value === 'balanced' || value === 'ultra';
}

export function getRenderQualityBudget(preset: RenderQualityPreset): RenderQualityBudget {
  return RENDER_QUALITY_BUDGETS[preset] ?? RENDER_QUALITY_BUDGETS.balanced;
}

/** Read the editor preference (never part of a saved composition). */
export function loadRenderQuality(): RenderQualityPreset {
  if (typeof window === 'undefined') return DEFAULT_RENDER_QUALITY;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isRenderQualityPreset(raw)) return raw;
  } catch {
    /* private mode / denied */
  }
  return DEFAULT_RENDER_QUALITY;
}

export function saveRenderQuality(preset: RenderQualityPreset): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, preset);
  } catch {
    /* ignore */
  }
}
