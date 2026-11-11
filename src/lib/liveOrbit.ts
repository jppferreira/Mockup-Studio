import type { Vec3 } from '../types';

export type LiveOrbit = { offset: Vec3; lookOffset?: Vec3 };

type Listener = (orbit: LiveOrbit) => void;

let latest: LiveOrbit | null = null;
const listeners = new Set<Listener>();

/** Publish a live dual-pane orbit without going through React state. */
export function publishLiveOrbit(orbit: LiveOrbit) {
  latest = orbit;
  listeners.forEach((listener) => listener(orbit));
}

export function readLiveOrbit() {
  return latest;
}

export function subscribeLiveOrbit(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearLiveOrbit() {
  latest = null;
}
