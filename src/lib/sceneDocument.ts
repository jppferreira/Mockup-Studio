/**
 * Durable scene document wrapper around MockupProject.
 * Device geometry stays in the shared asset library — projects only reference device ids.
 */

import { DEVICE_MODEL_PACK_VERSION } from './devices';
import { validateProject } from './project';
import type { DeviceInstance, MockupProject, SceneStage } from '../types';

export const SCENE_DOCUMENT_SCHEMA_VERSION = 1 as const;

export type SceneAssetKind =
  | 'screenshot'
  | 'overlay'
  | 'soundtrack'
  | 'reflection'
  | 'screen_layer'
  | 'other';

export interface DeviceRef {
  deviceId: string;
  assetVersion: string;
}

export interface SceneAssetRef {
  id: string;
  hash: string;
  mime: string;
  byteLength: number;
  kind: SceneAssetKind;
}

export interface SceneDocument {
  schemaVersion: typeof SCENE_DOCUMENT_SCHEMA_VERSION;
  id: string;
  revision: number;
  /** Last synced / known remote revision — used for conflict detection later. */
  baseRevision: number;
  updatedAt: number;
  deviceRefs: DeviceRef[];
  assets: SceneAssetRef[];
  scene: MockupProject;
}

const ASSET_PREFIX = 'asset:sha256:';

export function createDocumentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isAssetRef(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(ASSET_PREFIX);
}

export function assetRefFromHash(hash: string): string {
  return `${ASSET_PREFIX}${hash}`;
}

export function hashFromAssetRef(value: string): string | null {
  if (!isAssetRef(value)) return null;
  const hash = value.slice(ASSET_PREFIX.length).trim();
  return hash.length >= 16 ? hash : null;
}

export function isSceneDocument(raw: unknown): raw is SceneDocument {
  if (!raw || typeof raw !== 'object') return false;
  const row = raw as Partial<SceneDocument>;
  return row.schemaVersion === SCENE_DOCUMENT_SCHEMA_VERSION
    && typeof row.id === 'string'
    && row.scene != null
    && typeof row.scene === 'object';
}

/** True when JSON looks like a legacy MockupProject (not a SceneDocument). */
export function isLegacyMockupProject(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  if (isSceneDocument(raw)) return false;
  const row = raw as { version?: unknown };
  return row.version === 1;
}

export function collectDeviceRefs(project: MockupProject): DeviceRef[] {
  const seen = new Set<string>();
  const refs: DeviceRef[] = [];
  for (const device of project.devices ?? []) {
    const deviceId = String(device.deviceId || '').trim();
    if (!deviceId || seen.has(deviceId)) continue;
    seen.add(deviceId);
    refs.push({ deviceId, assetVersion: DEVICE_MODEL_PACK_VERSION });
  }
  if (!refs.length && project.deviceId) {
    refs.push({ deviceId: project.deviceId, assetVersion: DEVICE_MODEL_PACK_VERSION });
  }
  return refs;
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+)?(?:;[^,]*)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const mime = (match[1] || 'application/octet-stream').trim() || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? '';
  try {
    if (isBase64) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return { mime, bytes };
    }
    return { mime, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
  } catch {
    return null;
  }
}

export async function hashBytes(bytes: Uint8Array): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback for rare environments without SubtleCrypto — not cryptographic.
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619);
  }
  return `fnv_${(h >>> 0).toString(16).padStart(8, '0')}_${bytes.length.toString(16)}`;
}

export function bytesToDataUrl(mime: string, bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

type AssetSink = {
  refs: SceneAssetRef[];
  blobs: Map<string, { mime: string; bytes: Uint8Array }>;
};

async function externalizeDataUrl(
  value: string | null | undefined,
  kind: SceneAssetKind,
  sink: AssetSink,
  minBytes = 2048,
): Promise<string | null> {
  if (typeof value !== 'string') return null;
  if (value.startsWith(ASSET_PREFIX)) return value;
  if (!value.startsWith('data:')) return value;
  const parsed = parseDataUrl(value);
  if (!parsed || parsed.bytes.byteLength < minBytes) return value;
  const hash = await hashBytes(parsed.bytes);
  if (!sink.blobs.has(hash)) {
    sink.blobs.set(hash, parsed);
    sink.refs.push({
      id: hash,
      hash,
      mime: parsed.mime,
      byteLength: parsed.bytes.byteLength,
      kind,
    });
  } else if (!sink.refs.some((ref) => ref.hash === hash)) {
    sink.refs.push({
      id: hash,
      hash,
      mime: parsed.mime,
      byteLength: parsed.bytes.byteLength,
      kind,
    });
  }
  return assetRefFromHash(hash);
}

async function externalizeMaterialTweaks(
  tweaks: DeviceInstance['materialTweaks'],
  sink: AssetSink,
): Promise<DeviceInstance['materialTweaks']> {
  if (!tweaks) return tweaks;
  const entries = await Promise.all(Object.entries(tweaks).map(async ([name, tweak]) => {
    if (!tweak || typeof tweak !== 'object') return [name, tweak] as const;
    const next = { ...tweak };
    for (const key of Object.keys(next)) {
      const value = next[key];
      if (typeof value !== 'string' || !value.startsWith('data:')) continue;
      const replaced = await externalizeDataUrl(value, 'other', sink, 0);
      if (replaced != null) next[key] = replaced;
    }
    return [name, next] as const;
  }));
  return Object.fromEntries(entries);
}

async function externalizeDevice(device: DeviceInstance, sink: AssetSink): Promise<DeviceInstance> {
  const screenshot = await externalizeDataUrl(device.screenshot, 'screenshot', sink, 0);
  const screenLayers = device.screenLayers
    ? await Promise.all(device.screenLayers.map(async (layer) => ({
      ...layer,
      dataUrl: (await externalizeDataUrl(layer.dataUrl, 'screen_layer', sink, 0)) ?? layer.dataUrl,
    })))
    : device.screenLayers;
  const materialTweaks = await externalizeMaterialTweaks(device.materialTweaks, sink);
  return { ...device, screenshot, screenLayers, materialTweaks };
}

async function externalizeOverlays<T extends { imageData?: string | null }>(
  overlays: T[] | undefined,
  sink: AssetSink,
): Promise<T[] | undefined> {
  if (!overlays) return overlays;
  return Promise.all(overlays.map(async (overlay) => ({
    ...overlay,
    imageData: await externalizeDataUrl(overlay.imageData, 'overlay', sink, 0),
  })));
}

async function externalizeStage(stage: SceneStage, sink: AssetSink): Promise<SceneStage> {
  const devices = await Promise.all((stage.devices ?? []).map((device) => externalizeDevice(device, sink)));
  const overlays = await externalizeOverlays(stage.overlays, sink);
  const reflectionMapImage = await externalizeDataUrl(stage.reflectionMapImage, 'reflection', sink, 0);
  return {
    ...stage,
    devices,
    overlays: overlays ?? stage.overlays,
    reflectionMapImage,
  };
}

/** Replace embedded data-URLs with content-addressed asset refs, including each scene's own copy. */
export async function externalizeSceneAssets(project: MockupProject): Promise<{
  scene: MockupProject;
  assets: SceneAssetRef[];
  blobs: Map<string, { mime: string; bytes: Uint8Array }>;
}> {
  const sink: AssetSink = { refs: [], blobs: new Map() };
  const devices = await Promise.all((project.devices ?? []).map((device) => externalizeDevice(device, sink)));
  const overlays = await externalizeOverlays(project.overlays, sink);
  const reflectionMapImage = await externalizeDataUrl(project.reflectionMapImage, 'reflection', sink, 0);
  const soundtrackData = await externalizeDataUrl(
    typeof project.soundtrackData === 'string' ? project.soundtrackData : null,
    'soundtrack',
    sink,
    512,
  );
  const screenshot = await externalizeDataUrl(project.screenshot, 'screenshot', sink, 0);
  const scenes = project.scenes
    ? await Promise.all(project.scenes.map(async (scene) => (
      scene.stage ? { ...scene, stage: await externalizeStage(scene.stage, sink) } : scene
    )))
    : project.scenes;

  return {
    scene: {
      ...project,
      screenshot,
      reflectionMapImage,
      soundtrackData: soundtrackData ?? project.soundtrackData,
      devices,
      overlays: overlays ?? project.overlays,
      scenes,
    },
    assets: sink.refs,
    blobs: sink.blobs,
  };
}

export async function hydrateSceneAssets(
  project: MockupProject,
  resolve: (hash: string) => Promise<{ mime: string; bytes: Uint8Array } | null>,
): Promise<MockupProject> {
  const restore = async (value: string | null | undefined): Promise<string | null> => {
    if (value == null) return null;
    if (typeof value !== 'string') return null;
    const hash = hashFromAssetRef(value);
    if (!hash) return value;
    const blob = await resolve(hash);
    if (!blob) return value;
    return bytesToDataUrl(blob.mime, blob.bytes);
  };

  const restoreDevice = async (device: DeviceInstance): Promise<DeviceInstance> => {
    const screenshot = await restore(device.screenshot);
    const screenLayers = device.screenLayers
      ? await Promise.all(device.screenLayers.map(async (layer) => ({
        ...layer,
        dataUrl: (await restore(layer.dataUrl)) ?? layer.dataUrl,
      })))
      : device.screenLayers;
    let materialTweaks = device.materialTweaks;
    if (materialTweaks) {
      const entries = await Promise.all(Object.entries(materialTweaks).map(async ([name, tweak]) => {
        if (!tweak || typeof tweak !== 'object') return [name, tweak] as const;
        const next = { ...tweak };
        for (const key of Object.keys(next)) {
          const value = next[key];
          if (typeof value !== 'string') continue;
          const restored = await restore(value);
          if (restored != null) next[key] = restored;
        }
        return [name, next] as const;
      }));
      materialTweaks = Object.fromEntries(entries);
    }
    return { ...device, screenshot, screenLayers, materialTweaks };
  };

  const restoreOverlays = async <T extends { imageData?: string | null }>(overlays: T[] | undefined) => {
    if (!overlays) return overlays;
    return Promise.all(overlays.map(async (overlay) => ({
      ...overlay,
      imageData: await restore(overlay.imageData),
    })));
  };

  const devices = await Promise.all((project.devices ?? []).map(restoreDevice));
  const overlays = await restoreOverlays(project.overlays);
  const scenes = project.scenes
    ? await Promise.all(project.scenes.map(async (scene) => {
      if (!scene.stage) return scene;
      const stage = scene.stage;
      return {
        ...scene,
        stage: {
          ...stage,
          devices: await Promise.all((stage.devices ?? []).map(restoreDevice)),
          overlays: (await restoreOverlays(stage.overlays)) ?? stage.overlays,
          reflectionMapImage: await restore(stage.reflectionMapImage),
        },
      };
    }))
    : project.scenes;

  return {
    ...project,
    screenshot: await restore(project.screenshot),
    reflectionMapImage: await restore(project.reflectionMapImage),
    soundtrackData: (await restore(
      typeof project.soundtrackData === 'string' ? project.soundtrackData : null,
    )) ?? project.soundtrackData,
    devices,
    overlays: overlays ?? project.overlays,
    scenes,
  };
}

export function wrapProject(
  project: MockupProject,
  partial?: Partial<Pick<SceneDocument, 'id' | 'revision' | 'baseRevision' | 'updatedAt' | 'assets'>>,
): SceneDocument {
  const scene = validateProject(project);
  const now = Date.now();
  return {
    schemaVersion: SCENE_DOCUMENT_SCHEMA_VERSION,
    id: partial?.id && partial.id.trim() ? partial.id.trim() : createDocumentId(),
    revision: typeof partial?.revision === 'number' && partial.revision >= 1 ? Math.floor(partial.revision) : 1,
    baseRevision: typeof partial?.baseRevision === 'number' && partial.baseRevision >= 0
      ? Math.floor(partial.baseRevision)
      : 0,
    updatedAt: typeof partial?.updatedAt === 'number' && Number.isFinite(partial.updatedAt)
      ? partial.updatedAt
      : now,
    deviceRefs: collectDeviceRefs(scene),
    assets: Array.isArray(partial?.assets) ? partial.assets : [],
    scene,
  };
}

export function bumpDocument(doc: SceneDocument, scene: MockupProject, assets?: SceneAssetRef[]): SceneDocument {
  const nextScene = validateProject(scene);
  return {
    ...doc,
    revision: Math.max(1, doc.revision + 1),
    updatedAt: Date.now(),
    deviceRefs: collectDeviceRefs(nextScene),
    assets: assets ?? doc.assets,
    scene: nextScene,
  };
}

/**
 * Accepts a SceneDocument or legacy MockupProject JSON and returns a normalised document.
 * Does not hydrate asset: refs — call hydrateSceneAssets after loading blobs.
 */
export function migrateDocument(raw: unknown): SceneDocument {
  if (isSceneDocument(raw)) {
    const scene = validateProject(raw.scene);
    return {
      schemaVersion: SCENE_DOCUMENT_SCHEMA_VERSION,
      id: raw.id.trim() || createDocumentId(),
      revision: typeof raw.revision === 'number' && raw.revision >= 1 ? Math.floor(raw.revision) : 1,
      baseRevision: typeof raw.baseRevision === 'number' && raw.baseRevision >= 0
        ? Math.floor(raw.baseRevision)
        : 0,
      updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
        ? raw.updatedAt
        : Date.now(),
      deviceRefs: Array.isArray(raw.deviceRefs) && raw.deviceRefs.length
        ? raw.deviceRefs
          .filter((ref): ref is DeviceRef => (
            !!ref
            && typeof ref === 'object'
            && typeof ref.deviceId === 'string'
            && ref.deviceId.trim().length > 0
          ))
          .map((ref) => ({
            deviceId: ref.deviceId.trim(),
            assetVersion: typeof ref.assetVersion === 'string' && ref.assetVersion
              ? ref.assetVersion
              : DEVICE_MODEL_PACK_VERSION,
          }))
        : collectDeviceRefs(scene),
      assets: Array.isArray(raw.assets)
        ? raw.assets.filter((item): item is SceneAssetRef => (
          !!item
          && typeof item === 'object'
          && typeof item.hash === 'string'
          && typeof item.mime === 'string'
          && typeof item.byteLength === 'number'
        ))
        : [],
      scene,
    };
  }

  if (isLegacyMockupProject(raw)) {
    return wrapProject(validateProject(raw));
  }

  // Some payloads nest the project under `project` (recent-entry style).
  if (raw && typeof raw === 'object' && 'project' in raw) {
    const nested = (raw as { project: unknown }).project;
    if (isLegacyMockupProject(nested) || isSceneDocument(nested)) {
      return migrateDocument(nested);
    }
  }

  throw new Error('Unsupported scene document.');
}

/** Parse file / cloud JSON that may be a document or a legacy project. */
export function parseProjectPayload(raw: unknown): { document: SceneDocument; project: MockupProject } {
  const document = migrateDocument(raw);
  return { document, project: document.scene };
}

/** Serialise for .mockup / download — always a SceneDocument with a portable (hydrated) scene. */
export function serializeSceneDocument(doc: SceneDocument): string {
  return JSON.stringify({
    schemaVersion: doc.schemaVersion,
    id: doc.id,
    revision: doc.revision,
    baseRevision: doc.baseRevision,
    updatedAt: doc.updatedAt,
    deviceRefs: doc.deviceRefs,
    assets: doc.assets,
    scene: doc.scene,
  }, null, 2);
}
