import {
  createCompositionLayer,
  layerId,
  MAX_COMPOSITION_LAYERS,
  type CompositionLayer,
  type LayerKind,
  type MockupProject,
} from '../types';

export type { CompositionLayer, LayerKind };
export { createCompositionLayer, layerId, MAX_COMPOSITION_LAYERS };

function collectRefs(project: Pick<MockupProject, 'devices' | 'sceneProps' | 'overlays'>) {
  const props = project.sceneProps ?? [];
  const overlays = project.overlays ?? [];
  return [
    ...props.map((item) => ({ kind: 'prop' as const, refId: item.id })),
    ...project.devices.map((item) => ({ kind: 'device' as const, refId: item.id })),
    ...overlays.map((item) => ({ kind: 'overlay' as const, refId: item.id })),
  ];
}

/**
 * Keep layer order for surviving refs; append new ones in default back→front
 * order (props, devices, overlays). Drop orphaned refs.
 */
export function ensureCompositionLayers(
  project: Pick<MockupProject, 'devices' | 'sceneProps' | 'overlays' | 'layers'>,
): CompositionLayer[] {
  const refs = collectRefs(project);
  const refKey = (kind: LayerKind, refId: string) => `${kind}:${refId}`;
  const wanted = new Map(refs.map((item) => [refKey(item.kind, item.refId), item]));
  const previous = Array.isArray(project.layers) ? project.layers : [];
  const next: CompositionLayer[] = [];
  const seen = new Set<string>();

  for (const layer of previous) {
    if (layer.kind !== 'device' && layer.kind !== 'prop' && layer.kind !== 'overlay') continue;
    if (typeof layer.refId !== 'string' || !layer.refId) continue;
    const key = refKey(layer.kind, layer.refId);
    if (!wanted.has(key) || seen.has(key)) continue;
    seen.add(key);
    next.push(createCompositionLayer(layer.kind, layer.refId, {
      id: typeof layer.id === 'string' && layer.id ? layer.id : layerId(layer.kind, layer.refId),
      visible: layer.visible !== false,
    }));
  }

  for (const item of refs) {
    const key = refKey(item.kind, item.refId);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(createCompositionLayer(item.kind, item.refId));
  }

  return next.slice(0, MAX_COMPOSITION_LAYERS);
}

export function syncProjectLayers(project: MockupProject): MockupProject {
  return { ...project, layers: ensureCompositionLayers(project) };
}

export function reorderCompositionLayer(
  project: MockupProject,
  layerIdToMove: string,
  direction: 'front' | 'back' | 'forward' | 'backward',
): MockupProject {
  const layers = ensureCompositionLayers(project);
  const index = layers.findIndex((layer) => layer.id === layerIdToMove);
  if (index < 0) return syncProjectLayers(project);

  let target = index;
  if (direction === 'front') target = layers.length - 1;
  else if (direction === 'back') target = 0;
  else if (direction === 'forward') target = Math.min(layers.length - 1, index + 1);
  else target = Math.max(0, index - 1);

  if (target === index) return syncProjectLayers({ ...project, layers });

  const next = [...layers];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return { ...project, layers: next };
}

export function setCompositionLayerVisible(
  project: MockupProject,
  layerIdToToggle: string,
  visible: boolean,
): MockupProject {
  const layers = ensureCompositionLayers(project).map((layer) => (
    layer.id === layerIdToToggle ? { ...layer, visible } : layer
  ));
  return { ...project, layers };
}

export function moveCompositionLayerToIndex(
  project: MockupProject,
  layerIdToMove: string,
  toIndex: number,
): MockupProject {
  const layers = ensureCompositionLayers(project);
  const from = layers.findIndex((layer) => layer.id === layerIdToMove);
  if (from < 0) return syncProjectLayers(project);
  const clamped = Math.max(0, Math.min(layers.length - 1, toIndex));
  if (from === clamped) return { ...project, layers };
  const next = [...layers];
  const [item] = next.splice(from, 1);
  next.splice(clamped, 0, item);
  return { ...project, layers: next };
}

export function layerLabel(
  layer: CompositionLayer,
  project: Pick<MockupProject, 'devices' | 'sceneProps' | 'overlays'>,
  deviceLabel: (deviceId: string) => string,
): string {
  if (layer.kind === 'device') {
    const device = project.devices.find((item) => item.id === layer.refId);
    return device ? deviceLabel(device.deviceId) : 'Device';
  }
  if (layer.kind === 'prop') {
    const prop = (project.sceneProps ?? []).find((item) => item.id === layer.refId);
    if (!prop) return 'Prop';
    return prop.kind.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const overlay = (project.overlays ?? []).find((item) => item.id === layer.refId);
  if (!overlay) return 'Overlay';
  if (overlay.kind === 'text') {
    const text = (overlay.text || 'Text').trim();
    return text.length > 22 ? `${text.slice(0, 20)}…` : text;
  }
  return 'Image overlay';
}

/** Higher = drawn later / on top. Back layer gets 1. */
export function layerRenderOrder(layers: CompositionLayer[], layerIdValue: string): number {
  const index = layers.findIndex((layer) => layer.id === layerIdValue);
  return index < 0 ? 1 : index + 1;
}

export function sortByLayerOrder<T extends { id: string }>(
  items: T[],
  layers: CompositionLayer[],
  kind: LayerKind,
): T[] {
  const order = new Map(
    layers
      .filter((layer) => layer.kind === kind)
      .map((layer, index) => [layer.refId, index]),
  );
  return [...items].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export function filterVisibleByLayer<T extends { id: string }>(
  items: T[],
  layers: CompositionLayer[],
  kind: LayerKind,
): T[] {
  const visibility = new Map(
    layers.filter((layer) => layer.kind === kind).map((layer) => [layer.refId, layer.visible !== false]),
  );
  return items.filter((item) => visibility.get(item.id) !== false);
}

/** Overlays in stack order (back → front), skipping hidden layers. */
export function orderedVisibleOverlays(
  project: Pick<MockupProject, 'overlays' | 'layers'>,
): NonNullable<MockupProject['overlays']> {
  const overlays = project.overlays ?? [];
  const layers = ensureCompositionLayers({
    devices: [],
    sceneProps: [],
    overlays,
    layers: project.layers,
  });
  // Re-ensure with empty devices/props drops device/prop layers — rebuild properly:
  const full = Array.isArray(project.layers) ? project.layers : [];
  const byId = new Map(overlays.map((item) => [item.id, item]));
  const ordered: typeof overlays = [];
  const seen = new Set<string>();
  for (const layer of full) {
    if (layer.kind !== 'overlay' || layer.visible === false) continue;
    const item = byId.get(layer.refId);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    ordered.push(item);
  }
  for (const item of overlays) {
    if (seen.has(item.id)) continue;
    ordered.push(item);
  }
  return ordered;
}
