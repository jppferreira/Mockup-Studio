/**
 * In-browser cloud library: pick a folder that iCloud / Drive / Dropbox already
 * syncs, then read/write `.mockup` files there — same on-disk layout as the Mac app.
 */
import { libraryDelete, libraryGet, libraryPut } from './libraryDb';
import { decodeMockupFile, encodeMockupFile } from './projectFile';
import type { CloudLibraryStatus, CloudListRow, CloudProvider } from './cloudLibrary';

const HANDLE_KEY = 'cloud-library-dir';
const CONFIG_KEY = 'cloud-library-config';
const TEMPLATES_FILE_NAME = 'templates.library.json';
const LIBRARY_FOLDER_NAME = 'mokstudio';
const MAX_BYTES = 45_000_000;
const MAX_TEMPLATES_BYTES = 8_000_000;
const PREVIEW_LIMIT = 280_000;
const SLIM_MEDIA_LIMIT = 180_000;
const POLL_MS = 2500;

type DirHandle = FileSystemDirectoryHandle;
type FileHandle = FileSystemFileHandle;

interface StoredConfig {
  provider: CloudProvider;
  folderName: string;
}

interface WritePayload {
  filePath?: string | null;
  contents: string;
  name: string;
}

const changeListeners = new Set<() => void>();
let pollTimer: number | null = null;
let notifyTimer: number | null = null;
let lastFingerprint = '';

function supportsPicker() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export function supportsWebCloudLibrary() {
  return supportsPicker();
}

function isCloudProjectName(name: string) {
  const lower = name.toLowerCase();
  return lower.endsWith('.mockup') || lower.endsWith('.mockup.json');
}

function stripProjectExtension(name: string) {
  return name.replace(/\.mockup\.json$/i, '').replace(/\.mockup$/i, '');
}

function sanitizeName(name: string) {
  return String(name || 'Mockup').replace(/[^\w .-]/g, '').trim().slice(0, 80) || 'Mockup';
}

function providerLabel(provider: CloudProvider | null) {
  if (provider === 'icloud') return 'iCloud Drive';
  if (provider === 'google-drive') return 'Google Drive';
  return 'your folder';
}

function folderLabel(provider: CloudProvider | null, folderName: string) {
  if (provider === 'icloud') return `iCloud Drive/${folderName || LIBRARY_FOLDER_NAME}`;
  if (provider === 'google-drive') return `Google Drive/${folderName || LIBRARY_FOLDER_NAME}`;
  return folderName || 'chosen folder';
}

async function ensurePermission(handle: DirHandle, mode: 'read' | 'readwrite' = 'readwrite') {
  const opts: FileSystemHandlePermissionDescriptor = { mode };
  const current = await handle.queryPermission(opts);
  if (current === 'granted') return true;
  const next = await handle.requestPermission(opts);
  return next === 'granted';
}

async function loadStored(): Promise<{ handle: DirHandle; config: StoredConfig } | null> {
  const handle = await libraryGet<DirHandle>('meta', HANDLE_KEY);
  const config = await libraryGet<StoredConfig>('meta', CONFIG_KEY);
  if (!handle || !config?.folderName) return null;
  return { handle, config };
}

async function persist(handle: DirHandle, provider: CloudProvider) {
  const config: StoredConfig = { provider, folderName: handle.name };
  await libraryPut('meta', HANDLE_KEY, handle);
  await libraryPut('meta', CONFIG_KEY, config);
  lastFingerprint = '';
  restartPoll();
  return config;
}

async function clearStored() {
  stopPoll();
  lastFingerprint = '';
  await libraryDelete('meta', HANDLE_KEY);
  await libraryDelete('meta', CONFIG_KEY);
}

function webPlaceDetail(kind: 'icloud' | 'google-drive') {
  if (kind === 'icloud') {
    return 'Choose the mokstudio folder inside iCloud Drive so this browser and the Mac app share the same files.';
  }
  return 'Choose the mokstudio folder inside Google Drive so this browser and the Mac app share the same files.';
}

function baseStatus(
  configured: boolean,
  provider: CloudProvider | null,
  folderName: string | null,
  missing: boolean,
): CloudLibraryStatus {
  return {
    configured,
    provider,
    label: configured ? providerLabel(provider) : null,
    folderLabel: configured && folderName ? folderLabel(provider, folderName) : null,
    path: configured && folderName ? folderName : null,
    missing,
    icloud: {
      available: true,
      detail: webPlaceDetail('icloud'),
    },
    googleDrive: {
      available: true,
      detail: webPlaceDetail('google-drive'),
      readable: true,
    },
  };
}

export async function webCloudStatus(): Promise<CloudLibraryStatus> {
  if (!supportsPicker()) {
    return {
      ...baseStatus(false, null, null, false),
      icloud: {
        available: false,
        detail: 'This browser cannot open a local sync folder. Use Chrome, Edge, or the Mac app.',
      },
      googleDrive: {
        available: false,
        detail: 'This browser cannot open a local sync folder. Use Chrome, Edge, or the Mac app.',
        readable: false,
      },
    };
  }
  const stored = await loadStored();
  if (!stored) return baseStatus(false, null, null, false);
  const permitted = await ensurePermission(stored.handle, 'read').catch(() => false);
  if (!permitted) {
    return baseStatus(true, stored.config.provider, stored.config.folderName, true);
  }
  return baseStatus(true, stored.config.provider, stored.config.folderName, false);
}

async function pickDirectory(startIn?: DirHandle): Promise<DirHandle | null> {
  if (typeof window.showDirectoryPicker !== 'function') {
    throw new Error('Folder sync needs Chrome, Edge, or the Mac app.');
  }
  try {
    return await window.showDirectoryPicker({
      id: 'mokstudio-cloud-library',
      mode: 'readwrite',
      startIn: startIn ?? 'documents',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

async function resolveLibraryHandle(picked: DirHandle, nestMokstudio: boolean): Promise<DirHandle> {
  if (!nestMokstudio || picked.name === LIBRARY_FOLDER_NAME) return picked;
  return picked.getDirectoryHandle(LIBRARY_FOLDER_NAME, { create: true });
}

export async function webCloudUse(
  provider: 'icloud' | 'google-drive',
): Promise<{ canceled: boolean; status: CloudLibraryStatus }> {
  if (!supportsPicker()) throw new Error('Folder sync needs Chrome, Edge, or the Mac app.');
  const picked = await pickDirectory();
  if (!picked) return { canceled: true, status: await webCloudStatus() };
  const permitted = await ensurePermission(picked, 'readwrite');
  if (!permitted) throw new Error('Allow folder access to keep projects in sync.');
  const library = await resolveLibraryHandle(picked, true);
  await persist(library, provider);
  return { canceled: false, status: await webCloudStatus() };
}

export async function webCloudPick(): Promise<{ canceled: boolean; status: CloudLibraryStatus }> {
  if (!supportsPicker()) throw new Error('Folder sync needs Chrome, Edge, or the Mac app.');
  const stored = await loadStored();
  const picked = await pickDirectory(stored?.handle);
  if (!picked) return { canceled: true, status: await webCloudStatus() };
  const permitted = await ensurePermission(picked, 'readwrite');
  if (!permitted) throw new Error('Allow folder access to keep projects in sync.');
  await persist(picked, 'folder');
  return { canceled: false, status: await webCloudStatus() };
}

export async function webCloudClear(): Promise<CloudLibraryStatus> {
  await clearStored();
  return webCloudStatus();
}

async function requireLibrary(): Promise<{ handle: DirHandle; config: StoredConfig }> {
  const stored = await loadStored();
  if (!stored) throw new Error('Choose a sync folder first.');
  const permitted = await ensurePermission(stored.handle, 'readwrite');
  if (!permitted) throw new Error('Allow folder access to keep projects in sync.');
  return stored;
}

function shrinkMedia(value: unknown) {
  if (typeof value !== 'string') return value ?? null;
  if (value.startsWith('data:') && value.length > SLIM_MEDIA_LIMIT) return null;
  return value;
}

function slimCopy(json: Record<string, unknown>) {
  const clone = JSON.parse(JSON.stringify(json)) as Record<string, unknown>;
  clone.screenshot = shrinkMedia(clone.screenshot);
  clone.soundtrackData = null;
  clone.reflectionMapImage = shrinkMedia(clone.reflectionMapImage);
  if (Array.isArray(clone.devices)) {
    clone.devices = clone.devices.map((device) => (
      device && typeof device === 'object'
        ? { ...(device as Record<string, unknown>), screenshot: shrinkMedia((device as Record<string, unknown>).screenshot) }
        : device
    ));
  }
  return JSON.stringify(clone);
}

async function readFileBytes(handle: FileHandle) {
  const file = await handle.getFile();
  return { file, bytes: new Uint8Array(await file.arrayBuffer()) };
}

async function readProjectText(handle: FileHandle) {
  const { file, bytes } = await readFileBytes(handle);
  return { file, text: await decodeMockupFile(bytes) };
}

function basename(filePath: string) {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

export async function webCloudList(): Promise<CloudListRow[]> {
  const { handle } = await requireLibrary();
  const entries: CloudListRow[] = [];
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== 'file') continue;
    if (name.endsWith('.tmp') || name.startsWith('.')) continue;
    if (name === TEMPLATES_FILE_NAME) continue;
    if (!isCloudProjectName(name)) continue;
    try {
      const fileHandle = entry as FileHandle;
      const file = await fileHandle.getFile();
      if (!file.size || file.size > MAX_BYTES) continue;
      if (file.size > 12_000_000) {
        entries.push({
          path: name,
          name: stripProjectExtension(name),
          updatedAt: file.lastModified,
          deviceId: 'iphone-17-pro',
          deviceCount: 1,
          preview: null,
          slim: null,
        });
        continue;
      }
      const { text } = await readProjectText(fileHandle);
      let projectName = stripProjectExtension(name);
      let deviceId = 'iphone-17-pro';
      let deviceCount = 1;
      let preview: string | null = null;
      let slim: string | null = null;
      try {
        const json = JSON.parse(text) as Record<string, unknown>;
        if (typeof json.name === 'string' && json.name.trim()) projectName = json.name.trim().slice(0, 100);
        if (typeof json.deviceId === 'string') deviceId = json.deviceId;
        if (Array.isArray(json.devices) && json.devices.length > 0) {
          deviceCount = json.devices.length;
          const first = json.devices[0] as Record<string, unknown> | undefined;
          if (first && typeof first.deviceId === 'string') deviceId = first.deviceId;
        }
        const shot = typeof json.screenshot === 'string' && json.screenshot.startsWith('data:image/')
          ? json.screenshot
          : null;
        if (shot && shot.length <= PREVIEW_LIMIT) preview = shot;
        slim = slimCopy(json);
      } catch {
        slim = null;
      }
      entries.push({
        path: name,
        name: projectName,
        updatedAt: file.lastModified,
        deviceId,
        deviceCount,
        preview,
        slim,
      });
    } catch {
      /* skip unreadable */
    }
  }
  entries.sort((a, b) => b.updatedAt - a.updatedAt);
  return entries.slice(0, 40);
}

export async function webCloudRead(filePath: string) {
  const { handle } = await requireLibrary();
  const name = basename(filePath);
  if (!isCloudProjectName(name) || name.includes('..')) throw new Error('Invalid project file');
  const fileHandle = await handle.getFileHandle(name);
  const { file, text } = await readProjectText(fileHandle);
  if (file.size > MAX_BYTES) throw new Error('Project exceeds maximum file size');
  return { path: name, contents: text, updatedAt: file.lastModified };
}

async function allocateName(dir: DirHandle, name: string) {
  const base = sanitizeName(name);
  let candidate = `${base}.mockup`;
  for (let i = 2; i < 200; i += 1) {
    try {
      await dir.getFileHandle(candidate);
      candidate = `${base}-${i}.mockup`;
    } catch {
      return candidate;
    }
  }
  return `${base}-${Date.now()}.mockup`;
}

async function fileExists(dir: DirHandle, name: string) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function writeBytes(dir: DirHandle, name: string, bytes: Uint8Array) {
  const chunk = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const tmpName = `.${name}.${Date.now()}.tmp`;
  const tmp = await dir.getFileHandle(tmpName, { create: true });
  const tmpWritable = await tmp.createWritable();
  await tmpWritable.write(chunk);
  await tmpWritable.close();

  const finalHandle = await dir.getFileHandle(name, { create: true });
  const finalWritable = await finalHandle.createWritable();
  await finalWritable.write(chunk);
  await finalWritable.close();

  try {
    await dir.removeEntry(tmpName);
  } catch {
    /* ignore */
  }
  return finalHandle;
}

export async function webCloudWrite(payload: WritePayload) {
  if (typeof payload.contents !== 'string' || !payload.contents || payload.contents.length > MAX_BYTES) {
    throw new Error('Invalid project size');
  }
  const { handle } = await requireLibrary();
  let target = typeof payload.filePath === 'string' && payload.filePath
    ? basename(payload.filePath)
    : null;
  if (target && (!isCloudProjectName(target) || target.includes('..'))) {
    throw new Error('Invalid project file');
  }
  const preferred = `${sanitizeName(payload.name)}.mockup`;
  if (!target) {
    target = await allocateName(handle, payload.name);
  } else if (/\.mockup\.json$/i.test(target)) {
    const migrated = target.replace(/\.mockup\.json$/i, '.mockup');
    if (!(await fileExists(handle, migrated))) {
      try {
        const old = await handle.getFileHandle(target);
        const { bytes } = await readFileBytes(old);
        await writeBytes(handle, migrated, bytes);
        await handle.removeEntry(target);
        target = migrated;
      } catch {
        /* keep legacy name */
      }
    }
  }
  if (target !== preferred && !(await fileExists(handle, preferred))) {
    try {
      if (await fileExists(handle, target)) {
        const old = await handle.getFileHandle(target);
        const { bytes } = await readFileBytes(old);
        await writeBytes(handle, preferred, bytes);
        await handle.removeEntry(target);
      }
      target = preferred;
    } catch {
      target = preferred;
    }
  }

  let unchanged = false;
  try {
    const existing = await handle.getFileHandle(target);
    const { text } = await readProjectText(existing);
    unchanged = text === payload.contents;
  } catch {
    unchanged = false;
  }
  if (!unchanged) {
    const encoded = await encodeMockupFile(payload.contents);
    await writeBytes(handle, target, encoded);
  }
  const file = await (await handle.getFileHandle(target)).getFile();
  notifySoon();
  return { path: target, updatedAt: file.lastModified, unchanged };
}

export async function webCloudRemove(filePath: string) {
  const { handle } = await requireLibrary();
  const name = basename(filePath);
  if (!isCloudProjectName(name) || name.includes('..')) throw new Error('Invalid project file');
  await handle.removeEntry(name);
  notifySoon();
  return { ok: true };
}

export async function webCloudTemplatesRead() {
  const { handle } = await requireLibrary();
  try {
    const fileHandle = await handle.getFileHandle(TEMPLATES_FILE_NAME);
    const file = await fileHandle.getFile();
    if (!file.size || file.size > MAX_TEMPLATES_BYTES) {
      return { path: TEMPLATES_FILE_NAME, contents: null, updatedAt: 0, missing: true };
    }
    const contents = await file.text();
    return { path: TEMPLATES_FILE_NAME, contents, updatedAt: file.lastModified, missing: false };
  } catch {
    return { path: TEMPLATES_FILE_NAME, contents: null, updatedAt: 0, missing: true };
  }
}

export async function webCloudTemplatesWrite(contents: string) {
  if (typeof contents !== 'string' || !contents || contents.length > MAX_TEMPLATES_BYTES) {
    throw new Error('Invalid templates library size');
  }
  const { handle } = await requireLibrary();
  let unchanged = false;
  try {
    const existing = await handle.getFileHandle(TEMPLATES_FILE_NAME);
    unchanged = (await existing.getFile().then((file) => file.text())) === contents;
  } catch {
    unchanged = false;
  }
  if (!unchanged) {
    await writeBytes(handle, TEMPLATES_FILE_NAME, new TextEncoder().encode(contents));
  }
  const file = await (await handle.getFileHandle(TEMPLATES_FILE_NAME)).getFile();
  notifySoon();
  return { path: TEMPLATES_FILE_NAME, updatedAt: file.lastModified, unchanged };
}

function notifySoon() {
  if (notifyTimer) window.clearTimeout(notifyTimer);
  notifyTimer = window.setTimeout(() => {
    notifyTimer = null;
    for (const listener of changeListeners) listener();
  }, 400);
}

async function fingerprintLibrary() {
  const stored = await loadStored();
  if (!stored) return '';
  const permitted = await ensurePermission(stored.handle, 'read').catch(() => false);
  if (!permitted) return 'missing';
  const parts: string[] = [];
  for await (const [name, entry] of stored.handle.entries()) {
    if (entry.kind !== 'file') continue;
    if (!isCloudProjectName(name) && name !== TEMPLATES_FILE_NAME) continue;
    try {
      const file = await (entry as FileHandle).getFile();
      parts.push(`${name}:${file.size}:${file.lastModified}`);
    } catch {
      parts.push(`${name}:err`);
    }
  }
  parts.sort();
  return parts.join('|');
}

async function pollOnce() {
  try {
    const next = await fingerprintLibrary();
    if (lastFingerprint && next !== lastFingerprint) {
      for (const listener of changeListeners) listener();
    }
    lastFingerprint = next;
  } catch {
    /* ignore poll errors */
  }
}

function restartPoll() {
  stopPoll();
  if (changeListeners.size === 0) return;
  void pollOnce();
  pollTimer = window.setInterval(() => {
    void pollOnce();
  }, POLL_MS);
}

function stopPoll() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function webOnCloudChanged(handler: () => void) {
  changeListeners.add(handler);
  restartPoll();
  return () => {
    changeListeners.delete(handler);
    if (changeListeners.size === 0) stopPoll();
  };
}
