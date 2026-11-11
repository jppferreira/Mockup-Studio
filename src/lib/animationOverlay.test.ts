import { describe, expect, it } from 'vitest';
import {
  createKeyframe,
  createTrack,
  evaluateAnimationOverlayProps,
} from './animation';
import { createDefaultAnimation, type DeviceInstance } from '../types';

function device(partial?: Partial<DeviceInstance>): DeviceInstance {
  return {
    id: 'device-main',
    deviceId: 'iphone-16-pro',
    rotation: { x: 0, y: 0, z: 0 },
    position: { x: 0, y: 0, z: 0 },
    scale: 1,
    glassReflection: 0.5,
    reflectionStyle: 'glossy',
    lidOpen: 1,
    layerExplosion: 0,
    layerExtrusion: 0,
    ...partial,
  };
}

describe('evaluateAnimationOverlayProps', () => {
  it('samples lid and layer tracks without touching transforms', () => {
    const clip = {
      ...createDefaultAnimation('device-main'),
      tracks: [
        createTrack('device-main', 'position.x', [createKeyframe(0, 0), createKeyframe(1, 5)]),
        createTrack('device-main', 'lidOpen', [createKeyframe(0, 1), createKeyframe(1, 0)]),
        createTrack('device-main', 'layerExplosion', [createKeyframe(0, 0), createKeyframe(1, 1)]),
        createTrack('device-main', 'layerExtrusion', [createKeyframe(0, 0), createKeyframe(1, 0.8)]),
      ],
    };
    const base = device({ position: { x: 2, y: 3, z: 4 }, scale: 1.25 });
    const next = evaluateAnimationOverlayProps([base], clip, 1)[0];
    expect(next.position).toEqual({ x: 2, y: 3, z: 4 });
    expect(next.scale).toBe(1.25);
    expect(next.lidOpen).toBe(0);
    expect(next.layerExplosion).toBe(1);
    expect(next.layerExtrusion).toBe(0.8);
  });
});
