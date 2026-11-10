import type { Vec3 } from '../types';

export type CompositionSlot = {
  position: Vec3;
  rotation: Vec3;
  scale: number;
};

/**
 * Rotato-style upright multi-device seats.
 * Negative X reclines the top edge away from camera; Y yaws the three-quarter;
 * Z stays near 0 so phones/watches read right-side up in frame.
 */
export function compositionSlots(count: number): CompositionSlot[] {
  const n = Math.max(1, Math.min(6, Math.floor(count)));
  if (n === 1) {
    return [{ position: { x: 0, y: 0.04, z: 0 }, rotation: { x: -8, y: 22, z: 0 }, scale: 1 }];
  }
  if (n === 2) {
    return [
      { position: { x: -0.62, y: 0.05, z: -0.12 }, rotation: { x: -10, y: -26, z: -2 }, scale: 0.92 },
      { position: { x: 0.68, y: 0.02, z: 0.14 }, rotation: { x: -12, y: 24, z: 2 }, scale: 0.9 },
    ];
  }
  if (n === 3) {
    return [
      { position: { x: -1.45, y: 0.04, z: -0.18 }, rotation: { x: -8, y: -28, z: -4 }, scale: 0.78 },
      { position: { x: 0, y: 0.08, z: 0.22 }, rotation: { x: -12, y: 4, z: 0 }, scale: 0.9 },
      { position: { x: 1.45, y: 0.04, z: -0.18 }, rotation: { x: -8, y: 28, z: 4 }, scale: 0.78 },
    ];
  }
  // 4–6: shallow arc, still upright
  const slots: CompositionSlot[] = [];
  const span = 1.35 + (n - 4) * 0.12;
  for (let i = 0; i < n; i += 1) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const yaw = -32 + t * 64;
    const x = -span + t * span * 2;
    const z = -0.2 + Math.sin(t * Math.PI) * 0.35;
    slots.push({
      position: { x, y: 0.04 + (i === Math.floor(n / 2) ? 0.04 : 0), z },
      rotation: { x: -10, y: yaw, z: yaw * 0.08 },
      scale: 0.7 + (1 - Math.abs(t - 0.5) * 2) * 0.12,
    });
  }
  return slots;
}

/** Next upright seat when adding a device beside an existing selection. */
export function nextCompositionSlot(
  existingCount: number,
  selected: { position: Vec3; rotation: Vec3; scale: number },
): CompositionSlot {
  const planned = compositionSlots(existingCount + 1);
  if (existingCount === 0) return planned[0];
  const slot = planned[Math.min(existingCount, planned.length - 1)];
  // Keep relative spacing from the selected device when the scene already drifted.
  return {
    position: {
      x: selected.position.x + (slot.position.x - planned[0].position.x),
      y: selected.position.y + (slot.position.y - planned[0].position.y),
      z: selected.position.z + (slot.position.z - planned[0].position.z),
    },
    rotation: {
      x: slot.rotation.x,
      y: selected.rotation.y + (slot.rotation.y - planned[0].rotation.y),
      z: slot.rotation.z,
    },
    scale: selected.scale * (slot.scale / planned[0].scale),
  };
}
