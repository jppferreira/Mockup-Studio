import type { Vec3 } from '../types';

/** Uniform footprint scale (X/Z) — Extrude stretches height separately. */
export function propFootprintScale(scale: number | Vec3): number {
  if (typeof scale === 'number') return scale;
  return (Math.abs(scale.x) + Math.abs(scale.z)) / 2 || 1;
}

/** Height multiplier vs footprint. 1 = proportional; >1 stretches up. */
export function propExtrusion(scale: number | Vec3): number {
  if (typeof scale === 'number') return 1;
  const foot = propFootprintScale(scale);
  if (foot < 1e-6) return 1;
  return Math.abs(scale.y) / foot;
}

export function withPropFootprintScale(scale: number | Vec3, footprint: number): number | Vec3 {
  const next = Math.min(4, Math.max(0.15, footprint));
  const extrude = propExtrusion(scale);
  if (Math.abs(extrude - 1) < 0.001) return next;
  return { x: next, y: next * extrude, z: next };
}

export function withPropExtrusion(scale: number | Vec3, extrusion: number): number | Vec3 {
  const foot = propFootprintScale(scale);
  const next = Math.min(4, Math.max(0.15, extrusion));
  if (Math.abs(next - 1) < 0.001) return foot;
  return { x: foot, y: foot * next, z: foot };
}
