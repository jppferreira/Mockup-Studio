/**
 * Shrink large still images before cloud sync.
 * Canvas re-encode only — videos and non-images pass through unchanged.
 */

import type { DeviceInstance, MockupProject, SceneStage } from '../types';

/** Longest edge after resize. Device screens stay sharp enough past this. */
export const CLOUD_IMAGE_MAX_EDGE = 2048;
/** Only bother when the data URL is already bulky. */
export const CLOUD_IMAGE_MIN_CHARS = 120_000;
const WEBP_QUALITY = 0.82;
const JPEG_QUALITY = 0.85;

function isImageDataUrl(value: string): boolean {
  return /^data:image\/(png|jpeg|jpg|webp|gif|bmp)/i.test(value);
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode image for compression'));
    image.src = dataUrl;
  });
}

/**
 * Re-encode a large image data URL to a smaller WebP/JPEG (resized if needed).
 * Returns the original when compression is unavailable or does not help.
 */
export async function compressImageDataUrl(dataUrl: string): Promise<string> {
  if (typeof dataUrl !== 'string' || !isImageDataUrl(dataUrl)) return dataUrl;
  if (dataUrl.length < CLOUD_IMAGE_MIN_CHARS) return dataUrl;
  if (typeof document === 'undefined' || typeof Image === 'undefined') return dataUrl;

  try {
    const image = await loadImage(dataUrl);
    const width = Math.max(1, image.naturalWidth || image.width || 1);
    const height = Math.max(1, image.naturalHeight || image.height || 1);
    const scale = Math.min(1, CLOUD_IMAGE_MAX_EDGE / Math.max(width, height));
    const nextW = Math.max(1, Math.round(width * scale));
    const nextH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = nextW;
    canvas.height = nextH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(image, 0, 0, nextW, nextH);

    let encoded = '';
    try {
      encoded = canvas.toDataURL('image/webp', WEBP_QUALITY);
    } catch {
      encoded = '';
    }
    if (!encoded.startsWith('data:image/webp')) {
      try {
        encoded = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      } catch {
        encoded = '';
      }
    }
    if (!encoded.startsWith('data:image/')) return dataUrl;
    // Keep the original when the re-encode did not meaningfully shrink.
    if (encoded.length >= dataUrl.length * 0.92) return dataUrl;
    return encoded;
  } catch {
    return dataUrl;
  }
}

async function compressMaybe(value: string | null | undefined): Promise<string | null | undefined> {
  if (typeof value !== 'string') return value;
  if (!isImageDataUrl(value)) return value;
  return compressImageDataUrl(value);
}

async function compressMaterialTweaks(
  tweaks: DeviceInstance['materialTweaks'],
): Promise<DeviceInstance['materialTweaks']> {
  if (!tweaks) return tweaks;
  const entries = await Promise.all(Object.entries(tweaks).map(async ([name, tweak]) => {
    if (!tweak || typeof tweak !== 'object') return [name, tweak] as const;
    const next = { ...tweak };
    for (const key of Object.keys(next)) {
      const value = next[key];
      if (typeof value !== 'string' || !isImageDataUrl(value)) continue;
      next[key] = await compressImageDataUrl(value);
    }
    return [name, next] as const;
  }));
  return Object.fromEntries(entries);
}

async function compressDevice(device: DeviceInstance): Promise<DeviceInstance> {
  const screenshot = await compressMaybe(device.screenshot);
  const screenLayers = device.screenLayers
    ? await Promise.all(device.screenLayers.map(async (layer) => ({
      ...layer,
      dataUrl: await compressImageDataUrl(layer.dataUrl),
    })))
    : device.screenLayers;
  const materialTweaks = await compressMaterialTweaks(device.materialTweaks);
  return {
    ...device,
    screenshot: screenshot ?? null,
    screenLayers,
    materialTweaks,
  };
}

async function compressStage(stage: SceneStage): Promise<SceneStage> {
  const devices = await Promise.all((stage.devices ?? []).map(compressDevice));
  const overlays = await Promise.all((stage.overlays ?? []).map(async (overlay) => ({
    ...overlay,
    imageData: (await compressMaybe(overlay.imageData)) ?? null,
  })));
  const reflectionMapImage = await compressMaybe(stage.reflectionMapImage);
  return {
    ...stage,
    devices,
    overlays,
    reflectionMapImage: reflectionMapImage ?? null,
  };
}

/** Compress every still image data URL on a project before cloud externalise. */
export async function compressSceneImagesForCloud(project: MockupProject): Promise<MockupProject> {
  const devices = await Promise.all((project.devices ?? []).map(compressDevice));
  const overlays = await Promise.all((project.overlays ?? []).map(async (overlay) => ({
    ...overlay,
    imageData: (await compressMaybe(overlay.imageData)) ?? null,
  })));
  const reflectionMapImage = await compressMaybe(project.reflectionMapImage);
  const screenshot = await compressMaybe(project.screenshot);
  const scenes = await Promise.all((project.scenes ?? []).map(async (scene) => (
    scene.stage ? { ...scene, stage: await compressStage(scene.stage) } : scene
  )));
  return {
    ...project,
    screenshot: screenshot ?? null,
    reflectionMapImage: reflectionMapImage ?? null,
    devices,
    overlays,
    scenes,
  };
}
