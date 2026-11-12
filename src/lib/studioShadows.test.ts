import { describe, expect, it } from 'vitest';
import {
  resolveFloorShadowResolution,
  resolveKeyShadowMapSize,
  resolveSceneLightShadowMapSize,
} from './studioShadows';

describe('studio shadow map sizes', () => {
  it('keeps key map size stable across interactive↔studio (no atlas thrash)', () => {
    const studio = resolveKeyShadowMapSize('auto', 'studio', false, 8192);
    const interactive = resolveKeyShadowMapSize('auto', 'interactive', false, 8192);
    expect(interactive).toBe(studio);
    expect(studio).toBe(2048);
  });

  it('keeps floor plate resolution stable across interactive↔studio', () => {
    const studio = resolveFloorShadowResolution('high', 'studio', false, 8192);
    const interactive = resolveFloorShadowResolution('high', 'interactive', false, 8192);
    expect(interactive).toBe(studio);
    expect(studio).toBe(2048);
  });

  it('keeps scene light map size stable across modes', () => {
    const studio = resolveSceneLightShadowMapSize('studio', false, 8192);
    const interactive = resolveSceneLightShadowMapSize('interactive', false, 8192);
    expect(interactive).toBe(studio);
    expect(studio).toBe(2048);
  });

  it('allows export / ultra to bump key map size', () => {
    expect(resolveKeyShadowMapSize('ultra', 'studio', true, 8192)).toBe(4096);
    expect(resolveKeyShadowMapSize('auto', 'studio', true, 8192)).toBe(4096);
  });
});
