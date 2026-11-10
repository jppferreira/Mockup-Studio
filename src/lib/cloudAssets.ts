/**
 * Content-addressed project media uploads to the private `project-assets` bucket.
 * Paths are `{userId}/{hash}.{ext}` so unchanged blobs are not re-uploaded.
 */

import { isPlaceholderScreenshot } from './demo';
import { ensureFreshSession, getSupabase } from './supabaseClient';
import { getAssetBlob, putAssetBlob } from './projectStore';
import {
  assetRefFromHash,
  hashFromAssetRef,
  hydrateSceneAssets,
  type SceneAssetRef,
  type SceneDocument,
} from './sceneDocument';
import type { MockupProject } from '../types';

export const PROJECT_ASSETS_BUCKET = 'project-assets';
const SIGNED_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days for previews / reopen
/**
 * Device screenshots are often several MB. Anything under this still uploads so the
 * other device can download it. Larger clips stay local rather than stalling sync.
 */
const MAX_ASSET_UPLOAD_BYTES = 20_000_000;

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
};

function extForMime(mime: string) {
  return EXT_BY_MIME[mime.toLowerCase()] || 'bin';
}

export function storageObjectPath(userId: string, hash: string, mime: string) {
  return `${userId}/${hash}.${extForMime(mime)}`;
}

export function previewStorageKey(userId: string, hash: string, mime: string) {
  return `${PROJECT_ASSETS_BUCKET}/${storageObjectPath(userId, hash, mime)}`;
}

/** Upload a blob if missing; returns the storage-relative key (`project-assets/...`). */
export async function uploadProjectAsset(
  userId: string,
  hash: string,
  mime: string,
  bytes: Uint8Array,
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Cloud sync is not configured.' };

  const path = storageObjectPath(userId, hash, mime);
  const key = `${PROJECT_ASSETS_BUCKET}/${path}`;

  // Upsert directly — avoids a slow list round-trip that can stall Sync now.
  const { error } = await sb.storage.from(PROJECT_ASSETS_BUCKET).upload(path, bytes, {
    contentType: mime,
    upsert: true,
    cacheControl: '31536000',
  });
  if (error && !/already exists|Duplicate/i.test(error.message)) {
    return { ok: false, error: error.message };
  }
  return { ok: true, key };
}

export async function createSignedAssetUrl(
  keyOrPath: string,
  expiresIn = SIGNED_TTL_SECONDS,
): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const path = keyOrPath.startsWith(`${PROJECT_ASSETS_BUCKET}/`)
    ? keyOrPath.slice(PROJECT_ASSETS_BUCKET.length + 1)
    : keyOrPath;
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const { data, error } = await sb.storage.from(PROJECT_ASSETS_BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

async function bytesFromDataUrl(dataUrl: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
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

async function resolveLocalBytes(
  value: string,
  assets: SceneAssetRef[],
): Promise<{ hash: string; mime: string; bytes: Uint8Array } | null> {
  const assetHash = hashFromAssetRef(value);
  if (assetHash) {
    const meta = assets.find((item) => item.hash === assetHash);
    const blob = await getAssetBlob(assetHash);
    if (!blob) return null;
    return {
      hash: assetHash,
      mime: meta?.mime || blob.mime || 'application/octet-stream',
      bytes: new Uint8Array(blob.bytes),
    };
  }
  if (!value.startsWith('data:')) return null;
  const parsed = await bytesFromDataUrl(value);
  if (!parsed) return null;
  // Hash via SubtleCrypto when available.
  let hash: string;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      parsed.bytes.buffer.slice(
        parsed.bytes.byteOffset,
        parsed.bytes.byteOffset + parsed.bytes.byteLength,
      ) as ArrayBuffer,
    );
    hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } else {
    hash = `local_${parsed.bytes.byteLength}_${Date.now().toString(36)}`;
  }
  return { hash, mime: parsed.mime, bytes: parsed.bytes };
}

/**
 * Ensure document asset blobs (and a small preview) live in Storage.
 * Returns storage key for preview + any upload errors (non-fatal for tiny payloads).
 */
export async function uploadDocumentAssets(
  userId: string,
  doc: SceneDocument,
): Promise<{ previewKey: string | null; previewHash: string | null; errors: string[] }> {
  const errors: string[] = [];
  const scene = doc.scene;
  const candidates: string[] = [];
  const pushCandidate = (value: string | null | undefined) => {
    if (typeof value === 'string' && value) candidates.push(value);
  };
  pushCandidate(scene.screenshot);
  pushCandidate(scene.reflectionMapImage);
  for (const device of scene.devices ?? []) {
    pushCandidate(device.screenshot);
    for (const layer of device.screenLayers ?? []) pushCandidate(layer.dataUrl);
  }
  for (const overlay of scene.overlays ?? []) pushCandidate(overlay.imageData);
  for (const composition of scene.scenes ?? []) {
    const stage = composition.stage;
    if (!stage) continue;
    pushCandidate(stage.reflectionMapImage);
    for (const device of stage.devices ?? []) {
      pushCandidate(device.screenshot);
      for (const layer of device.screenLayers ?? []) pushCandidate(layer.dataUrl);
    }
    for (const overlay of stage.overlays ?? []) pushCandidate(overlay.imageData);
  }

  for (const asset of doc.assets) {
    const blob = await getAssetBlob(asset.hash);
    if (!blob) continue;
    if (blob.bytes.byteLength > MAX_ASSET_UPLOAD_BYTES) continue;
    const result = await uploadProjectAsset(userId, asset.hash, asset.mime, new Uint8Array(blob.bytes));
    if (!result.ok) errors.push(result.error);
  }

  let previewKey: string | null = null;
  let previewHash: string | null = null;
  for (const candidate of candidates) {
    if (isPlaceholderScreenshot(candidate)) continue;
    const resolved = await resolveLocalBytes(candidate, doc.assets);
    if (!resolved) continue;
    if (resolved.bytes.byteLength < 64) continue;
    // Prefer image previews under ~400KB for the dashboard thumb.
    if (!resolved.mime.startsWith('image/')) continue;
    if (resolved.bytes.byteLength > 400_000) continue;
    const uploaded = await uploadProjectAsset(userId, resolved.hash, resolved.mime, resolved.bytes);
    if (!uploaded.ok) {
      errors.push(uploaded.error);
      continue;
    }
    previewKey = uploaded.key;
    previewHash = resolved.hash;
    break;
  }

  return { previewKey, previewHash, errors };
}

const DOWNLOAD_MIME_FALLBACKS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

async function downloadProjectAsset(
  userId: string,
  hash: string,
  mime: string,
): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const mimes = [mime, ...DOWNLOAD_MIME_FALLBACKS.filter((item) => item !== mime)];
  for (const candidate of mimes) {
    const path = storageObjectPath(userId, hash, candidate);
    const { data, error } = await sb.storage.from(PROJECT_ASSETS_BUCKET).download(path);
    if (error || !data) continue;
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (!bytes.byteLength) continue;
    return { mime: candidate, bytes };
  }
  return null;
}

/** Replace `asset:sha256:` media with bytes from this device or cloud storage. */
export async function hydrateCloudMediaUrls(
  project: MockupProject,
  assets: SceneAssetRef[] = [],
): Promise<MockupProject> {
  const byHash = new Map(assets.map((asset) => [asset.hash, asset]));
  let userId: string | null = null;
  const snap = await ensureFreshSession().catch(() => null);
  if (snap?.user?.id) userId = snap.user.id;

  return hydrateSceneAssets(project, async (hash) => {
    const local = await getAssetBlob(hash);
    if (local) return { mime: local.mime, bytes: new Uint8Array(local.bytes) };
    if (!userId) return null;
    const downloaded = await downloadProjectAsset(
      userId,
      hash,
      byHash.get(hash)?.mime || 'image/png',
    );
    if (!downloaded) return null;
    await putAssetBlob(hash, downloaded.mime, downloaded.bytes);
    return downloaded;
  });
}

export { assetRefFromHash };
