import shippedPack from '../data/shippedTemplates.json';
import {
  TEMPLATE_BACKDROP,
  withAppleStudioLook,
  type CompositionTemplate,
} from './templates';
import {
  compositionFromProject,
  type TemplatesLibraryPayload,
} from './userLibrary';
import type { MockupProject } from '../types';

const SHIPPED_KIND = 'mockup-studio-templates' as const;

/** In-session promotions so Devices/Scenes update without a full reload. */
let runtimePromoted: CompositionTemplate[] = [];
/** Soft-deleted shipped ids (code defaults + pack) for this session / pack. */
let runtimeRemovedIds: string[] = [];
const runtimeListeners = new Set<() => void>();

type ShippedPackPayload = TemplatesLibraryPayload & {
  removedIds?: string[];
};

export function getRuntimePromotedTemplates(): CompositionTemplate[] {
  return runtimePromoted;
}

export function getRuntimeRemovedTemplateIds(): string[] {
  return runtimeRemovedIds;
}

export function subscribeRuntimePromoted(listener: () => void) {
  runtimeListeners.add(listener);
  return () => { runtimeListeners.delete(listener); };
}

function notifyRuntimeListeners() {
  runtimeListeners.forEach((listener) => listener());
}

function uniqueShippedId(label: string, taken: Set<string>): string {
  const base = slugify(label);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function slugify(label: string) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'composition';
}

function roundExportValue(value: unknown): unknown {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    const rounded = Math.round(value * 10000) / 10000;
    return Object.is(rounded, -0) ? 0 : rounded;
  }
  if (Array.isArray(value)) return value.map(roundExportValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (nested === undefined) continue;
      out[key] = roundExportValue(nested);
    }
    return out;
  }
  return value;
}

export function prepareShippedTemplate(
  template: CompositionTemplate,
  category: 'devices' | 'scenes' = template.category === 'scenes' ? 'scenes' : 'devices',
): CompositionTemplate {
  const id = template.id.startsWith('comp-')
    ? slugify(template.label)
    : template.id;
  return withAppleStudioLook({
    ...template,
    id,
    category,
    badge: template.badge === 'Template'
      ? (category === 'scenes' ? 'Scene' : 'Layout')
      : template.badge,
  });
}

export function prepareShippedFromProject(
  label: string,
  project: MockupProject,
  category: 'devices' | 'scenes' = 'devices',
  options?: { id?: string },
): CompositionTemplate {
  const resolvedId = options?.id?.trim()
    || slugify(label.trim() || project.name || 'composition');
  return prepareShippedTemplate(
    compositionFromProject(label, project, {
      id: resolvedId,
      category,
      badge: category === 'scenes' ? 'Scene' : 'Layout',
    }),
    category,
  );
}

/** Persist one template into the pack + live session so User toolset sees it immediately. */
export async function shipCompositionTemplate(
  template: CompositionTemplate,
): Promise<{ ok: boolean; template: CompositionTemplate; path?: string; downloaded?: boolean; reason?: string }> {
  const prepared = prepareShippedTemplate(template);
  runtimeRemovedIds = runtimeRemovedIds.filter((id) => id !== prepared.id);
  registerRuntimePromoted([prepared]);
  const pack = readShippedPack();
  const contents = serializeShippedTemplatePack(
    upsertShippedTemplates(pack.templates, [prepared]),
    pack.removedIds.filter((id) => id !== prepared.id),
  );
  const result = await writeShippedTemplatePack(contents);
  return { ...result, template: prepared };
}

export async function duplicateShippedTemplate(
  template: CompositionTemplate,
): Promise<{ ok: boolean; template: CompositionTemplate; path?: string; downloaded?: boolean; reason?: string }> {
  const pack = readShippedPack();
  const taken = new Set([
    ...pack.templates.map((item) => item.id),
    ...runtimePromoted.map((item) => item.id),
  ]);
  const label = `${template.label} copy`.slice(0, 40);
  const copy = prepareShippedTemplate({
    ...template,
    id: uniqueShippedId(label, taken),
    label,
  });
  return shipCompositionTemplate(copy);
}

/** Rename a shipped layout/composition without changing its id. */
export async function renameShippedTemplate(
  template: CompositionTemplate,
  label: string,
): Promise<{ ok: boolean; template: CompositionTemplate; path?: string; downloaded?: boolean; reason?: string }> {
  const nextLabel = label.trim().slice(0, 40);
  if (!nextLabel) return { ok: false, reason: 'Name cannot be empty', template };
  return shipCompositionTemplate({
    ...template,
    label: nextLabel,
  });
}

function uniqueShippedLabel(base: string, taken: Set<string>): string {
  const trimmed = base.trim().slice(0, 40) || 'Untitled';
  if (!taken.has(trimmed.toLowerCase())) return trimmed;
  let n = 2;
  while (taken.has(`${trimmed} ${n}`.toLowerCase())) n += 1;
  return `${trimmed} ${n}`.slice(0, 40);
}

/** Brand-new shipped Device layout or Composition for Dev authoring. */
export function createBlankShippedTemplate(
  label: string,
  category: 'devices' | 'scenes',
  deviceId = 'iphone_15_pro_max',
): CompositionTemplate {
  const pack = readShippedPack();
  const taken = new Set([
    ...pack.templates.map((item) => item.id),
    ...runtimePromoted.map((item) => item.id),
  ]);
  const takenLabels = new Set([
    ...pack.templates.map((item) => item.label.toLowerCase()),
    ...runtimePromoted.map((item) => item.label.toLowerCase()),
  ]);
  const fallback = category === 'scenes' ? 'New composition' : 'New layout';
  const nextLabel = uniqueShippedLabel(label.trim() || fallback, takenLabels);
  return prepareShippedTemplate({
    id: uniqueShippedId(nextLabel, taken),
    label: nextLabel,
    description: category === 'scenes' ? 'Blank composition' : 'Blank device layout',
    badge: category === 'scenes' ? 'Scene' : 'Layout',
    category,
    preview: 'solo',
    background: 'studio',
    gradient: { ...TEMPLATE_BACKDROP },
    compositionMode: 'single',
    linkSplitTransform: true,
    motion: 'clear',
    devices: [{
      deviceId,
      rotation: { x: 0, y: 0, z: 0 },
      position: { x: 0, y: 0, z: 0 },
      scale: 1,
    }],
  }, category);
}

export async function deleteShippedTemplate(
  id: string,
): Promise<{ ok: boolean; path?: string; downloaded?: boolean; reason?: string }> {
  if (!id.trim()) return { ok: false, reason: 'Missing template id' };
  runtimePromoted = runtimePromoted.filter((item) => item.id !== id);
  if (!runtimeRemovedIds.includes(id)) runtimeRemovedIds = [...runtimeRemovedIds, id];
  notifyRuntimeListeners();
  const pack = readShippedPack();
  const templates = pack.templates.filter((item) => item.id !== id);
  const removedIds = pack.removedIds.includes(id) ? pack.removedIds : [...pack.removedIds, id];
  const result = await writeShippedTemplatePack(serializeShippedTemplatePack(templates, removedIds));
  return result;
}

function parseRemovedIds(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const payload = raw as Partial<ShippedPackPayload>;
  if (payload.kind !== SHIPPED_KIND) return [];
  if (!Array.isArray(payload.removedIds)) return [];
  return payload.removedIds.flatMap((id) => (
    typeof id === 'string' && id.trim() ? [id.trim()] : []
  ));
}

export function parseShippedTemplatePack(raw: unknown): CompositionTemplate[] {
  if (!raw || typeof raw !== 'object') return [];
  const payload = raw as Partial<ShippedPackPayload>;
  if (payload.kind !== SHIPPED_KIND) return [];
  if (!Array.isArray(payload.templates)) return [];
  const removed = new Set(parseRemovedIds(raw));
  return payload.templates.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    if (typeof item.id !== 'string' || !item.id.trim()) return [];
    if (removed.has(item.id)) return [];
    if (typeof item.label !== 'string' || !item.label.trim()) return [];
    if (!Array.isArray(item.devices) || item.devices.length === 0) return [];
    const category = item.category === 'scenes' ? 'scenes' as const : 'devices' as const;
    return [prepareShippedTemplate(item as CompositionTemplate, category)];
  });
}

export function loadShippedPackTemplates(): CompositionTemplate[] {
  return parseShippedTemplatePack(shippedPack);
}

export function loadShippedRemovedIds(): string[] {
  return parseRemovedIds(shippedPack);
}

function readShippedPack(): { templates: CompositionTemplate[]; removedIds: string[] } {
  return {
    templates: loadShippedPackTemplates(),
    removedIds: loadShippedRemovedIds(),
  };
}

export function serializeShippedTemplatePack(
  templates: CompositionTemplate[],
  removedIds: string[] = loadShippedRemovedIds(),
): string {
  const payload: ShippedPackPayload = {
    kind: SHIPPED_KIND,
    version: 1,
    updatedAt: Date.now(),
    removedIds: [...new Set(removedIds)].filter(Boolean).sort(),
    templates: templates.map((item) => (
      roundExportValue(prepareShippedTemplate(item)) as CompositionTemplate
    )),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function mergeShippedTemplates(
  codeDefaults: CompositionTemplate[],
  pack: CompositionTemplate[],
): CompositionTemplate[] {
  if (!pack.length) return codeDefaults;
  const packById = new Map(pack.map((item) => [item.id, item]));
  const codeIds = new Set(codeDefaults.map((item) => item.id));
  const merged = codeDefaults.map((item) => packById.get(item.id) ?? item);
  const extras = pack.filter((item) => !codeIds.has(item.id));
  return [...merged, ...extras];
}

export function upsertShippedTemplates(
  existing: CompositionTemplate[],
  next: CompositionTemplate[],
): CompositionTemplate[] {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of next) {
    const prepared = prepareShippedTemplate(item);
    byId.set(prepared.id, prepared);
  }
  const order: string[] = [];
  const seen = new Set<string>();
  for (const item of [...existing, ...next.map((t) => prepareShippedTemplate(t))]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    order.push(item.id);
  }
  return order.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

export function registerRuntimePromoted(templates: CompositionTemplate[]): CompositionTemplate[] {
  runtimePromoted = upsertShippedTemplates(runtimePromoted, templates);
  notifyRuntimeListeners();
  return runtimePromoted;
}

/** Write pack via Electron (dev) or download JSON as fallback. */
export async function writeShippedTemplatePack(contents: string): Promise<{
  ok: boolean;
  path?: string;
  downloaded?: boolean;
  reason?: string;
}> {
  const api = window.mockupDesktop;
  if (api?.devWriteShippedTemplates) {
    return api.devWriteShippedTemplates(contents);
  }
  try {
    const blob = new Blob([contents], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'shippedTemplates.json';
    anchor.click();
    URL.revokeObjectURL(url);
    return { ok: true, downloaded: true, path: 'shippedTemplates.json' };
  } catch {
    return { ok: false, reason: 'Could not write or download shippedTemplates.json' };
  }
}
