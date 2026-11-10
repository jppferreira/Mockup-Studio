import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLOUD_IMAGE_MIN_CHARS,
  compressImageDataUrl,
  compressSceneImagesForCloud,
} from './compressImage';
import { cloudSyncPayload, MAX_STATE_CHARS } from './cloudProjects';
import { externalizeSceneAssets } from './sceneDocument';
import { createDeviceInstance, DEFAULT_PROJECT, type MockupProject } from '../types';

function bigPngDataUrl(fill: string, chars: number) {
  return `data:image/png;base64,${fill.repeat(Math.max(1, Math.ceil(chars / fill.length)))}`.slice(0, chars);
}

describe('compressImageDataUrl', () => {
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;

  beforeEach(() => {
    class FakeImage {
      naturalWidth = 4000;
      naturalHeight = 3000;
      width = 4000;
      height = 3000;
      onload: ((ev?: unknown) => void) | null = null;
      onerror: ((ev?: unknown) => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.(undefined));
      }
    }
    vi.stubGlobal('Image', FakeImage);

    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: vi.fn(),
      }),
      toDataURL: (mime: string) => {
        if (mime === 'image/webp') return `data:image/webp;base64,${'w'.repeat(8_000)}`;
        return `data:image/jpeg;base64,${'j'.repeat(10_000)}`;
      },
    };
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag === 'canvas') return canvas;
        throw new Error(`Unexpected element ${tag}`);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalImage) vi.stubGlobal('Image', originalImage);
    if (originalDocument) vi.stubGlobal('document', originalDocument);
  });

  it('leaves small images alone', async () => {
    const small = 'data:image/png;base64,abc';
    expect(await compressImageDataUrl(small)).toBe(small);
  });

  it('re-encodes a large image to a smaller data URL', async () => {
    const huge = bigPngDataUrl('A', CLOUD_IMAGE_MIN_CHARS + 40_000);
    const out = await compressImageDataUrl(huge);
    expect(out.startsWith('data:image/webp')).toBe(true);
    expect(out.length).toBeLessThan(huge.length * 0.5);
  });

  it('passes through non-image data URLs', async () => {
    const video = `data:video/mp4;base64,${'v'.repeat(CLOUD_IMAGE_MIN_CHARS + 10_000)}`;
    expect(await compressImageDataUrl(video)).toBe(video);
  });
});

describe('compressSceneImagesForCloud + sync payload', () => {
  beforeEach(() => {
    class FakeImage {
      naturalWidth = 3600;
      naturalHeight = 2400;
      width = 3600;
      height = 2400;
      onload: ((ev?: unknown) => void) | null = null;
      onerror: ((ev?: unknown) => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.(undefined));
      }
    }
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag !== 'canvas') throw new Error(`Unexpected element ${tag}`);
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: vi.fn() }),
          toDataURL: () => `data:image/webp;base64,${'c'.repeat(6_000)}`,
        };
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lets a previously oversized project pass the cloud size check after compression', async () => {
    const huge = bigPngDataUrl('B', 1_400_000);
    const device = createDeviceInstance({
      ...DEFAULT_PROJECT.devices[0],
      screenshot: huge,
    });
    const project = {
      ...DEFAULT_PROJECT,
      screenshot: huge,
      devices: [device],
      selectedDeviceId: device.id,
      overlays: [{
        id: 'frame',
        kind: 'image',
        x: 0.5,
        y: 0.5,
        scale: 1,
        opacity: 1,
        startTime: 0,
        endTime: 4,
        imageData: huge,
      }],
    } as unknown as MockupProject;

    expect(JSON.stringify(project).length).toBeGreaterThan(MAX_STATE_CHARS);

    const compressed = await compressSceneImagesForCloud(project);
    expect(compressed.devices[0].screenshot?.startsWith('data:image/webp')).toBe(true);
    expect((compressed.devices[0].screenshot || '').length).toBeLessThan(20_000);

    const { scene, assets } = await externalizeSceneAssets(compressed);
    const payload = cloudSyncPayload({
      schemaVersion: 1,
      id: 'doc-compress',
      revision: 1,
      baseRevision: 0,
      updatedAt: Date.now(),
      deviceRefs: [],
      assets,
      scene,
    });

    expect(payload.length).toBeLessThanOrEqual(MAX_STATE_CHARS);
    expect(payload.includes('data:image')).toBe(false);
    expect(payload.includes('asset:sha256:')).toBe(true);
  });
});
