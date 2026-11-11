import { compileSchema, decodeBinarySchema } from 'kiwi-schema';
import { inflateRaw } from 'pako';

/** Legacy device-wide plaintext — deleted, never reused across accounts. */
const TOKEN_KEY_PLAIN = 'mockup-studio.figma-token';
/** Legacy device-wide ciphertext — deleted on bind/save/clear. */
const TOKEN_KEY_ENC_LEGACY = 'mockup-studio.figma-token.v2';
const TOKEN_CONSENT_KEY_LEGACY = 'mockup-studio.figma-token-consent';
const WEB_AES_STORE = 'mockup-studio-figma-aes';
const WEB_AES_KEY_ID_LEGACY = 'figma-token-key';
const FIGMA_API = 'https://api.figma.com/v1';

function tokenEncKey(userId: string) {
  return `mockup-studio.figma-token.v2.${userId}`;
}
function tokenConsentKey(userId: string) {
  return `mockup-studio.figma-token-consent.${userId}`;
}
function webAesKeyId(userId: string) {
  return `figma-token-key.${userId}`;
}

/**
 * Shown before connecting a personal access token (GDPR transparency).
 * Token and Figma file bytes stay on-device except for direct calls to api.figma.com.
 */
export const FIGMA_TOKEN_PRIVACY_NOTICE =
  'Token stays encrypted on this device for your mokstudio account, and is sent only to Figma’s API for files you choose. '
  + 'Disconnect deletes it here.';

/** Step-by-step guide shown when the user starts Connect Figma token. */
export const FIGMA_TOKEN_SETUP_STEPS = [
  {
    title: 'Figma → Settings → Security',
    detail: 'Open Personal access tokens.',
  },
  {
    title: 'Generate a token',
    detail: 'Enable File content read access, then create it.',
  },
  {
    title: 'Paste and Confirm',
    detail: 'Paste the token below and tap Confirm.',
  },
] as const;

/** Official docs for generating a personal access token. */
export const FIGMA_TOKEN_HELP_URL =
  'https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens';

/** In-memory cache so sync callers (paste / export defaults) see the current token. */
let cachedFigmaToken = '';
/** Signed-in mokstudio account the in-memory token belongs to (null = signed out). */
let activeAccountId: string | null = null;
let hydrateGeneration = 0;

export type FigmaNodeType =
  | 'DOCUMENT'
  | 'CANVAS'
  | 'FRAME'
  | 'GROUP'
  | 'SECTION'
  | 'COMPONENT'
  | 'COMPONENT_SET'
  | 'INSTANCE'
  | 'BOOLEAN_OPERATION'
  | 'VECTOR'
  | 'STAR'
  | 'LINE'
  | 'ELLIPSE'
  | 'REGULAR_POLYGON'
  | 'RECTANGLE'
  | 'TEXT'
  | 'SLICE'
  | 'IMAGE'
  | string;

export type FigmaLayerNode = {
  id: string;
  name: string;
  type: FigmaNodeType;
  visible: boolean;
  /** Absolute canvas X from Figma `absoluteBoundingBox` (when known). */
  x?: number;
  /** Absolute canvas Y from Figma `absoluteBoundingBox` (when known). */
  y?: number;
  width?: number;
  height?: number;
  children: FigmaLayerNode[];
};

export type FigmaFileSummary = {
  fileKey: string;
  name: string;
  lastModified?: string;
  thumbnailUrl?: string;
  layers: FigmaLayerNode[];
};

const CONTAINER_TYPES = new Set([
  'DOCUMENT',
  'CANVAS',
  'FRAME',
  'GROUP',
  'SECTION',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'BOOLEAN_OPERATION',
]);

const APPLYABLE_TYPES = new Set([
  'FRAME',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'GROUP',
  'SECTION',
]);

/** Sync read of the hydrated token cache (empty until `initFigmaTokenStore` finishes). */
export function loadFigmaToken(): string {
  return cachedFigmaToken;
}

/** True when a personal access token is stored for Figma API calls. */
export function hasFigmaToken(): boolean {
  return Boolean(cachedFigmaToken.trim());
}

type FigmaTokenChangeHandler = (connected: boolean, reason?: 'saved' | 'cleared' | 'revoked') => void;
const tokenChangeListeners = new Set<FigmaTokenChangeHandler>();

/** Subscribe to local Figma token connect / disconnect / revoke wipes. */
export function onFigmaTokenChange(handler: FigmaTokenChangeHandler): () => void {
  tokenChangeListeners.add(handler);
  return () => { tokenChangeListeners.delete(handler); };
}

function emitFigmaTokenChange(connected: boolean, reason?: 'saved' | 'cleared' | 'revoked') {
  for (const handler of tokenChangeListeners) {
    try {
      handler(connected, reason);
    } catch {
      /* ignore listener failures */
    }
  }
}

/** Thrown when Figma rejects the stored PAT; local copy is wiped before throw. */
export class FigmaAuthError extends Error {
  readonly code = 'FIGMA_AUTH' as const;
  constructor(message: string) {
    super(message);
    this.name = 'FigmaAuthError';
  }
}

export function isFigmaAuthError(error: unknown): error is FigmaAuthError {
  return error instanceof FigmaAuthError
    || (Boolean(error) && typeof error === 'object' && (error as { code?: string }).code === 'FIGMA_AUTH');
}

/**
 * True when a 401/403 means the credential itself is bad (revoked, expired, invalid, bad scopes),
 * not merely “no access to this particular file”.
 */
export function isFigmaTokenCredentialFailure(status: number, errMessage: string | null | undefined): boolean {
  if (status === 401) return true;
  if (status !== 403) return false;
  const lower = (errMessage || '').toLowerCase();
  if (!lower) return false;
  return (
    lower.includes('invalid token')
    || lower.includes('token expired')
    || lower.includes('invalid scope')
    || lower.includes('revoked')
  );
}

function extractFigmaErrMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  if ('err' in body && typeof (body as { err: unknown }).err === 'string') {
    return (body as { err: string }).err;
  }
  if ('message' in body && typeof (body as { message: unknown }).message === 'string') {
    return (body as { message: string }).message;
  }
  return null;
}

/** Mask a token for UI status (keeps prefix + last 4). Never log the raw token. */
export function maskFigmaToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 10) return '••••••••';
  return `${trimmed.slice(0, 5)}…${trimmed.slice(-4)}`;
}

/** Account the in-memory Figma token is bound to (null when signed out). */
export function getFigmaTokenAccountId(): string | null {
  return activeAccountId;
}

export function hasFigmaTokenConsent(userId: string | null = activeAccountId): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(tokenConsentKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function setFigmaTokenConsent(accepted: boolean, userId: string | null = activeAccountId) {
  if (!userId) return;
  try {
    if (accepted) localStorage.setItem(tokenConsentKey(userId), '1');
    else localStorage.removeItem(tokenConsentKey(userId));
  } catch {
    /* private mode */
  }
}

function desktopTokenApi() {
  return typeof window !== 'undefined' ? window.mockupDesktop : undefined;
}

async function openAesKeyStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WEB_AES_STORE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open token key store'));
  });
}

async function readWebAesKey(db: IDBDatabase, keyId: string): Promise<CryptoKey | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readonly');
    const req = tx.objectStore('keys').get(keyId);
    req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
    req.onerror = () => reject(req.error ?? new Error('Could not read token key'));
  });
}

async function writeWebAesKey(db: IDBDatabase, keyId: string, key: CryptoKey): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite');
    tx.objectStore('keys').put(key, keyId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not store token key'));
  });
}

/** Serialize first-time key creation so concurrent encrypts don't mint two keys. */
const webAesKeyLoads = new Map<string, Promise<CryptoKey>>();

async function loadOrCreateWebAesKey(userId: string): Promise<CryptoKey> {
  const pending = webAesKeyLoads.get(userId);
  if (pending) return pending;

  const job = (async () => {
    const db = await openAesKeyStore();
    try {
      const keyId = webAesKeyId(userId);
      const existing = await readWebAesKey(db, keyId);
      if (existing) return existing;

      // One-time: reuse the pre-account key so legacy ciphertext still decrypts.
      const legacy = await readWebAesKey(db, WEB_AES_KEY_ID_LEGACY);
      if (legacy) {
        await writeWebAesKey(db, keyId, legacy);
        return legacy;
      }

      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      // Re-read after generate in case another tab won the race.
      const raced = await readWebAesKey(db, keyId);
      if (raced) return raced;
      await writeWebAesKey(db, keyId, key);
      return key;
    } finally {
      try { db.close(); } catch { /* ignore */ }
    }
  })();

  webAesKeyLoads.set(userId, job);
  try {
    return await job;
  } finally {
    if (webAesKeyLoads.get(userId) === job) webAesKeyLoads.delete(userId);
  }
}

/** Decrypt-only: never mint a new AES key for missing ciphertext. */
async function loadWebAesKeyOnly(userId: string): Promise<CryptoKey | null> {
  const db = await openAesKeyStore();
  try {
    const keyId = webAesKeyId(userId);
    const existing = await readWebAesKey(db, keyId);
    if (existing) return existing;
    const legacy = await readWebAesKey(db, WEB_AES_KEY_ID_LEGACY);
    if (legacy) {
      await writeWebAesKey(db, keyId, legacy);
      return legacy;
    }
    return null;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

async function encryptTokenForWeb(userId: string, token: string): Promise<string> {
  const key = await loadOrCreateWebAesKey(userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(token),
  );
  const packed = new Uint8Array(iv.length + cipher.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(cipher), iv.length);
  let binary = '';
  packed.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

async function decryptTokenForWeb(userId: string, payload: string): Promise<string | null> {
  try {
    const binary = atob(payload);
    const packed = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    if (packed.length < 13) return null;
    const iv = packed.subarray(0, 12);
    const cipher = packed.subarray(12);
    const key = await loadWebAesKeyOnly(userId);
    if (!key) return null;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

async function clearWebAesKey(userId: string | null) {
  if (!userId) return;
  webAesKeyLoads.delete(userId);
  try {
    const db = await openAesKeyStore();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('keys', 'readwrite');
        tx.objectStore('keys').delete(webAesKeyId(userId));
        tx.objectStore('keys').delete(WEB_AES_KEY_ID_LEGACY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Could not clear token key'));
      });
    } finally {
      try { db.close(); } catch { /* ignore */ }
    }
  } catch {
    /* ignore */
  }
}

function clearLegacyDeviceWideKeys() {
  try {
    localStorage.removeItem(TOKEN_KEY_PLAIN);
    localStorage.removeItem(TOKEN_KEY_ENC_LEGACY);
    localStorage.removeItem(TOKEN_CONSENT_KEY_LEGACY);
  } catch {
    /* ignore */
  }
}

/** Move device-wide web token + consent into the signed-in account once. */
async function migrateLegacyWebToken(userId: string): Promise<string | null> {
  try {
    if (localStorage.getItem(tokenConsentKey(userId)) !== '1') {
      if (localStorage.getItem(TOKEN_CONSENT_KEY_LEGACY) === '1') {
        localStorage.setItem(tokenConsentKey(userId), '1');
      }
    }
    if (localStorage.getItem(tokenEncKey(userId))) return null;

    const legacyPlain = localStorage.getItem(TOKEN_KEY_PLAIN);
    if (legacyPlain && legacyPlain.trim()) {
      await persistFigmaToken(userId, legacyPlain.trim());
      clearLegacyDeviceWideKeys();
      return legacyPlain.trim();
    }

    const legacyEnc = localStorage.getItem(TOKEN_KEY_ENC_LEGACY);
    if (!legacyEnc) return null;
    const plain = await decryptTokenForWeb(userId, legacyEnc);
    if (!plain?.trim()) {
      clearLegacyDeviceWideKeys();
      return null;
    }
    await persistFigmaToken(userId, plain.trim());
    clearLegacyDeviceWideKeys();
    return plain.trim();
  } catch {
    return null;
  }
}

async function hydrateTokenForActiveAccount(userId: string): Promise<void> {
  const generation = ++hydrateGeneration;
  cachedFigmaToken = '';

  const desktop = desktopTokenApi();
  if (desktop?.figmaTokenGet) {
    try {
      const result = await desktop.figmaTokenGet(userId);
      if (generation !== hydrateGeneration || activeAccountId !== userId) return;
      if (result.ok && result.token) {
        cachedFigmaToken = result.token;
        clearLegacyDeviceWideKeys();
        return;
      }
    } catch {
      /* fall through to web storage */
    }
  }

  try {
    const migrated = await migrateLegacyWebToken(userId);
    if (generation !== hydrateGeneration || activeAccountId !== userId) return;
    if (migrated) {
      cachedFigmaToken = migrated;
      return;
    }

    const enc = localStorage.getItem(tokenEncKey(userId));
    if (enc) {
      const plain = await decryptTokenForWeb(userId, enc);
      if (generation !== hydrateGeneration || activeAccountId !== userId) return;
      if (plain) {
        cachedFigmaToken = plain;
        clearLegacyDeviceWideKeys();
        return;
      }
    }
    clearLegacyDeviceWideKeys();
  } catch {
    if (generation === hydrateGeneration && activeAccountId === userId) {
      cachedFigmaToken = '';
    }
  }
}

/**
 * Bind Figma token storage to the signed-in account (or unload when signed out).
 * Call on app start and whenever auth changes. Does not upload the token.
 */
export async function bindFigmaTokenAccount(userId: string | null | undefined): Promise<void> {
  const next = typeof userId === 'string' ? userId.trim() : '';
  if (!next) {
    hydrateGeneration += 1;
    activeAccountId = null;
    cachedFigmaToken = '';
    clearLegacyDeviceWideKeys();
    return;
  }
  if (next === activeAccountId) return;
  activeAccountId = next;
  await hydrateTokenForActiveAccount(next);
}

/**
 * Hydrate the in-memory token for the currently bound account.
 * Prefer `bindFigmaTokenAccount` with the session user id.
 */
export async function initFigmaTokenStore(userId?: string | null): Promise<void> {
  if (userId !== undefined) {
    await bindFigmaTokenAccount(userId);
    return;
  }
  if (!activeAccountId) {
    cachedFigmaToken = '';
    clearLegacyDeviceWideKeys();
    return;
  }
  await hydrateTokenForActiveAccount(activeAccountId);
}

async function persistFigmaToken(userId: string, trimmed: string): Promise<void> {
  const desktop = desktopTokenApi();
  if (desktop?.figmaTokenSet) {
    const result = await desktop.figmaTokenSet(userId, trimmed);
    if (!result.ok) throw new Error(result.error || 'Could not store Figma token securely');
    try {
      localStorage.removeItem(tokenEncKey(userId));
    } catch {
      /* ignore */
    }
    clearLegacyDeviceWideKeys();
    return;
  }

  const payload = await encryptTokenForWeb(userId, trimmed);
  localStorage.setItem(tokenEncKey(userId), payload);
  clearLegacyDeviceWideKeys();
}

/** Persist a Figma PAT (encrypted) for the signed-in account. Empty string clears. */
export async function saveFigmaToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) {
    await clearFigmaToken();
    return;
  }
  const userId = activeAccountId;
  if (!userId) {
    throw new Error('Sign in to your mokstudio account before connecting a Figma token.');
  }
  if (!hasFigmaTokenConsent(userId)) {
    throw new Error('Accept the Figma privacy notice before connecting a token.');
  }

  await persistFigmaToken(userId, trimmed);
  // Account may have switched while encrypting — never poison another user's cache.
  if (activeAccountId !== userId) return;
  cachedFigmaToken = trimmed;
  emitFigmaTokenChange(true, 'saved');
}

/**
 * Delete the stored token for the current account (Figma disconnect).
 * Clears memory + encrypted on-disk / web storage for that account.
 */
export async function clearFigmaToken(reason: 'cleared' | 'revoked' = 'cleared'): Promise<void> {
  const userId = activeAccountId;
  const hadToken = Boolean(cachedFigmaToken.trim());
  cachedFigmaToken = '';
  const desktop = desktopTokenApi();
  if (desktop?.figmaTokenClear && userId) {
    try {
      await desktop.figmaTokenClear(userId);
    } catch {
      /* ignore */
    }
  }
  if (userId) {
    try {
      localStorage.removeItem(tokenEncKey(userId));
      localStorage.removeItem(tokenConsentKey(userId));
    } catch {
      /* ignore */
    }
    await clearWebAesKey(userId);
  }
  clearLegacyDeviceWideKeys();
  if (hadToken || reason === 'revoked') {
    emitFigmaTokenChange(false, reason);
  }
}

/** Parse a Figma design / file / proto URL into fileKey + optional nodeId. */
export function parseFigmaUrl(input: string): { fileKey: string; nodeId?: string } | null {
  const raw = input.trim();
  if (!raw) return null;

  // Bare file key
  if (/^[a-zA-Z0-9]{10,128}$/.test(raw) && !raw.includes('/') && !raw.includes(':')) {
    return { fileKey: raw };
  }

  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  if (!/(^|\.)figma\.com$/i.test(url.hostname)) return null;

  const pathMatch = url.pathname.match(
    /\/(file|design|proto|board|slides|make)\/([a-zA-Z0-9]+)(?:\/|$)/,
  );
  if (!pathMatch) return null;

  const fileKey = pathMatch[2];
  const nodeParam = url.searchParams.get('node-id') ?? url.searchParams.get('nodeId');
  const nodeId = nodeParam ? nodeParam.replace(/-/g, ':') : undefined;
  return { fileKey, nodeId };
}

export function canApplyFigmaLayer(type: FigmaNodeType): boolean {
  return APPLYABLE_TYPES.has(type);
}

export function formatFigmaSize(width?: number, height?: number): string | null {
  if (width == null || height == null) return null;
  return `${Math.round(width)} × ${Math.round(height)}`;
}

type RawFigmaNode = {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  children?: RawFigmaNode[];
};

function simplifyNode(node: RawFigmaNode, depth: number): FigmaLayerNode | null {
  const visible = node.visible !== false;
  const box = node.absoluteBoundingBox;
  const children = (node.children ?? [])
    .map((child) => simplifyNode(child, depth + 1))
    .filter((child): child is FigmaLayerNode => child != null);

  const isContainer = CONTAINER_TYPES.has(node.type);
  // Keep leaf geometry only when it has no useful parent context, otherwise prune noise
  // deep in the tree — still show text/shapes under a selected frame for exploration.
  if (!isContainer && depth > 4 && children.length === 0) {
    return null;
  }

  return {
    id: node.id,
    name: node.name || node.type,
    type: node.type,
    visible,
    x: box?.x,
    y: box?.y,
    width: box?.width,
    height: box?.height,
    children,
  };
}

async function figmaApiGet(apiPath: string, token: string): Promise<unknown> {
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;

  if (window.mockupDesktop?.figmaRequest) {
    const result = await window.mockupDesktop.figmaRequest(path, token);
    let parsed: unknown = null;
    try {
      parsed = result.body ? JSON.parse(result.body) : null;
    } catch {
      throw new Error('Figma returned an invalid response');
    }
    if (result.status >= 400) {
      await throwFigmaHttpError(result.status, parsed);
    }
    return parsed;
  }

  // Browser / Vite: proxy avoids CORS
  const response = await fetch(`/api/figma${path}`, {
    headers: { 'X-Figma-Token': token },
  });
  const parsed = await response.json().catch(() => null);
  if (!response.ok) await throwFigmaHttpError(response.status, parsed);
  return parsed;
}

/**
 * Map Figma HTTP failures. Credential rejections wipe the local encrypted PAT
 * for this account so a revoked token cannot keep being reused.
 */
async function throwFigmaHttpError(status: number, body: unknown): Promise<never> {
  const message = extractFigmaErrMessage(body);
  if (isFigmaTokenCredentialFailure(status, message)) {
    await clearFigmaToken('revoked');
    throw new FigmaAuthError(
      'Your Figma token was rejected or revoked. It was removed from this account on this device — reconnect with Connect Figma token in Assets.',
    );
  }
  throw figmaError(status, body);
}

function figmaError(status: number, body: unknown): Error {
  const message = extractFigmaErrMessage(body);

  if (status === 403 || status === 401) {
    return new Error(message || 'Figma token is missing or does not have access to this file.');
  }
  if (status === 404) {
    return new Error(message || 'Figma file not found. Check the link and sharing settings.');
  }
  if (status === 429) {
    return new Error('Figma rate limit hit — wait a moment and try again.');
  }
  return new Error(message || `Figma request failed (${status})`);
}

/**
 * Cap document tree depth for explore/import. Full unbounded `/files/:key`
 * payloads were freezing the renderer on large designs.
 */
export const FIGMA_FILE_TREE_DEPTH = 4;

/** Lightweight lastModified probe (depth=1) for out-of-date checks. */
export async function fetchFigmaFileLastModified(
  fileKey: string,
  token = loadFigmaToken(),
): Promise<string | null> {
  const trimmed = token.trim();
  if (!trimmed || !fileKey) return null;
  const data = await figmaApiGet(
    `/files/${encodeURIComponent(fileKey)}?depth=1`,
    trimmed,
  ) as { lastModified?: string };
  return typeof data.lastModified === 'string' ? data.lastModified : null;
}

export async function fetchFigmaFile(fileKey: string, token: string): Promise<FigmaFileSummary> {
  const trimmedToken = token.trim();
  if (!trimmedToken) throw new Error('Add a Figma personal access token first.');
  if (!fileKey) throw new Error('Paste a Figma file URL or key.');

  const data = await figmaApiGet(
    `/files/${encodeURIComponent(fileKey)}?depth=${FIGMA_FILE_TREE_DEPTH}`,
    trimmedToken,
  ) as {
    name?: string;
    lastModified?: string;
    thumbnailUrl?: string;
    document?: RawFigmaNode;
    err?: string;
  };

  if (!data.document) throw new Error(data.err || 'Figma file had no document tree.');

  const root = simplifyNode(data.document, 0);
  const layers = root?.children?.length ? root.children : root ? [root] : [];

  return {
    fileKey,
    name: data.name || 'Figma file',
    lastModified: data.lastModified,
    thumbnailUrl: data.thumbnailUrl,
    layers,
  };
}

/**
 * Fetch one node (+ shallow children) via `/files/:key/nodes` — avoids reloading
 * the whole document when exporting explode plates.
 */
async function fetchFigmaNodeSubtree(
  fileKey: string,
  nodeId: string,
  token: string,
  depth = 2,
): Promise<{ root: FigmaLayerNode; lastModified?: string; fileName?: string }> {
  const query = new URLSearchParams({
    ids: nodeId,
    depth: String(Math.max(1, depth)),
  });
  const data = await figmaApiGet(
    `/files/${encodeURIComponent(fileKey)}/nodes?${query.toString()}`,
    token,
  ) as {
    name?: string;
    lastModified?: string;
    err?: string;
    nodes?: Record<string, { document?: RawFigmaNode; err?: string } | null>;
  };

  const entry = data.nodes?.[nodeId] ?? data.nodes?.[Object.keys(data.nodes || {})[0] || ''];
  if (!entry?.document) {
    throw new Error(entry?.err || data.err || 'Could not load that Figma layer.');
  }
  const root = simplifyNode(entry.document, 0);
  if (!root) throw new Error('Figma layer tree was empty.');
  return {
    root,
    lastModified: data.lastModified,
    fileName: data.name,
  };
}

export async function exportFigmaNodeAsDataUrl(
  fileKey: string,
  nodeId: string,
  token: string,
  scale = 2,
): Promise<{ dataUrl: string; nameHint: string }> {
  const map = await exportFigmaNodesAsDataUrls(fileKey, [nodeId], token, scale);
  const dataUrl = map.get(nodeId);
  if (!dataUrl) throw new Error('Figma could not export that layer. Try a frame or component.');
  return { dataUrl, nameHint: `figma-${nodeId.replace(/[:]/g, '-')}.png` };
}

/** Batch-export node PNGs (Figma images API accepts comma-separated ids). */
export async function exportFigmaNodesAsDataUrls(
  fileKey: string,
  nodeIds: string[],
  token: string,
  scale = 2,
): Promise<Map<string, string>> {
  const trimmedToken = token.trim();
  if (!trimmedToken) throw new Error('Add a Figma personal access token first.');
  const unique = [...new Set(nodeIds.filter(Boolean))];
  if (!unique.length) return new Map();

  const query = new URLSearchParams({
    ids: unique.join(','),
    format: 'png',
    scale: String(Math.min(4, Math.max(1, scale))),
  });

  const data = await figmaApiGet(
    `/images/${encodeURIComponent(fileKey)}?${query.toString()}`,
    trimmedToken,
  ) as {
    err?: string;
    images?: Record<string, string | null>;
  };

  if (data.err) throw new Error(data.err);

  const out = new Map<string, string>();
  // Keep successful plates when one image fetch fails — callers decide if <2 remains.
  const settled = await Promise.allSettled(unique.map(async (id) => {
    const imageUrl = data.images?.[id];
    if (!imageUrl) return null;
    const dataUrl = await fetchImageAsDataUrl(imageUrl, trimmedToken);
    return [id, dataUrl] as const;
  }));
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value) {
      out.set(result.value[0], result.value[1]);
    } else if (result.status === 'rejected') {
      console.warn('[figma] layer image fetch failed', result.reason);
    }
  }
  return out;
}

/** Containers that must not become a single 3D card — expand to their children. */
const EXPANDABLE_CONTAINER_TYPES = new Set([
  'FRAME',
  'GROUP',
  'SECTION',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
]);

/**
 * Direct children of a frame/group (bottom → top). Kept for tree UI / flat previews.
 * Prefer `explodeSubgroupCandidates` for 3D explosion/extrusion plates.
 */
export function explodeCandidates(node: FigmaLayerNode, limit = 16): FigmaLayerNode[] {
  // Direct children only — do not recurse.
  const kids = node.children.filter((child) => child.visible !== false);
  if (!kids.length) return [];
  // Figma lists children bottom → top; keep that order for the stack
  const cap = Math.max(1, Math.min(16, limit));
  return kids.slice(-cap);
}

export type ExplodeSubgroupCandidate = {
  node: FigmaLayerNode;
  /** Parent frame/group when this plate was expanded out of a container. */
  groupId?: string;
  groupName?: string;
};

/**
 * Build 3D explode plates by expanding top-level containers into their children.
 * Frame/group/section rasters are skipped so the whole import never becomes one card.
 * Leaf top-level nodes stay as their own plate.
 */
export function explodeSubgroupCandidates(
  node: FigmaLayerNode,
  limit = 16,
): ExplodeSubgroupCandidate[] {
  const kids = node.children.filter((child) => child.visible !== false);
  if (!kids.length) return [];
  const cap = Math.max(1, Math.min(16, limit));
  const out: ExplodeSubgroupCandidate[] = [];

  for (const child of kids) {
    const nested = (child.children || []).filter((piece) => piece.visible !== false);
    const expand = EXPANDABLE_CONTAINER_TYPES.has(child.type) && nested.length > 0;
    if (expand) {
      for (const piece of nested) {
        out.push({
          node: piece,
          groupId: child.id,
          groupName: child.name,
        });
      }
    } else {
      out.push({ node: child });
    }
  }

  // Expansion produced nothing useful (e.g. empty nested trees) — fall back to direct kids.
  if (out.length < 2 && kids.length >= 2) {
    return kids.slice(-cap).map((child) => ({ node: child }));
  }
  // Prefer topmost (painter's front) plates when over the cap — matches explodeCandidates.
  return out.length > cap ? out.slice(-cap) : out;
}

export function buildFigmaNodeUrl(fileKey: string, nodeId?: string): string {
  const base = `https://www.figma.com/design/${encodeURIComponent(fileKey)}`;
  if (!nodeId) return base;
  return `${base}?node-id=${encodeURIComponent(nodeId.replace(/:/g, '-'))}`;
}

export function findFigmaNode(nodes: FigmaLayerNode[], id: string): FigmaLayerNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const nested = findFigmaNode(node.children, id);
    if (nested) return nested;
  }
  return null;
}

export type FigmaDirectChildPlate = {
  id: string;
  name: string;
  dataUrl: string;
  /** Figma node type — used to skip extruding top-level containers. */
  layerType?: string;
  /** Subgroup parent when this plate was expanded from a frame/group. */
  extrusionGroup?: string;
};

export type FigmaPlateTreeSource = {
  /** Already-loaded explore tree — skips another `/files` round-trip. */
  layers?: FigmaLayerNode[];
  lastModified?: string;
};

/**
 * Export 3D explode plates for `nodeId`.
 * Top-level frames/groups are expanded into their children so the layout is
 * driven by subgroups — never one card per parent frame.
 * Always loads a depth≥3 subtree so nested children exist for expansion
 * (explore trees can be depth-truncated).
 */
export async function exportFigmaDirectChildPlates(
  fileKey: string,
  nodeId: string,
  token = loadFigmaToken(),
  scale = 1.5,
  tree?: FigmaPlateTreeSource,
): Promise<{
  rootName: string;
  lastModified?: string;
  plates: FigmaDirectChildPlate[];
  url: string;
}> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error('Connect a Figma personal access token first.');

  // Depth 3: node → direct children → grandchildren (subgroup pieces).
  const subtree = await fetchFigmaNodeSubtree(fileKey, nodeId, trimmed, 3);
  let root = subtree.root;
  let lastModified = subtree.lastModified || tree?.lastModified;

  // If the explore tree has a richer name for the same id, prefer it.
  if (tree?.layers?.length) {
    const fromTree = findFigmaNode(tree.layers, nodeId);
    if (fromTree?.name) root = { ...root, name: fromTree.name };
  }

  const candidates = explodeSubgroupCandidates(root);
  if (candidates.length < 2) {
    return {
      rootName: root.name,
      lastModified,
      plates: [],
      url: buildFigmaNodeUrl(fileKey, nodeId),
    };
  }
  const images = await exportFigmaNodesAsDataUrls(
    fileKey,
    candidates.map((entry) => entry.node.id),
    trimmed,
    scale,
  );
  const rootBox = nodeBounds(root);
  const plates: FigmaDirectChildPlate[] = [];
  for (const entry of candidates) {
    const raw = images.get(entry.node.id);
    if (!raw) continue;
    const layerBox = nodeBounds(entry.node);
    let dataUrl = raw;
    if (rootBox && layerBox) {
      try {
        dataUrl = await padLayerImageToRoot(raw, layerBox, rootBox);
      } catch {
        dataUrl = raw;
      }
    }
    plates.push({
      id: entry.node.id,
      name: entry.node.name,
      dataUrl,
      layerType: entry.node.type,
      ...(entry.groupId
        ? { extrusionGroup: entry.groupName || entry.groupId }
        : {}),
    });
  }
  return {
    rootName: root.name,
    lastModified,
    plates,
    url: buildFigmaNodeUrl(fileKey, nodeId),
  };
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load layer preview'));
    img.src = src;
  });
}

type LayerBounds = { x: number; y: number; width: number; height: number };

function nodeBounds(node: FigmaLayerNode): LayerBounds | null {
  if (
    typeof node.x !== 'number'
    || typeof node.y !== 'number'
    || typeof node.width !== 'number'
    || typeof node.height !== 'number'
    || !(node.width > 0)
    || !(node.height > 0)
  ) {
    return null;
  }
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

/**
 * Figma's images API returns tight crops. Pad each crop onto a transparent
 * parent-sized canvas so flat composites and 3D plates keep layout.
 */
export async function padLayerImageToRoot(
  dataUrl: string,
  layer: LayerBounds,
  root: LayerBounds,
): Promise<string> {
  const rootW = Math.max(2, Math.round(root.width));
  const rootH = Math.max(2, Math.round(root.height));
  const img = await loadImageElement(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = rootW;
  canvas.height = rootH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  const dx = Math.round(layer.x - root.x);
  const dy = Math.round(layer.y - root.y);
  const dw = Math.max(1, Math.round(layer.width));
  const dh = Math.max(1, Math.round(layer.height));
  ctx.drawImage(img, dx, dy, dw, dh);
  const padded = canvas.toDataURL('image/png');
  img.src = '';
  return padded;
}

/** Composite exploded layer plates into one transparent PNG for the phone screen. */
export async function compositeExplodeStack(
  plates: { dataUrl: string; name: string }[],
  amount: number,
): Promise<string> {
  if (!plates.length) throw new Error('No layers to explode');
  const images = await Promise.all(plates.map((plate) => loadImageElement(plate.dataUrl)));
  const maxW = Math.max(...images.map((img) => img.naturalWidth || img.width));
  const maxH = Math.max(...images.map((img) => img.naturalHeight || img.height));
  const gap = Math.round(28 + amount * 54);
  const skewX = amount * 0.18;
  const rise = Math.round(18 + amount * 36);

  const canvas = document.createElement('canvas');
  const padX = Math.round(maxW * skewX + 48);
  const padY = rise * (plates.length - 1) + gap + 48;
  canvas.width = Math.max(2, maxW + padX * 2);
  canvas.height = Math.max(2, maxH + padY);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not draw explode view');

  images.forEach((img, index) => {
    const t = plates.length <= 1 ? 0 : index / (plates.length - 1);
    const offsetY = -Math.round(t * rise * (0.65 + amount));
    const offsetX = Math.round(t * maxW * skewX);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const x = (canvas.width - w) / 2 + offsetX;
    const y = canvas.height - h - 24 + offsetY - Math.round((1 - t) * gap * 0.15);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 18 + amount * 10;
    ctx.shadowOffsetY = 8;
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  });

  const url = canvas.toDataURL('image/png');
  for (const img of images) img.src = '';
  return url;
}

async function fetchImageAsDataUrl(imageUrl: string, token: string): Promise<string> {
  if (window.mockupDesktop?.figmaFetchImage) {
    const result = await window.mockupDesktop.figmaFetchImage(imageUrl, token);
    if (!result.ok || !result.dataUrl) {
      throw new Error(result.error || 'Could not download the Figma export.');
    }
    return result.dataUrl;
  }

  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error('Could not download the Figma export.');
  const blob = await response.blob();
  return readBlobAsDataUrl(blob);
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read exported image'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

/**
 * If the clipboard text is a Figma design URL with a node-id, export that
 * frame/component. Prefers direct-child plates when the node has 2+ children;
 * otherwise a single flattened PNG of the node.
 */
export async function exportFigmaUrlAsScreenPng(
  rawUrl: string,
  token = loadFigmaToken(),
  scale = 2,
): Promise<{ dataUrl: string; name: string; plates?: FigmaDirectChildPlate[]; source?: {
  url: string;
  fileKey: string;
  nodeId: string;
  lastModified: string;
  rootName?: string;
  layered: boolean;
} } | null> {
  const parsed = parseFigmaUrl(rawUrl);
  if (!parsed?.fileKey || !parsed.nodeId) return null;
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('Connect a Figma personal access token in Assets, then paste again.');
  }
  const layered = await exportFigmaDirectChildPlates(parsed.fileKey, parsed.nodeId, trimmed, Math.min(scale, 1.5));
  if (layered.plates.length >= 2) {
    const { compositeFlatScreenStack } = await import('./screenLayers');
    const flatDataUrl = await compositeFlatScreenStack(layered.plates);
    return {
      dataUrl: flatDataUrl,
      name: layered.rootName,
      plates: layered.plates,
      source: {
        url: layered.url || rawUrl.trim(),
        fileKey: parsed.fileKey,
        nodeId: parsed.nodeId,
        lastModified: layered.lastModified || new Date().toISOString(),
        rootName: layered.rootName,
        layered: true,
      },
    };
  }
  const { dataUrl, nameHint } = await exportFigmaNodeAsDataUrl(
    parsed.fileKey,
    parsed.nodeId,
    trimmed,
    scale,
  );
  return {
    dataUrl,
    name: nameHint,
    source: {
      url: buildFigmaNodeUrl(parsed.fileKey, parsed.nodeId),
      fileKey: parsed.fileKey,
      nodeId: parsed.nodeId,
      lastModified: layered.lastModified || new Date().toISOString(),
      rootName: layered.rootName || nameHint,
      layered: false,
    },
  };
}

/** True when the clipboard HTML is a Figma ⌘C selection (not Copy as PNG). */
export function isFigmaClipboardHtml(html: string | null | undefined): boolean {
  if (!html) return false;
  return html.includes('(figmeta)') && html.includes('(figma)');
}

type FigmaClipboardGuid = { sessionID?: number; localID?: number };
type FigmaClipboardMeta = {
  fileKey?: string;
  pasteID?: number;
  dataType?: string;
  /** Newer Figma ⌘C meta: `"180:43|4|0|0"` — node id is the first segment. */
  selectedNodeData?: string;
};
type FigmaClipboardMessage = {
  pasteFileKey?: string;
  clipboardSelectionRegions?: Array<{ nodes?: FigmaClipboardGuid[] }>;
  nodeChanges?: Array<{ guid?: FigmaClipboardGuid; type?: string; name?: string }>;
};

function decodeBase64Bytes(b64: string): Uint8Array {
  const cleaned = b64.replace(/\s+/g, '');
  const binary = atob(cleaned);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Chromium sometimes entity-encodes the Figma markers inside attribute values. */
function unescapeClipboardHtml(html: string): string {
  return html
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function extractFigmaClipboardParts(html: string): { metaB64: string; figB64: string | null } | null {
  const raw = unescapeClipboardHtml(html);
  const metaMatch = raw.match(/<!--\(figmeta\)([\s\S]*?)\(\/figmeta\)-->/);
  if (!metaMatch?.[1]) return null;
  const figMatch = raw.match(/<!--\(figma\)([\s\S]*?)\(\/figma\)-->/);
  return { metaB64: metaMatch[1], figB64: figMatch?.[1] ?? null };
}

function guidToNodeId(guid: FigmaClipboardGuid | undefined): string | null {
  if (guid == null || guid.sessionID == null || guid.localID == null) return null;
  return `${guid.sessionID}:${guid.localID}`;
}

/** Parse `"180:43|4|0|0"` / `"12:34"` style selection hints from figmeta. */
function nodeIdsFromSelectedNodeData(value: string | undefined): string[] {
  if (!value) return [];
  const ids: string[] = [];
  for (const chunk of value.split(',')) {
    const head = chunk.trim().split('|')[0]?.trim();
    if (head && /^\d+:\d+$/.test(head) && !ids.includes(head)) ids.push(head);
  }
  return ids;
}

function parseFigKiwiArchive(data: Uint8Array): { schemaBytes: Uint8Array; messageBytes: Uint8Array } {
  const prelude = 'fig-kiwi';
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  let head = '';
  for (let i = 0; i < prelude.length; i += 1) head += String.fromCharCode(data[i] ?? 0);
  if (head !== prelude) throw new Error('Clipboard was not a Figma selection');
  offset += prelude.length;
  offset += 4; // version
  const chunks: Uint8Array[] = [];
  while (offset + 4 <= data.byteLength) {
    const size = view.getUint32(offset, true);
    offset += 4;
    if (offset + size > data.byteLength) break;
    chunks.push(data.subarray(offset, offset + size));
    offset += size;
  }
  if (chunks.length < 2) throw new Error('Figma clipboard payload was incomplete');
  return { schemaBytes: chunks[0], messageBytes: chunks[1] };
}

function nodeIdsFromKiwiMessage(message: FigmaClipboardMessage): { nodeIds: string[]; nameHint?: string } {
  const selected: string[] = [];
  for (const region of message.clipboardSelectionRegions ?? []) {
    for (const node of region.nodes ?? []) {
      const id = guidToNodeId(node);
      if (id && !selected.includes(id)) selected.push(id);
    }
  }

  if (!selected.length) {
    for (const change of message.nodeChanges ?? []) {
      const id = guidToNodeId(change.guid);
      if (!id || selected.includes(id)) continue;
      if (
        change.type === 'FRAME'
        || change.type === 'COMPONENT'
        || change.type === 'INSTANCE'
        || change.type === 'SECTION'
        || change.type === 'GROUP'
        || selected.length === 0
      ) {
        selected.push(id);
        if (change.type === 'FRAME' || change.type === 'COMPONENT' || change.type === 'INSTANCE') break;
      }
    }
  }

  const named = (message.nodeChanges ?? []).find((change) => guidToNodeId(change.guid) === selected[0]);
  return {
    nodeIds: selected,
    nameHint: named?.name ? `${named.name}.png` : undefined,
  };
}

/**
 * Decode a Figma ⌘C HTML paste into fileKey + selected node ids.
 * Prefer figmeta.selectedNodeData (no binary parse). Fall back to fig-kiwi.
 */
export function parseFigmaClipboardHtml(html: string): { fileKey: string; nodeIds: string[]; nameHint?: string } | null {
  if (!isFigmaClipboardHtml(html) && !html.includes('data-metadata')) return null;
  const parts = extractFigmaClipboardParts(html);
  if (!parts) return null;

  let meta: FigmaClipboardMeta = {};
  try {
    meta = JSON.parse(new TextDecoder().decode(decodeBase64Bytes(parts.metaB64))) as FigmaClipboardMeta;
  } catch {
    return null;
  }

  const fileKey = (meta.fileKey || '').trim();
  const fromMeta = nodeIdsFromSelectedNodeData(meta.selectedNodeData);
  if (fileKey && fromMeta.length) {
    return { fileKey, nodeIds: fromMeta };
  }

  if (!parts.figB64) {
    if (!fileKey) return null;
    throw new Error('Could not read that Figma selection. Try Copy as PNG (⇧⌘C).');
  }

  try {
    const archive = parseFigKiwiArchive(decodeBase64Bytes(parts.figB64));
    const schema = decodeBinarySchema(inflateRaw(archive.schemaBytes));
    const compiled = compileSchema(schema) as {
      decodeMessage: (data: Uint8Array) => FigmaClipboardMessage;
    };
    const message = compiled.decodeMessage(inflateRaw(archive.messageBytes));
    const key = fileKey || (message.pasteFileKey || '').trim();
    if (!key) return null;
    const fromKiwi = nodeIdsFromKiwiMessage(message);
    if (!fromKiwi.nodeIds.length) return null;
    return { fileKey: key, nodeIds: fromKiwi.nodeIds, nameHint: fromKiwi.nameHint };
  } catch (error) {
    if (fileKey && fromMeta.length) return { fileKey, nodeIds: fromMeta };
    if (error instanceof Error && error.message.startsWith('Could not read')) throw error;
    throw new Error('Could not read that Figma selection. Try Copy as PNG (⇧⌘C), or update and paste again.');
  }
}

/**
 * Turn a Figma ⌘C HTML clipboard payload into screen art.
 * When the selection has 2+ direct children, returns separate plates (no recursive split).
 */
export async function exportFigmaClipboardHtmlAsScreenPng(
  html: string,
  token = loadFigmaToken(),
  scale = 2,
): Promise<{ dataUrl: string; name: string; plates?: FigmaDirectChildPlate[]; source?: {
  url: string;
  fileKey: string;
  nodeId: string;
  lastModified: string;
  rootName?: string;
  layered: boolean;
} } | null> {
  const parsed = parseFigmaClipboardHtml(html);
  if (!parsed) return null;
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('Connect a Figma personal access token in Assets, then paste again (⌘C from Figma works).');
  }
  // One selected layer is the common case; if several are selected, export the first.
  const nodeId = parsed.nodeIds[0];
  const layered = await exportFigmaDirectChildPlates(parsed.fileKey, nodeId, trimmed, Math.min(scale, 1.5));
  if (layered.plates.length >= 2) {
    const { compositeFlatScreenStack } = await import('./screenLayers');
    const flatDataUrl = await compositeFlatScreenStack(layered.plates);
    return {
      dataUrl: flatDataUrl,
      name: parsed.nameHint || layered.rootName,
      plates: layered.plates,
      source: {
        url: layered.url,
        fileKey: parsed.fileKey,
        nodeId,
        lastModified: layered.lastModified || new Date().toISOString(),
        rootName: layered.rootName,
        layered: true,
      },
    };
  }
  const { dataUrl, nameHint } = await exportFigmaNodeAsDataUrl(
    parsed.fileKey,
    nodeId,
    trimmed,
    scale,
  );
  return {
    dataUrl,
    name: parsed.nameHint || nameHint,
    source: {
      url: buildFigmaNodeUrl(parsed.fileKey, nodeId),
      fileKey: parsed.fileKey,
      nodeId,
      lastModified: layered.lastModified || new Date().toISOString(),
      rootName: layered.rootName || parsed.nameHint || nameHint,
      layered: false,
    },
  };
}

/** Direct API base — used by Electron main process only. */
export const FIGMA_API_BASE = FIGMA_API;
