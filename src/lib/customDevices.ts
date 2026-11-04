import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { DeviceModel, DevicePlatform, DeviceUv, ScreenSize } from './devices';

const META_KEY = 'mockup-studio.custom-devices.v1';
const DB_NAME = 'mockup-studio-custom-devices';
const STORE = 'models';
const MAX_CUSTOM = 24;
const MAX_BYTES = 80 * 1024 * 1024; // 80 MB per file

export interface CustomDeviceMeta {
  id: string;
  label: string;
  subtitle: string;
  platform: DevicePlatform;
  screenMat: string;
  screenSize: ScreenSize;
  rot: [number, number, number];
  uv: DeviceUv;
  glassMats?: string[];
  /** Original filename for display */
  fileName: string;
  createdAt: number;
}

type StoredMeta = CustomDeviceMeta;

const objectUrls = new Map<string, string>();
const modelCache = new Map<string, DeviceModel>();
let hydrated = false;
const listeners = new Set<() => void>();

function notify() {
  modelCache.clear();
  listeners.forEach((fn) => fn());
}

export function subscribeCustomDevices(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function readMeta(): CustomDeviceMeta[] {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const entry = item as Partial<StoredMeta>;
      if (typeof entry.id !== 'string' || !entry.id.startsWith('custom-')) return [];
      if (typeof entry.label !== 'string' || !entry.label.trim()) return [];
      const width = typeof entry.screenSize?.width === 'number' ? entry.screenSize.width : 1170;
      const height = typeof entry.screenSize?.height === 'number' ? entry.screenSize.height : 2532;
      const rot = Array.isArray(entry.rot) && entry.rot.length === 3
        ? entry.rot.map((n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)) as [number, number, number]
        : [0, Math.PI, 0] as [number, number, number];
      return [{
        id: entry.id,
        label: entry.label.trim().slice(0, 48),
        subtitle: typeof entry.subtitle === 'string' && entry.subtitle.trim()
          ? entry.subtitle.trim().slice(0, 64)
          : 'Custom GLB',
        platform: (entry.platform === 'android' ? 'android' : 'ios') as DevicePlatform,
        screenMat: typeof entry.screenMat === 'string' && entry.screenMat.trim()
          ? entry.screenMat.trim().slice(0, 80)
          : 'Screen',
        screenSize: {
          width: Math.min(4096, Math.max(320, Math.round(width))),
          height: Math.min(4096, Math.max(320, Math.round(height))),
        },
        rot,
        uv: entry.uv && typeof entry.uv === 'object' ? { ...entry.uv } : { mirrorX: true },
        glassMats: Array.isArray(entry.glassMats)
          ? entry.glassMats.filter((n): n is string => typeof n === 'string').slice(0, 32)
          : undefined,
        fileName: typeof entry.fileName === 'string' ? entry.fileName.slice(0, 120) : 'model.glb',
        createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
      }];
    }).slice(0, MAX_CUSTOM);
  } catch {
    return [];
  }
}

function writeMeta(list: CustomDeviceMeta[]) {
  localStorage.setItem(META_KEY, JSON.stringify(list.slice(0, MAX_CUSTOM)));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function idbPut(id: string, buffer: ArrayBuffer) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(buffer, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
  });
}

async function idbGet(id: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => {
      const value = req.result;
      resolve(value instanceof ArrayBuffer ? value : null);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
  });
}

async function idbDelete(id: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
  });
}

function revokeUrl(id: string) {
  const url = objectUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(id);
  }
}

async function ensureObjectUrl(id: string): Promise<string | null> {
  const existing = objectUrls.get(id);
  if (existing) return existing;
  const buffer = await idbGet(id);
  if (!buffer) return null;
  const url = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
  objectUrls.set(id, url);
  return url;
}

export function isCustomDeviceId(id: string | undefined | null): boolean {
  return typeof id === 'string' && id.startsWith('custom-');
}

export function loadCustomDeviceMeta(): CustomDeviceMeta[] {
  return readMeta();
}

export function getCustomDeviceMeta(id: string): CustomDeviceMeta | undefined {
  return readMeta().find((d) => d.id === id);
}

export function customMetaToDeviceModel(meta: CustomDeviceMeta, url?: string): DeviceModel {
  const resolvedUrl = url ?? objectUrls.get(meta.id) ?? '';
  const cached = modelCache.get(meta.id);
  if (
    cached
    && cached.url === resolvedUrl
    && cached.label === meta.label
    && cached.screenMat === meta.screenMat
    && cached.platform === meta.platform
    && cached.screenSize.width === meta.screenSize.width
    && cached.screenSize.height === meta.screenSize.height
    && cached.rot[0] === meta.rot[0]
    && cached.rot[1] === meta.rot[1]
    && cached.rot[2] === meta.rot[2]
    && cached.uv.mirrorX === meta.uv.mirrorX
  ) {
    return cached;
  }
  const model: DeviceModel = {
    id: meta.id,
    label: meta.label,
    subtitle: meta.subtitle,
    platform: meta.platform,
    kind: 'gltf',
    url: resolvedUrl,
    screenMat: meta.screenMat,
    screenSize: { ...meta.screenSize },
    rot: [...meta.rot] as [number, number, number],
    uv: { ...meta.uv },
    glassMats: meta.glassMats ? [...meta.glassMats] : undefined,
  };
  modelCache.set(meta.id, model);
  return model;
}

/** Resolve a custom device to a DeviceModel (url may be empty until hydrated). */
export function resolveCustomDevice(id: string): DeviceModel | undefined {
  const meta = getCustomDeviceMeta(id);
  if (!meta) return undefined;
  return customMetaToDeviceModel(meta);
}

export async function hydrateCustomDeviceUrls(): Promise<void> {
  const list = readMeta();
  await Promise.all(list.map(async (meta) => {
    try {
      await ensureObjectUrl(meta.id);
    } catch (err) {
      console.warn('[custom device] hydrate failed', meta.id, err);
    }
  }));
  hydrated = true;
  notify();
}

export function areCustomDevicesHydrated() {
  return hydrated;
}

export function getCustomDeviceObjectUrl(id: string): string | undefined {
  return objectUrls.get(id);
}

export interface InspectedModel {
  materialNames: string[];
  suggestedScreenMat: string;
  suggestedGlassMats: string[];
}

function parseGltfData(data: ArrayBuffer | string): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.parse(
      data,
      '',
      (gltf) => resolve(gltf.scene),
      (err) => reject(err instanceof Error ? err : new Error('Could not parse GLB/GLTF')),
    );
  });
}

function isGlbMagic(buffer: ArrayBuffer) {
  if (buffer.byteLength < 4) return false;
  const view = new Uint8Array(buffer, 0, 4);
  return view[0] === 0x67 && view[1] === 0x6c && view[2] === 0x54 && view[3] === 0x46; // glTF
}

/** Inspect a GLB/GLTF ArrayBuffer for material names (screen / glass heuristics). */
export async function inspectGltfBuffer(buffer: ArrayBuffer): Promise<InspectedModel> {
  const data: ArrayBuffer | string = isGlbMagic(buffer)
    ? buffer
    : new TextDecoder().decode(buffer);
  const scene = await parseGltfData(data);
  const names = new Set<string>();
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (mat?.name) names.add(mat.name);
    }
  });
  const materialNames = [...names].sort((a, b) => a.localeCompare(b));
  const suggestedScreenMat =
    materialNames.find((n) => /screen|display|oled|lcd/i.test(n) && !/glass/i.test(n))
    ?? materialNames.find((n) => /screen|display|oled|lcd/i.test(n))
    ?? materialNames[0]
    ?? 'Screen';
  const suggestedGlassMats = materialNames.filter((n) => {
    if (n === suggestedScreenMat) return false;
    return /glass|lens|sapphire|crystal|gloss/i.test(n);
  }).slice(0, 12);
  return { materialNames, suggestedScreenMat, suggestedGlassMats };
}

export interface ImportCustomDeviceInput {
  file: File;
  label?: string;
  platform?: DevicePlatform;
  screenSize?: Partial<ScreenSize>;
  screenMat?: string;
  rotY?: number;
  mirrorX?: boolean;
}

export async function importCustomDevice(input: ImportCustomDeviceInput): Promise<CustomDeviceMeta> {
  const { file } = input;
  const name = file.name.toLowerCase();
  if (!/\.(glb|gltf)$/.test(name) && file.type !== 'model/gltf-binary' && file.type !== 'model/gltf+json') {
    throw new Error('Use a .glb or .gltf file.');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('Model is too large (max 80 MB).');
  }

  const buffer = await file.arrayBuffer();
  let inspected: InspectedModel;
  try {
    inspected = await inspectGltfBuffer(buffer.slice(0));
  } catch {
    inspected = { materialNames: [], suggestedScreenMat: 'Screen', suggestedGlassMats: [] };
  }

  const existing = readMeta();
  if (existing.length >= MAX_CUSTOM) {
    throw new Error(`You can save up to ${MAX_CUSTOM} custom models. Delete one first.`);
  }

  const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const baseLabel = (input.label?.trim() || file.name.replace(/\.(glb|gltf)$/i, '') || 'Custom device').slice(0, 48);
  const meta: CustomDeviceMeta = {
    id,
    label: baseLabel,
    subtitle: 'Your model',
    platform: input.platform === 'android' ? 'android' : 'ios',
    screenMat: (input.screenMat?.trim() || inspected.suggestedScreenMat || 'Screen').slice(0, 80),
    screenSize: {
      width: Math.min(4096, Math.max(320, Math.round(input.screenSize?.width ?? 1170))),
      height: Math.min(4096, Math.max(320, Math.round(input.screenSize?.height ?? 2532))),
    },
    rot: [0, typeof input.rotY === 'number' ? input.rotY : Math.PI, 0],
    uv: { mirrorX: input.mirrorX !== false },
    glassMats: inspected.suggestedGlassMats.length ? inspected.suggestedGlassMats : undefined,
    fileName: file.name.slice(0, 120),
    createdAt: Date.now(),
  };

  await idbPut(id, buffer);
  const url = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
  objectUrls.set(id, url);
  writeMeta([meta, ...existing].slice(0, MAX_CUSTOM));
  notify();
  return meta;
}

export async function updateCustomDeviceMeta(
  id: string,
  patch: Partial<Pick<CustomDeviceMeta, 'label' | 'platform' | 'screenMat' | 'screenSize' | 'rot' | 'uv' | 'glassMats' | 'subtitle'>>,
): Promise<CustomDeviceMeta | null> {
  const list = readMeta();
  const index = list.findIndex((d) => d.id === id);
  if (index < 0) return null;
  const current = list[index];
  const next: CustomDeviceMeta = {
    ...current,
    label: typeof patch.label === 'string' && patch.label.trim()
      ? patch.label.trim().slice(0, 48)
      : current.label,
    subtitle: typeof patch.subtitle === 'string'
      ? patch.subtitle.trim().slice(0, 64) || current.subtitle
      : current.subtitle,
    platform: patch.platform === 'android' || patch.platform === 'ios' ? patch.platform : current.platform,
    screenMat: typeof patch.screenMat === 'string' && patch.screenMat.trim()
      ? patch.screenMat.trim().slice(0, 80)
      : current.screenMat,
    screenSize: patch.screenSize
      ? {
          width: Math.min(4096, Math.max(320, Math.round(patch.screenSize.width ?? current.screenSize.width))),
          height: Math.min(4096, Math.max(320, Math.round(patch.screenSize.height ?? current.screenSize.height))),
        }
      : current.screenSize,
    rot: patch.rot && patch.rot.length === 3 ? [...patch.rot] as [number, number, number] : current.rot,
    uv: patch.uv ? { ...patch.uv } : current.uv,
    glassMats: patch.glassMats ? [...patch.glassMats] : current.glassMats,
  };
  list[index] = next;
  writeMeta(list);
  notify();
  return next;
}

export async function deleteCustomDevice(id: string): Promise<CustomDeviceMeta[]> {
  revokeUrl(id);
  try {
    await idbDelete(id);
  } catch (err) {
    console.warn('[custom device] delete blob failed', err);
  }
  const next = readMeta().filter((d) => d.id !== id);
  writeMeta(next);
  notify();
  return next;
}

/** Material names from a previously imported custom model (re-parse from IndexedDB). */
export async function listCustomDeviceMaterials(id: string): Promise<string[]> {
  const buffer = await idbGet(id);
  if (!buffer) return [];
  const inspected = await inspectGltfBuffer(buffer);
  return inspected.materialNames;
}
