/**
 * On-demand device GLB loader.
 * Fetches a short-lived signed URL from Supabase, downloads once, and keeps an
 * encrypted opaque blob in IndexedDB so plaintext .glb files are not left on disk.
 */

import { DEVICE_MODEL_PACK_VERSION } from './devices';
import {
  isDeviceUnlocked,
  isFreeDevice,
  loadLicense,
  modelAccessLicenseKey,
} from './license';
import { bundledLocalModelUrl } from './localDeviceModels';
import {
  isDeviceBlockedOnWeb,
  modelAccessSessionToken,
} from './entitlements';

const DB_NAME = 'mockup-studio.model-cache';
const DB_VERSION = 1;
const STORE = 'blobs';
const CACHE_PREFIX = 'm1';

type CacheRecord = {
  key: string;
  iv: ArrayBuffer;
  cipher: ArrayBuffer;
  updatedAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;
let cryptoKeyPromise: Promise<CryptoKey> | null = null;
const inflight = new Map<string, Promise<string>>();
const liveUrls = new Map<string, string>();

function supabaseConfig() {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '');
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const appSecret = import.meta.env.VITE_MODEL_APP_SECRET as string | undefined;
  if (!url || !anonKey || !appSecret) {
    throw new Error(
      'Device models require VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and VITE_MODEL_APP_SECRET',
    );
  }
  return { url, anonKey, appSecret };
}

function cacheKey(deviceId: string) {
  return `${CACHE_PREFIX}:${DEVICE_MODEL_PACK_VERSION}:${deviceId}`;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
  return dbPromise;
}

async function getMachineKeyMaterial(): Promise<ArrayBuffer> {
  const seed = [
    'mockup-studio.model-key.v1',
    navigator.userAgent,
    String((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? ''),
    String(screen.width),
    String(screen.height),
  ].join('|');
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
}

async function getCryptoKey(): Promise<CryptoKey> {
  if (cryptoKeyPromise) return cryptoKeyPromise;
  cryptoKeyPromise = (async () => {
    const material = await getMachineKeyMaterial();
    return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
  })();
  return cryptoKeyPromise;
}

/** Kick IndexedDB + crypto key so the first model resolve is not cold. */
export function prepareModelCache(): void {
  if (!remoteModelsConfigured()) return;
  void openDb().catch(() => undefined);
  void getCryptoKey().catch(() => undefined);
}

async function idbGet(key: string): Promise<CacheRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as CacheRecord | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('indexedDB get failed'));
  });
}

async function idbPut(record: CacheRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB put failed'));
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB delete failed'));
  });
}

async function encryptBytes(plain: ArrayBuffer): Promise<{ iv: ArrayBuffer; cipher: ArrayBuffer }> {
  const key = await getCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return { iv: iv.buffer, cipher };
}

async function decryptBytes(iv: ArrayBuffer, cipher: ArrayBuffer): Promise<ArrayBuffer> {
  const key = await getCryptoKey();
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, cipher);
}

async function requestSignedUrl(deviceId: string, licenseKey: string | null): Promise<string> {
  const { url, anonKey, appSecret } = supabaseConfig();
  const sessionToken = await modelAccessSessionToken();
  const client = typeof window !== 'undefined' && window.mockupDesktop ? 'desktop' : 'web';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${sessionToken || anonKey}`,
    apikey: anonKey,
    'Content-Type': 'application/json',
    'x-mockup-model-secret': appSecret,
    'x-mockup-client': client,
  };
  if (licenseKey) headers['x-mockup-license-key'] = licenseKey;

  const response = await fetch(`${url}/functions/v1/device-model-url`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      deviceId,
      licenseKey: licenseKey || undefined,
      client,
    }),
  });
  if (response.status === 403) {
    const payload = await response.json().catch(() => ({})) as { error?: string; detail?: string };
    if (payload.error === 'license_review_required') {
      throw new Error(
        'This device model is not cleared for browser use yet — open it in the Mac app, or wait for licence review.',
      );
    }
    if (payload.error === 'license_required') {
      throw new Error(
        'This device requires Pro — sign in with a linked account or activate your license key to download the model',
      );
    }
    throw new Error(
      payload.detail || payload.error || 'This device requires Pro — upgrade to unlock the full library',
    );
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Model URL request failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  const payload = (await response.json()) as { url?: string };
  if (!payload.url) throw new Error('Model URL response missing url');
  return payload.url;
}

async function downloadModel(signedUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new Error(`Model download failed (${response.status})`);
  }
  const bytes = await response.arrayBuffer();
  assertGlbBytes(bytes, 'download');
  return bytes;
}

/** Reject HTML error pages / truncated rows before they hit useGLTF. */
function assertGlbBytes(bytes: ArrayBuffer, source: string): void {
  if (bytes.byteLength < 20) {
    throw new Error(`Model ${source} too small (${bytes.byteLength} bytes)`);
  }
  const magic = new TextDecoder().decode(new Uint8Array(bytes, 0, 4));
  if (magic !== 'glTF') {
    throw new Error(`Model ${source} is not a GLB (got ${JSON.stringify(magic)})`);
  }
}

function toBlobUrl(bytes: ArrayBuffer): string {
  const blob = new Blob([bytes], { type: 'model/gltf-binary' });
  return URL.createObjectURL(blob);
}

async function readCachedBlobUrl(deviceId: string): Promise<string | null> {
  const key = cacheKey(deviceId);
  const cached = await idbGet(key);
  if (!cached) return null;
  try {
    const plain = await decryptBytes(cached.iv, cached.cipher);
    assertGlbBytes(plain, 'cache');
    const blobUrl = toBlobUrl(plain);
    liveUrls.set(deviceId, blobUrl);
    return blobUrl;
  } catch (error) {
    // Machine-key drift, truncated write, or non-GLB junk — drop and re-fetch.
    console.warn('[model-cache] dropping bad cache row', deviceId, error);
    await idbDelete(key).catch(() => undefined);
    return null;
  }
}

function persistEncrypted(deviceId: string, plain: ArrayBuffer): void {
  void (async () => {
    try {
      const encrypted = await encryptBytes(plain);
      await idbPut({
        key: cacheKey(deviceId),
        iv: encrypted.iv,
        cipher: encrypted.cipher,
        updatedAt: Date.now(),
      });
    } catch {
      /* Cache miss next launch is fine — model already rendered. */
    }
  })();
}

/** Instant session hit — avoids a loading flash when the blob is already warm. */
export function peekDeviceModelUrl(deviceId: string | undefined): string | null {
  if (!deviceId) return null;
  return liveUrls.get(deviceId) ?? null;
}

/** True when this device already has a warm session blob URL (no IDB read). */
export function peekDeviceModelCached(deviceId: string | undefined): boolean {
  if (!deviceId) return false;
  if (bundledLocalModelUrl(deviceId)) return true;
  return liveUrls.has(deviceId);
}

async function idbHas(key: string): Promise<boolean> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = typeof store.count === 'function'
      ? store.count(IDBKeyRange.only(key))
      : store.get(key);
    req.onsuccess = () => {
      if (typeof req.result === 'number') resolve(req.result > 0);
      else resolve(Boolean(req.result));
    };
    req.onerror = () => reject(req.error ?? new Error('indexedDB has failed'));
  });
}

/**
 * True when the GLB is bundled, warm in-session, or already encrypted in IndexedDB.
 * Does not decrypt — safe for card UI status checks.
 */
export async function isDeviceModelCached(deviceId: string): Promise<boolean> {
  if (bundledLocalModelUrl(deviceId)) return true;
  if (liveUrls.has(deviceId)) return true;
  if (!remoteModelsConfigured()) return false;
  try {
    return await idbHas(cacheKey(deviceId));
  } catch {
    return false;
  }
}

/** Prefetch + encrypt into IndexedDB so the device is ready before placing it. */
export async function downloadDeviceModel(deviceId: string): Promise<string> {
  return resolveDeviceModelUrl(deviceId);
}

/**
 * Scan IndexedDB for remote models already cached for this pack version.
 * Bundled free starters are omitted (they are always local).
 */
export async function listCachedRemoteDeviceIds(): Promise<Set<string>> {
  const ready = new Set<string>();
  if (!remoteModelsConfigured()) return ready;
  try {
    const db = await openDb();
    const prefix = `${CACHE_PREFIX}:${DEVICE_MODEL_PACK_VERSION}:`;
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error ?? new Error('indexedDB keys failed'));
    });
    for (const key of keys) {
      if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
      const deviceId = key.slice(prefix.length);
      if (deviceId && !bundledLocalModelUrl(deviceId)) ready.add(deviceId);
    }
  } catch {
    /* Card UI falls back to per-device checks. */
  }
  for (const deviceId of liveUrls.keys()) {
    if (!bundledLocalModelUrl(deviceId)) ready.add(deviceId);
  }
  return ready;
}

/**
 * Resolve a loadable URL for a catalog device GLB.
 * Free starters return the bundled Vite asset (no network).
 * Pro / Pro Max paid catalog models use signed Supabase URLs + encrypted IDB cache.
 */
export async function resolveDeviceModelUrl(deviceId: string): Promise<string> {
  const bundled = bundledLocalModelUrl(deviceId);
  if (bundled) return bundled;

  // Fastest remote path: already decrypted in this session.
  const existing = liveUrls.get(deviceId);
  if (existing) return existing;

  const pending = inflight.get(deviceId);
  if (pending) return pending;

  const task = (async () => {
    if (isDeviceBlockedOnWeb(deviceId)) {
      throw new Error(
        'This device model is not cleared for browser use yet — open it in the Mac app, or wait for licence review.',
      );
    }

    const license = loadLicense();
    if (!isDeviceUnlocked(license.tier, deviceId)) {
      throw new Error('This device requires Pro — upgrade to unlock the full library');
    }

    // Local cache must not wait on auth refresh — that was the open-up stall.
    const cached = await readCachedBlobUrl(deviceId);
    if (cached) return cached;

    const accessKey = modelAccessLicenseKey(license);
    if (!isFreeDevice(deviceId) && !accessKey) {
      // Only pay for session refresh when we actually need a signed CDN URL.
      const sessionToken = await modelAccessSessionToken();
      const accountUnlocks = Boolean(sessionToken) && license.source === 'account' && license.tier !== 'free';
      if (!accountUnlocks) {
        throw new Error(
          'Activate your Pro license key (or sign in with a linked account) to download this device',
        );
      }
    }

    // Race: another caller may have filled liveUrls while we awaited.
    const raced = liveUrls.get(deviceId);
    if (raced) return raced;

    const signedUrl = await requestSignedUrl(deviceId, accessKey);
    const plain = await downloadModel(signedUrl);
    const blobUrl = toBlobUrl(plain);
    liveUrls.set(deviceId, blobUrl);
    // Return immediately — encrypt/IndexedDB can finish after first paint.
    persistEncrypted(deviceId, plain);
    if (import.meta.env.DEV || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perf'))) {
      console.info('[model-cache] resolved', deviceId, `${(plain.byteLength / 1e6).toFixed(2)} MB`);
    }
    return blobUrl;
  })();

  inflight.set(deviceId, task);
  try {
    return await task;
  } finally {
    inflight.delete(deviceId);
  }
}

/** True when Supabase model delivery is configured in this build. */
export function remoteModelsConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL
      && import.meta.env.VITE_SUPABASE_ANON_KEY
      && import.meta.env.VITE_MODEL_APP_SECRET,
  );
}
