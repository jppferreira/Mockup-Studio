import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RENDER_QUALITY,
  getRenderQualityBudget,
  isRenderQualityPreset,
  RENDER_QUALITY_BUDGETS,
  RENDER_QUALITY_PRESETS,
} from './renderQuality';

describe('render quality presets', () => {
  it('defaults to Balanced', () => {
    expect(DEFAULT_RENDER_QUALITY).toBe('balanced');
    expect(RENDER_QUALITY_PRESETS.map((p) => p.id)).toEqual([
      'performance',
      'balanced',
      'ultra',
    ]);
  });

  it('keeps interactive PCSS thinner than studio for every preset', () => {
    for (const id of Object.keys(RENDER_QUALITY_BUDGETS) as Array<keyof typeof RENDER_QUALITY_BUDGETS>) {
      const budget = getRenderQualityBudget(id);
      expect(budget.pcssInteractive.blockers).toBeLessThanOrEqual(budget.pcssStudio.blockers);
      expect(budget.pcssInteractive.filter).toBeLessThanOrEqual(budget.pcssStudio.filter);
      expect(budget.previewShadowMap).toBeLessThanOrEqual(budget.exportShadowMap);
      expect(budget.liveDpr[0]).toBeLessThanOrEqual(budget.liveDpr[1]);
    }
  });

  it('validates preset ids', () => {
    expect(isRenderQualityPreset('balanced')).toBe(true);
    expect(isRenderQualityPreset('nope')).toBe(false);
  });
});
