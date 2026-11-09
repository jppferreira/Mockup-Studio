import { compileSchema, decodeBinarySchema } from 'kiwi-schema';
import { inflateRaw } from 'pako';

const TOKEN_KEY = 'mockup-studio.figma-token';
const FIGMA_API = 'https://api.figma.com/v1';

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

export function loadFigmaToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveFigmaToken(token: string) {
  try {
    const trimmed = token.trim();
    if (!trimmed) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, trimmed);
  } catch {
    /* ignore quota / private mode */
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
      throw figmaError(result.status, parsed);
    }
    return parsed;
  }

  // Browser / Vite: proxy avoids CORS
  const response = await fetch(`/api/figma${path}`, {
    headers: { 'X-Figma-Token': token },
  });
  const parsed = await response.json().catch(() => null);
  if (!response.ok) throw figmaError(response.status, parsed);
  return parsed;
}

function figmaError(status: number, body: unknown): Error {
  const message =
    body && typeof body === 'object' && 'err' in body && typeof (body as { err: unknown }).err === 'string'
      ? (body as { err: string }).err
      : body && typeof body === 'object' && 'message' in body && typeof (body as { message: unknown }).message === 'string'
        ? (body as { message: string }).message
        : null;

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

export async function fetchFigmaFile(fileKey: string, token: string): Promise<FigmaFileSummary> {
  const trimmedToken = token.trim();
  if (!trimmedToken) throw new Error('Add a Figma personal access token first.');
  if (!fileKey) throw new Error('Paste a Figma file URL or key.');

  const data = await figmaApiGet(`/files/${encodeURIComponent(fileKey)}`, trimmedToken) as {
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
  await Promise.all(unique.map(async (id) => {
    const imageUrl = data.images?.[id];
    if (!imageUrl) return;
    out.set(id, await fetchImageAsDataUrl(imageUrl, trimmedToken));
  }));
  return out;
}

/** Direct children worth showing in an explode stack (bottom → top). */
export function explodeCandidates(node: FigmaLayerNode, limit = 12): FigmaLayerNode[] {
  const kids = node.children.filter((child) => child.visible !== false);
  if (!kids.length) return [];
  // Figma lists children bottom → top; keep that order for the stack
  return kids.slice(-limit);
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load layer preview'));
    img.src = src;
  });
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

  return canvas.toDataURL('image/png');
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
 * frame/component as PNG. Used for “copy link → paste onto device screen”.
 */
export async function exportFigmaUrlAsScreenPng(
  rawUrl: string,
  token = loadFigmaToken(),
  scale = 2,
): Promise<{ dataUrl: string; name: string } | null> {
  const parsed = parseFigmaUrl(rawUrl);
  if (!parsed?.fileKey || !parsed.nodeId) return null;
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('Add a Figma token in Assets → Open to paste Figma frame links.');
  }
  const { dataUrl, nameHint } = await exportFigmaNodeAsDataUrl(
    parsed.fileKey,
    parsed.nodeId,
    trimmed,
    scale,
  );
  return { dataUrl, name: nameHint };
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
 * Turn a Figma ⌘C HTML clipboard payload into a PNG for the device screen.
 * Needs a personal access token (same as Assets → Open).
 */
export async function exportFigmaClipboardHtmlAsScreenPng(
  html: string,
  token = loadFigmaToken(),
  scale = 2,
): Promise<{ dataUrl: string; name: string } | null> {
  const parsed = parseFigmaClipboardHtml(html);
  if (!parsed) return null;
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('Add a Figma token in Assets → Open, then paste again (⌘C from Figma works).');
  }
  // One selected layer is the common case; if several are selected, export the first.
  const nodeId = parsed.nodeIds[0];
  const { dataUrl, nameHint } = await exportFigmaNodeAsDataUrl(
    parsed.fileKey,
    nodeId,
    trimmed,
    scale,
  );
  return { dataUrl, name: parsed.nameHint || nameHint };
}

/** Direct API base — used by Electron main process only. */
export const FIGMA_API_BASE = FIGMA_API;
