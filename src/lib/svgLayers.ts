import { compositeExplodeStack } from './figma';

export type SvgLayerNode = {
  id: string;
  name: string;
  tag: string;
  children: SvgLayerNode[];
};

export type SvgDocumentModel = {
  fileName: string;
  svgText: string;
  viewBox: string;
  width: number;
  height: number;
  layers: SvgLayerNode[];
};

const SKIP_TAGS = new Set(['defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'pattern', 'style', 'script', 'title', 'desc', 'metadata', 'symbol']);
const GROUP_TAGS = new Set(['g', 'a', 'svg', 'symbol']);

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

function layerName(el: Element, fallback: string): string {
  return (
    el.getAttribute('data-name')
    || el.getAttribute('id')
    || el.getAttribute('aria-label')
    || fallback
  );
}

function ensureId(el: Element, used: Set<string>, prefix: string): string {
  const existing = el.getAttribute('data-ms-id');
  if (existing) {
    used.add(existing);
    return existing;
  }
  let n = 0;
  let id = `${prefix}-${n}`;
  while (used.has(id)) {
    n += 1;
    id = `${prefix}-${n}`;
  }
  used.add(id);
  el.setAttribute('data-ms-id', id);
  return id;
}

function walk(el: Element, used: Set<string>, depth: number): SvgLayerNode | null {
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return null;

  const id = ensureId(el, used, `layer-${tag}`);
  const children: SvgLayerNode[] = [];

  if (GROUP_TAGS.has(tag) || depth === 0) {
    Array.from(el.children).forEach((child, index) => {
      if (!isElement(child)) return;
      const childTag = child.tagName.toLowerCase();
      if (SKIP_TAGS.has(childTag)) return;
      // Keep leaf shapes as nodes too (for explode of mixed groups)
      if (GROUP_TAGS.has(childTag)) {
        const nested = walk(child, used, depth + 1);
        if (nested) children.push(nested);
      } else {
        const childId = ensureId(child, used, `shape-${childTag}`);
        children.push({
          id: childId,
          name: layerName(child, `${childTag} ${index + 1}`),
          tag: childTag,
          children: [],
        });
      }
    });
  }

  return {
    id,
    name: layerName(el, tag === 'svg' ? 'SVG' : tag),
    tag,
    children,
  };
}

function parseViewBox(svg: SVGSVGElement): { viewBox: string; width: number; height: number } {
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return {
        viewBox: vb.trim(),
        width: Math.max(1, Math.round(parts[2])),
        height: Math.max(1, Math.round(parts[3])),
      };
    }
  }
  const width = Math.max(1, Math.round(parseFloat(svg.getAttribute('width') || '0') || 390));
  const height = Math.max(1, Math.round(parseFloat(svg.getAttribute('height') || '0') || 844));
  return { viewBox: `0 0 ${width} ${height}`, width, height };
}

export function isSvgFile(file: File) {
  return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
}

export async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read SVG'));
    reader.readAsText(file);
  });
}

export function parseSvgDocument(svgText: string, fileName = 'design.svg'): SvgDocumentModel {
  const trimmed = svgText.trim();
  if (!trimmed.includes('<svg')) {
    throw new Error('That file does not look like an SVG.');
  }

  const doc = new DOMParser().parseFromString(trimmed, 'image/svg+xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('Could not parse SVG — check the file is valid.');

  const svg = doc.documentElement;
  if (!svg || svg.tagName.toLowerCase() !== 'svg') {
    throw new Error('SVG root element missing.');
  }

  const used = new Set<string>();
  const root = walk(svg, used, 0);
  const { viewBox, width, height } = parseViewBox(svg as unknown as SVGSVGElement);

  // Persist stamped ids back into serialized source
  const stamped = new XMLSerializer().serializeToString(svg);

  return {
    fileName,
    svgText: stamped,
    viewBox,
    width,
    height,
    layers: root?.children?.length ? root.children : root ? [root] : [],
  };
}

function loadStampedSvg(model: SvgDocumentModel): { doc: Document; svg: Element } {
  const doc = new DOMParser().parseFromString(model.svgText, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.tagName.toLowerCase() !== 'svg') {
    throw new Error('SVG root missing');
  }
  return { doc, svg };
}

function collectDefs(svg: Element): Element[] {
  return Array.from(svg.children).filter((child) => {
    const tag = child.tagName.toLowerCase();
    return tag === 'defs' || tag === 'style';
  });
}

/** Build a standalone SVG containing only the target node (plus defs), same viewBox. */
export function sliceSvgLayer(model: SvgDocumentModel, layerId: string): string {
  const { doc, svg } = loadStampedSvg(model);
  const target = Array.from(doc.querySelectorAll('[data-ms-id]')).find(
    (el) => el.getAttribute('data-ms-id') === layerId,
  );
  if (!target) throw new Error('Layer not found in SVG');

  const out = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  Array.from(svg.attributes).forEach((attr) => {
    if (attr.name === 'width' || attr.name === 'height' || attr.name === 'viewBox' || attr.name.startsWith('xmlns')) {
      out.setAttribute(attr.name, attr.value);
    }
  });
  if (!out.getAttribute('viewBox')) out.setAttribute('viewBox', model.viewBox);
  if (!out.getAttribute('xmlns')) out.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  out.setAttribute('width', String(model.width));
  out.setAttribute('height', String(model.height));

  collectDefs(svg).forEach((def) => out.appendChild(def.cloneNode(true)));
  out.appendChild(target.cloneNode(true));

  return new XMLSerializer().serializeToString(out);
}

export function rasterizeSvgText(svgText: string, scale = 2): Promise<string> {
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width || 1;
        const h = img.naturalHeight || img.height || 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * Math.min(3, Math.max(1, scale))));
        canvas.height = Math.max(1, Math.round(h * Math.min(3, Math.max(1, scale))));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not rasterize SVG');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Could not rasterize SVG'));
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not render SVG'));
    };
    img.src = objectUrl;
  });
}

export async function exportSvgLayerPng(model: SvgDocumentModel, layerId: string, scale = 2): Promise<string> {
  return rasterizeSvgText(sliceSvgLayer(model, layerId), scale);
}

export async function exportFullSvgPng(model: SvgDocumentModel, scale = 2): Promise<string> {
  return rasterizeSvgText(model.svgText, scale);
}

export function findSvgLayer(nodes: SvgLayerNode[], id: string): SvgLayerNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const nested = findSvgLayer(node.children, id);
    if (nested) return nested;
  }
  return null;
}

export function svgExplodeCandidates(node: SvgLayerNode, limit = 12): SvgLayerNode[] {
  if (!node.children.length) return [];
  return node.children.slice(0, limit);
}

export async function buildSvgExplodePlates(
  model: SvgDocumentModel,
  parent: SvgLayerNode,
): Promise<{ id: string; name: string; tag: string; dataUrl: string }[]> {
  const candidates = svgExplodeCandidates(parent);
  const plates = [];
  for (const child of candidates) {
    try {
      const dataUrl = await exportSvgLayerPng(model, child.id, 1.5);
      plates.push({ id: child.id, name: child.name, tag: child.tag, dataUrl });
    } catch {
      /* skip layers that fail to rasterize */
    }
  }
  return plates;
}

export async function compositeSvgExplode(
  plates: { dataUrl: string; name: string }[],
  amount: number,
): Promise<string> {
  return compositeExplodeStack(plates, amount);
}

/** Read SVG markup from a paste event when present. */
export function readSvgTextFromPasteEvent(event: ClipboardEvent): string | null {
  const data = event.clipboardData;
  if (!data) return null;

  const html = data.getData('text/html');
  if (html && /<svg[\s>]/i.test(html)) {
    const match = html.match(/<svg[\s\S]*?<\/svg>/i);
    if (match) return match[0];
  }

  const text = data.getData('text/plain') || data.getData('text/svg+xml');
  if (text && /<svg[\s>]/i.test(text)) {
    const match = text.match(/<svg[\s\S]*?<\/svg>/i);
    if (match) return match[0];
  }

  return null;
}
