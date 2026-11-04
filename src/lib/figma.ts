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

/** Direct API base — used by Electron main process only. */
export const FIGMA_API_BASE = FIGMA_API;
