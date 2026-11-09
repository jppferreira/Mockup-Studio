/**
 * On-demand device GLB loader.
 * Fetches a short-lived signed URL from Supabase, downloads once, and keeps an
 * encrypted opaque blob in IndexedDB so plaintext .glb files are not left on disk.
 */

import { DEVICE_MODEL_PACK_VERSION } from './devices';

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

async function requestSignedUrl(deviceId: string): Promise<string> {
  const { url, anonKey, appSecret } = supabaseConfig();
  const response = await fetch(`${url}/functions/v1/device-model-url`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
      'x-mockup-model-secret': appSecret,
    },
    body: JSON.stringify({ deviceId }),
  });
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
  return response.arrayBuffer();
}

function toBlobUrl(bytes: ArrayBuffer): string {
  const blob = new Blob([bytes], { type: 'model/gltf-binary' });
  return URL.createObjectURL(blob);
}

/**
 * Resolve a loadable blob: URL for a catalog device GLB.
 * Downloads on first use; later calls reuse the encrypted IndexedDB cache.
 */
export async function resolveDeviceModelUrl(deviceId: string): Promise<string> {
  const existing = liveUrls.get(deviceId);
  if (existing) return existing;

  const pending = inflight.get(deviceId);
  if (pending) return pending;

  const task = (async () => {
    const key = cacheKey(deviceId);
    const cached = await idbGet(key);
    if (cached) {
      const plain = await decryptBytes(cached.iv, cached.cipher);
      const blobUrl = toBlobUrl(plain);
      liveUrls.set(deviceId, blobUrl);
      return blobUrl;
    }

    const signedUrl = await requestSignedUrl(deviceId);
    const plain = await downloadModel(signedUrl);
    const encrypted = await encryptBytes(plain);
    await idbPut({
      key,
      iv: encrypted.iv,
      cipher: encrypted.cipher,
      updatedAt: Date.now(),
    });
    const blobUrl = toBlobUrl(plain);
    liveUrls.set(deviceId, blobUrl);
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
