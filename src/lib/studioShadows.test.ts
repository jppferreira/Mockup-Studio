import { describe, expect, it } from 'vitest';
import {
  resolveFloorShadowResolution,
  resolveKeyShadowMapSize,
  resolveSceneLightShadowMapSize,
  SHADOW_MAP_BUDGET,
} from './studioShadows';

describe('studio shadow map sizes', () => {
  it('keeps key map size stable across interactive↔studio (no atlas thrash)', () => {
    const studio = resolveKeyShadowMapSize('auto', 'studio', false, 8192);
    const interactive = resolveKeyShadowMapSize('auto', 'interactive', false, 8192);
    expect(interactive).toBe(studio);
    expect(studio).toBe(SHADOW_MAP_BUDGET.preview);
  });

  it('keeps floor plate resolution stable across interactive↔studio', () => {
    const studio = resolveFloorShadowResolution('auto', 'studio', false, 8192);
    const interactive = resolveFloorShadowResolution('auto', 'interactive', false, 8192);
    expect(interactive).toBe(studio);
    expect(studio).toBe(SHADOW_MAP_BUDGET.preview);
  });

  it('keeps scene light map size stable across modes', () => {
    const studio = resolveSceneLightShadowMapSize('studio', false, 8192);
    const interactive = resolveSceneLightShadowMapSize('interactive', false, 8192);
    expect(interactive).toBe(studio);
    expect(studio).toBe(SHADOW_MAP_BUDGET.preview);
  });

  it('allows export / ultra to bump key map size', () => {
    expect(resolveKeyShadowMapSize('ultra', 'studio', true, 8192)).toBe(4096);
    expect(resolveKeyShadowMapSize('auto', 'studio', true, 8192)).toBe(4096);
  });
});
