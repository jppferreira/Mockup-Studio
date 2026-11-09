import { loadImageElement } from './figma';
import type { ScreenLayerPlate } from '../types';

const MAX_SCREEN_LAYERS = 16;

/** Normalize imported explode plates into durable device screen layers. */
export function normalizeScreenLayers(
  plates: { id?: string; name: string; dataUrl: string }[],
): ScreenLayerPlate[] {
  const out: ScreenLayerPlate[] = [];
  for (let i = 0; i < plates.length && out.length < MAX_SCREEN_LAYERS; i += 1) {
    const plate = plates[i];
    if (!plate?.dataUrl?.startsWith('data:image/')) continue;
    out.push({
      id: (typeof plate.id === 'string' && plate.id) ? plate.id : `plate-${i}`,
      name: (plate.name || `Layer ${i + 1}`).slice(0, 80),
      dataUrl: plate.dataUrl,
    });
  }
  return out;
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
  return canvas.toDataURL('image/png');
}
