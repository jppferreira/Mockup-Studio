import { loadImageElement } from './figma';
import type { ScreenLayerPlate } from '../types';

const MAX_SCREEN_LAYERS = 16;

/** Structural containers — must never become a single extruded 3D card. */
const TOP_LEVEL_CONTAINER_TYPES = new Set([
  'FRAME',
  'GROUP',
  'SECTION',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'CANVAS',
  'DOCUMENT',
]);

/** How many ungrouped piece plates share one extrusion step. */
const EXTRUSION_SUBGROUP_SIZE = 2;

export function isTopLevelContainerPlate(
  plate: { layerType?: string; name?: string; extrusionGroup?: string },
): boolean {
  // Plates expanded out of a parent frame are subgroup pieces — never treat as
  // the parent container, even when their own type is FRAME/GROUP.
  const group = (plate.extrusionGroup || '').trim();
  if (group && group !== 'container' && group !== 'flat') return false;

  const type = (plate.layerType || '').toUpperCase();
  if (type) {
    if (TOP_LEVEL_CONTAINER_TYPES.has(type)) return true;
    if (type === 'G' || type === 'SVG') return true;
    return false;
  }
  const name = (plate.name || '').trim().toLowerCase();
  if (!name) return false;
  return /^(screen|app|page|main|root|container|background|bg|frame|group|section)\b/.test(name);
}

/** True when a Figma/SVG layer should participate in 3D explosion (name is Card / Card 1…). */
export function isExplodeCardAreaName(name: string | null | undefined): boolean {
  return /^card(?:\s*[-_.]?\s*\d+)?$/i.test((name || '').trim());
}

/** Normalize imported explode plates into durable device screen layers. */
export function normalizeScreenLayers(
  plates: {
    id?: string;
    name: string;
    dataUrl: string;
    layerType?: string;
    type?: string;
    extrusionGroup?: string;
  }[],
): ScreenLayerPlate[] {
  const out: ScreenLayerPlate[] = [];
  for (let i = 0; i < plates.length && out.length < MAX_SCREEN_LAYERS; i += 1) {
    const plate = plates[i];
    // Inline PNGs on apply; asset refs after cloud/file externalise.
    if (!plate?.dataUrl) continue;
    if (!plate.dataUrl.startsWith('data:image/') && !/^asset:sha256:[a-z0-9_]{8,128}$/i.test(plate.dataUrl)) {
      continue;
    }
    const layerType = (plate.layerType || plate.type || '').trim();
    const extrusionGroup = (plate.extrusionGroup || '').trim();
    out.push({
      id: (typeof plate.id === 'string' && plate.id) ? plate.id : `plate-${i}`,
      name: (plate.name || `Layer ${i + 1}`).slice(0, 80),
      dataUrl: plate.dataUrl,
      ...(layerType ? { layerType: layerType.slice(0, 40) } : {}),
      ...(extrusionGroup ? { extrusionGroup: extrusionGroup.slice(0, 40) } : {}),
    });
  }
  return out;
}

/**
 * Plan per-plate extrusion for already-expanded subgroup plates.
 *
 * Containers never thicken. Pieces thicken by `extrusionGroup` (from frame
 * expansion) or in buckets of two. No fallback turns parent frames into cards.
 */
export function planIncrementalExtrusion(
  plates: ScreenLayerPlate[],
  globalExtrusion: number,
): ScreenLayerPlate[] {
  if (!plates.length) return plates;
  const global = Math.min(1, Math.max(0, globalExtrusion));
  if (global < 0.001) {
    return plates.map((plate) => ({
      ...plate,
      extrusionScale: 0,
      extrusionGroup: plate.extrusionGroup
        || (isTopLevelContainerPlate(plate) ? 'container' : 'flat'),
    }));
  }

  const pieceIndexes: number[] = [];
  for (let i = 0; i < plates.length; i += 1) {
    if (!isTopLevelContainerPlate(plates[i])) pieceIndexes.push(i);
  }

  const groupOrder: string[] = [];
  const namedGroupOfIndex = new Map<number, string>();
  let allNamed = pieceIndexes.length > 0;
  for (const index of pieceIndexes) {
    const named = (plates[index].extrusionGroup || '').trim();
    if (!named) {
      allNamed = false;
      break;
    }
    if (!groupOrder.includes(named)) groupOrder.push(named);
    namedGroupOfIndex.set(index, named);
  }

  const scaleByIndex = new Map<number, { scale: number; group: string }>();
  if (allNamed && groupOrder.length > 0) {
    const subgroupCount = Math.max(1, groupOrder.length);
    for (const index of pieceIndexes) {
      const group = namedGroupOfIndex.get(index)!;
      scaleByIndex.set(index, {
        scale: (groupOrder.indexOf(group) + 1) / subgroupCount,
        group,
      });
    }
  } else {
    const subgroupCount = Math.max(1, Math.ceil(pieceIndexes.length / EXTRUSION_SUBGROUP_SIZE));
    pieceIndexes.forEach((index, order) => {
      const subgroup = Math.floor(order / EXTRUSION_SUBGROUP_SIZE);
      scaleByIndex.set(index, {
        scale: (subgroup + 1) / subgroupCount,
        group: `subgroup-${subgroup + 1}`,
      });
    });
  }

  return plates.map((plate, index) => {
    if (isTopLevelContainerPlate(plate)) {
      return { ...plate, extrusionScale: 0, extrusionGroup: 'container' };
    }
    const planned = scaleByIndex.get(index);
    if (!planned) {
      return { ...plate, extrusionScale: 0, extrusionGroup: plate.extrusionGroup || 'flat' };
    }
    return {
      ...plate,
      extrusionScale: planned.scale,
      extrusionGroup: planned.group,
    };
  });
}

/**
 * Stack transparent layer plates into one flat PNG for the device screen.
 * Unlike the 2D explode composite, plates stay aligned — depth lives in 3D.
 */
export async function compositeFlatScreenStack(
  plates: { dataUrl: string }[],
): Promise<string> {
  if (!plates.length) throw new Error('No layers to stack');
  const images = await Promise.all(plates.map((plate) => loadImageElement(plate.dataUrl)));
  const width = Math.max(...images.map((img) => img.naturalWidth || img.width), 2);
  const height = Math.max(...images.map((img) => img.naturalHeight || img.height), 2);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not composite screen layers');
  for (const img of images) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
  }
  const url = canvas.toDataURL('image/png');
  for (const img of images) img.src = '';
  return url;
}
