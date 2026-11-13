/**
 * Versioned global template publishing (Supabase).
 * Reuses CompositionTemplate scene JSON from compositionFromProject.
 */

import { fetchIsAdmin } from './adminRole';
import { getDevice } from './devices';
import { ensureFreshSession, getSupabase, isSupabaseConfigured } from './supabaseClient';
import {
  prepareShippedTemplate,
  registerRuntimePromoted,
} from './shippedTemplates';
import {
  compositionFromProject,
} from './userLibrary';
import type { CompositionTemplate, ShippedTemplateCategory } from './templates';
import type { MockupProject } from '../types';

export const PUBLISH_TEMPLATE_CATEGORIES = [
  'single-device',
  'multiple-devices',
  'floating-devices',
  'product-showcase',
  'animated-compositions',
  'social-media',
  'custom',
] as const;

export type PublishTemplateCategory = (typeof PUBLISH_TEMPLATE_CATEGORIES)[number];

export const PUBLISH_CATEGORY_LABELS: Record<PublishTemplateCategory, string> = {
  'single-device': 'Single Device',
  'multiple-devices': 'Multiple Devices',
  'floating-devices': 'Floating Devices',
  'product-showcase': 'Product Showcase',
  'animated-compositions': 'Animated Compositions',
  'social-media': 'Social Media',
  custom: 'Custom',
};

export type TemplateAccessTier = 'free' | 'pro';
export type TemplatePublishStatus = 'draft' | 'published' | 'archived';

export const SCENE_SCHEMA_VERSION = 1;

const TEMPLATES_TABLE = 'mokstudio_templates';
const VERSIONS_TABLE = 'mokstudio_template_versions';
const THUMB_BUCKET = 'template-thumbnails';

export interface PublishedTemplateRecord {
  id: string;
  title: string;
  description: string;
  category: PublishTemplateCategory;
  tags: string[];
  thumbnailPath: string | null;
  thumbnailUrl: string | null;
  accessTier: TemplateAccessTier;
  status: TemplatePublishStatus;
  currentVersionId: string | null;
  schemaVersion: number;
  libraryCategory: ShippedTemplateCategory;
  slug: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  /** Present when scene was loaded (admin, or entitled published). */
  scene?: CompositionTemplate | null;
  versionNumber?: number | null;
}

export interface PublishTemplateInput {
  /** Existing template id for edit / republish. */
  templateId?: string | null;
  title: string;
  description: string;
  category: PublishTemplateCategory;
  tags: string[];
  accessTier: TemplateAccessTier;
  status: Exclude<TemplatePublishStatus, 'archived'>;
  /** Data URL or blob from canvas capture; uploaded async-friendly. */
  thumbnailDataUrl?: string | null;
  /** Keep existing thumb when updating without a new capture. */
  keepThumbnail?: boolean;
  project: MockupProject;
  cameraOrbit?: CompositionTemplate['cameraOrbit'] | null;
}

export interface PublishTemplateResult {
  ok: boolean;
  template?: PublishedTemplateRecord;
  error?: string;
  skipped?: boolean;
}

type TemplateRow = {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[] | null;
  thumbnail_path: string | null;
  access_tier: string;
  status: string;
  current_version_id: string | null;
  schema_version: number;
  library_category: string;
  slug: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

type VersionRow = {
  id: string;
  template_id: string;
  version_number: number;
  scene_json: unknown;
  schema_version: number;
  created_at: string;
  created_by: string;
};

let publishedCache: { at: number; items: PublishedTemplateRecord[] } | null = null;
const CACHE_MS = 45_000;

function isPublishCategory(value: string): value is PublishTemplateCategory {
  return (PUBLISH_TEMPLATE_CATEGORIES as readonly string[]).includes(value);
}

function isAccessTier(value: string): value is TemplateAccessTier {
  return value === 'free' || value === 'pro';
}

function isStatus(value: string): value is TemplatePublishStatus {
  return value === 'draft' || value === 'published' || value === 'archived';
}

function isLibraryCategory(value: string): value is ShippedTemplateCategory {
  return value === 'devices' || value === 'scenes' || value === 'social';
}

export function libraryCategoryForPublish(
  category: PublishTemplateCategory,
  deviceCount: number,
): ShippedTemplateCategory {
  if (category === 'social-media') return 'social';
  if (
    category === 'product-showcase'
    || category === 'animated-compositions'
    || category === 'multiple-devices'
  ) {
    return 'scenes';
  }
  if (category === 'custom') {
    return deviceCount >= 2 ? 'scenes' : 'devices';
  }
  return 'devices';
}

export function inferPublishCategory(project: MockupProject): PublishTemplateCategory {
  const count = project.devices.length;
  const hasMotion = (project.animation?.tracks?.length ?? 0) > 0;
  if (hasMotion) return 'animated-compositions';
  if (count <= 1) return 'single-device';
  if (count === 2) return 'multiple-devices';
  return 'floating-devices';
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'template';
}

function parseTags(raw: string[] | string | null | undefined): string[] {
  if (Array.isArray(raw)) {
    return raw
      .flatMap((tag) => (typeof tag === 'string' ? [tag.trim().toLowerCase()] : []))
      .filter(Boolean)
      .slice(0, 24);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[,#]/)
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 24);
  }
  return [];
}

export function parseTagInput(raw: string): string[] {
  return parseTags(raw);
}

function publicThumbUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const sb = getSupabase();
  if (!sb) return null;
  const relative = path.startsWith(`${THUMB_BUCKET}/`)
    ? path.slice(THUMB_BUCKET.length + 1)
    : path;
  const { data } = sb.storage.from(THUMB_BUCKET).getPublicUrl(relative);
  return data.publicUrl || null;
}

function mapRow(row: TemplateRow, extras?: {
  scene?: CompositionTemplate | null;
  versionNumber?: number | null;
}): PublishedTemplateRecord {
  const category = isPublishCategory(row.category) ? row.category : 'custom';
  const accessTier = isAccessTier(row.access_tier) ? row.access_tier : 'free';
  const status = isStatus(row.status) ? row.status : 'draft';
  const libraryCategory = isLibraryCategory(row.library_category)
    ? row.library_category
    : 'devices';
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    category,
    tags: parseTags(row.tags),
    thumbnailPath: row.thumbnail_path,
    thumbnailUrl: publicThumbUrl(row.thumbnail_path),
    accessTier,
    status,
    currentVersionId: row.current_version_id,
    schemaVersion: row.schema_version ?? SCENE_SCHEMA_VERSION,
    libraryCategory,
    slug: row.slug,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    scene: extras?.scene ?? null,
    versionNumber: extras?.versionNumber ?? null,
  };
}

/** Validate scene has devices and every device id is known (or custom). */
export function validateSceneForPublish(project: MockupProject): {
  ok: boolean;
  error?: string;
  deviceIds: string[];
} {
  const devices = project.devices ?? [];
  if (!devices.length) {
    return { ok: false, error: 'Add at least one device before publishing.', deviceIds: [] };
  }
  const deviceIds: string[] = [];
  for (const device of devices) {
    const id = device.deviceId;
    if (!id || typeof id !== 'string') {
      return { ok: false, error: 'A device is missing its model id.', deviceIds };
    }
    deviceIds.push(id);
    if (id.startsWith('custom-') || id.startsWith('generic_')) continue;
    if (!getDevice(id)) {
      return {
        ok: false,
        error: `Unknown device asset “${id}”. Templates must reference installed device models.`,
        deviceIds,
      };
    }
  }
  return { ok: true, deviceIds };
}

export function buildSceneTemplateFromProject(
  title: string,
  project: MockupProject,
  options: {
    category: PublishTemplateCategory;
    description?: string;
    id?: string;
    cameraOrbit?: CompositionTemplate['cameraOrbit'] | null;
    accessTier?: TemplateAccessTier;
  },
): CompositionTemplate {
  const libraryCategory = libraryCategoryForPublish(options.category, project.devices.length);
  const template = compositionFromProject(title, project, {
    id: options.id ?? slugify(title),
    category: libraryCategory,
    description: options.description,
    badge: options.accessTier === 'pro' ? 'Pro' : 'Free',
    cameraOrbit: options.cameraOrbit,
  });
  return prepareShippedTemplate({
    ...template,
    proMaxPack: options.accessTier === 'pro' || libraryCategory === 'scenes',
  }, libraryCategory);
}

function parseSceneJson(raw: unknown): CompositionTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const scene = raw as Partial<CompositionTemplate>;
  if (typeof scene.id !== 'string' || !scene.id.trim()) return null;
  if (typeof scene.label !== 'string' || !scene.label.trim()) return null;
  if (!Array.isArray(scene.devices) || scene.devices.length === 0) return null;
  const category = isLibraryCategory(String(scene.category))
    ? scene.category as ShippedTemplateCategory
    : 'devices';
  return prepareShippedTemplate(scene as CompositionTemplate, category);
}

async function requireAdminClient(): Promise<{
  ok: true;
  sb: NonNullable<ReturnType<typeof getSupabase>>;
  userId: string;
} | { ok: false; error: string; skipped?: boolean }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Cloud account is not configured.', skipped: true };
  }
  const auth = await ensureFreshSession();
  if (!auth.session?.user || !auth.user) {
    return { ok: false, error: 'Sign in as an administrator to publish templates.', skipped: true };
  }
  const isAdmin = await fetchIsAdmin({ force: true });
  if (!isAdmin) {
    return { ok: false, error: 'Only administrators can publish global templates.' };
  }
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Cloud account is not configured.', skipped: true };
  return { ok: true, sb, userId: auth.user.id };
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob | null> {
  try {
    const res = await fetch(dataUrl);
    return await res.blob();
  } catch {
    return null;
  }
}

async function uploadThumbnail(
  sb: NonNullable<ReturnType<typeof getSupabase>>,
  templateId: string,
  dataUrl: string,
): Promise<{ path: string } | { error: string }> {
  const blob = await dataUrlToBlob(dataUrl);
  if (!blob) return { error: 'Could not read preview image.' };
  const ext = blob.type.includes('webp')
    ? 'webp'
    : blob.type.includes('png')
      ? 'png'
      : 'jpg';
  const objectPath = `${templateId}/preview-${Date.now()}.${ext}`;
  const { error } = await sb.storage.from(THUMB_BUCKET).upload(objectPath, blob, {
    contentType: blob.type || 'image/webp',
    upsert: true,
    cacheControl: '3600',
  });
  if (error) return { error: error.message || 'Could not upload preview.' };
  return { path: `${THUMB_BUCKET}/${objectPath}` };
}

async function nextVersionNumber(
  sb: NonNullable<ReturnType<typeof getSupabase>>,
  templateId: string,
): Promise<number> {
  const { data } = await sb
    .from(VERSIONS_TABLE)
    .select('version_number')
    .eq('template_id', templateId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  const current = typeof data?.version_number === 'number' ? data.version_number : 0;
  return current + 1;
}

/** Create or update a template; always inserts a new version row for scene changes. */
export async function publishTemplate(input: PublishTemplateInput): Promise<PublishTemplateResult> {
  const gate = await requireAdminClient();
  if (!gate.ok) return { ok: false, error: gate.error, skipped: gate.skipped };

  const title = input.title.trim().slice(0, 120);
  if (!title) return { ok: false, error: 'Template name is required.' };

  const validation = validateSceneForPublish(input.project);
  if (input.status === 'published' && !validation.ok) {
    return { ok: false, error: validation.error };
  }
  if (!validation.ok && input.project.devices.length === 0) {
    return { ok: false, error: validation.error };
  }

  const { sb, userId } = gate;
  const libraryCategory = libraryCategoryForPublish(input.category, input.project.devices.length);
  const slugBase = slugify(title);
  const sceneTemplate = buildSceneTemplateFromProject(title, input.project, {
    category: input.category,
    description: input.description.trim().slice(0, 2000),
    id: slugBase,
    cameraOrbit: input.cameraOrbit,
    accessTier: input.accessTier,
  });

  const tags = parseTags(input.tags);
  const nowIso = new Date().toISOString();
  let templateId = input.templateId?.trim() || '';
  let existing: TemplateRow | null = null;

  if (templateId) {
    const { data, error } = await sb
      .from(TEMPLATES_TABLE)
      .select('*')
      .eq('id', templateId)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: 'Template not found.' };
    existing = data as TemplateRow;
  }

  const payload = {
    title,
    description: input.description.trim().slice(0, 2000),
    category: input.category,
    tags,
    access_tier: input.accessTier,
    status: input.status,
    library_category: libraryCategory,
    schema_version: SCENE_SCHEMA_VERSION,
    slug: existing?.slug || slugBase,
    published_at: input.status === 'published'
      ? (existing?.published_at || nowIso)
      : existing?.published_at ?? null,
  };

  if (!existing) {
    const { data, error } = await sb
      .from(TEMPLATES_TABLE)
      .insert({
        ...payload,
        created_by: userId,
      })
      .select('*')
      .single();
    if (error || !data) {
      return { ok: false, error: error?.message || 'Could not create template.' };
    }
    existing = data as TemplateRow;
    templateId = existing.id;
  } else {
    const { data, error } = await sb
      .from(TEMPLATES_TABLE)
      .update(payload)
      .eq('id', templateId)
      .select('*')
      .single();
    if (error || !data) {
      return { ok: false, error: error?.message || 'Could not update template.' };
    }
    existing = data as TemplateRow;
  }

  // Thumbnail upload (non-blocking for caller if they omit; here we await so path is saved).
  if (input.thumbnailDataUrl) {
    const uploaded = await uploadThumbnail(sb, templateId, input.thumbnailDataUrl);
    if ('error' in uploaded) {
      // Keep publish success; surface soft failure via description note in UI if needed.
      console.warn('[publishedTemplates] thumbnail upload failed', uploaded.error);
    } else {
      const { data: withThumb, error: thumbErr } = await sb
        .from(TEMPLATES_TABLE)
        .update({ thumbnail_path: uploaded.path })
        .eq('id', templateId)
        .select('*')
        .single();
      if (!thumbErr && withThumb) existing = withThumb as TemplateRow;
    }
  } else if (!input.keepThumbnail && !existing.thumbnail_path) {
    /* no thumb yet — ok */
  }

  const versionNumber = await nextVersionNumber(sb, templateId);
  const sceneJson = {
    ...sceneTemplate,
    id: existing.slug || sceneTemplate.id,
  };

  const { data: version, error: versionError } = await sb
    .from(VERSIONS_TABLE)
    .insert({
      template_id: templateId,
      version_number: versionNumber,
      scene_json: sceneJson,
      schema_version: SCENE_SCHEMA_VERSION,
      created_by: userId,
    })
    .select('*')
    .single();

  if (versionError || !version) {
    return { ok: false, error: versionError?.message || 'Could not save template version.' };
  }

  const versionRow = version as VersionRow;
  const { data: finalRow, error: linkError } = await sb
    .from(TEMPLATES_TABLE)
    .update({ current_version_id: versionRow.id })
    .eq('id', templateId)
    .select('*')
    .single();

  if (linkError || !finalRow) {
    return { ok: false, error: linkError?.message || 'Could not link template version.' };
  }

  publishedCache = null;
  const record = mapRow(finalRow as TemplateRow, {
    scene: sceneJson,
    versionNumber,
  });

  // Surface published templates in the live library without an app update.
  if (record.status === 'published' && record.scene) {
    registerRuntimePromoted([toCompositionTemplate(record)]);
  }

  return { ok: true, template: record };
}

export function toCompositionTemplate(record: PublishedTemplateRecord): CompositionTemplate {
  const base = record.scene
    ? { ...record.scene }
    : {
      id: record.slug || record.id,
      label: record.title,
      description: record.description,
      badge: record.accessTier === 'pro' ? 'Pro' : 'Free',
      category: record.libraryCategory,
      preview: 'solo' as const,
      background: 'studio' as const,
      compositionMode: 'single' as const,
      devices: [{ deviceId: 'iphone_15_pro_max' as const }],
    };
  return prepareShippedTemplate({
    ...base,
    id: record.slug || base.id || record.id,
    label: record.title,
    description: record.description || base.description,
    badge: record.accessTier === 'pro' ? 'Pro' : (base.badge || 'Free'),
    category: record.libraryCategory,
    cloudPublished: true,
    accessTier: record.accessTier,
    // Free cloud publishes stay available on Free; Pro ones need Pro/Pro Max.
    proMaxPack: record.accessTier === 'pro',
  }, record.libraryCategory);
}

/** Independent editable copy for the customer workspace (never mutates the global template). */
export function compositionCopyFromPublished(
  record: PublishedTemplateRecord,
): CompositionTemplate {
  const template = toCompositionTemplate(record);
  return {
    ...template,
    // Customer copy uses a fresh local id so saves never collide with global slug.
    id: `comp-${record.id.slice(0, 8)}-${Date.now().toString(36)}`,
    category: 'saved',
    badge: 'Template',
  };
}

export async function listPublishedTemplates(options?: {
  includeAdmin?: boolean;
  force?: boolean;
  status?: TemplatePublishStatus | 'all';
  category?: PublishTemplateCategory | 'all';
  search?: string;
}): Promise<{ ok: boolean; templates: PublishedTemplateRecord[]; error?: string; skipped?: boolean }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, templates: [], error: 'Cloud account is not configured.', skipped: true };
  }
  const auth = await ensureFreshSession();
  if (!auth.session?.user) {
    return { ok: false, templates: [], error: 'Sign in to browse templates.', skipped: true };
  }
  const sb = getSupabase();
  if (!sb) {
    return { ok: false, templates: [], error: 'Cloud account is not configured.', skipped: true };
  }

  const isAdmin = options?.includeAdmin ? await fetchIsAdmin() : false;
  const cacheKeyOk = !options?.force
    && !options?.search
    && (!options?.status || options.status === (isAdmin ? 'all' : 'published'))
    && (!options?.category || options.category === 'all')
    && publishedCache
    && Date.now() - publishedCache.at < CACHE_MS;

  if (cacheKeyOk && publishedCache) {
    return { ok: true, templates: publishedCache.items };
  }

  let query = sb
    .from(TEMPLATES_TABLE)
    .select('*')
    .order('updated_at', { ascending: false });

  if (!isAdmin) {
    query = query.eq('status', 'published');
  } else if (options?.status && options.status !== 'all') {
    query = query.eq('status', options.status);
  }

  if (options?.category && options.category !== 'all') {
    query = query.eq('category', options.category);
  }

  const { data, error } = await query;
  if (error) {
    return { ok: false, templates: [], error: error.message };
  }

  const search = options?.search?.trim().toLowerCase() ?? '';
  let items = (data as TemplateRow[] | null ?? []).map((row) => mapRow(row));
  if (search) {
    items = items.filter((item) => (
      item.title.toLowerCase().includes(search)
      || item.description.toLowerCase().includes(search)
      || item.tags.some((tag) => tag.includes(search))
    ));
  }

  if (!options?.search && (!options?.status || options.status === (isAdmin ? 'all' : 'published'))) {
    publishedCache = { at: Date.now(), items };
  }

  return { ok: true, templates: items };
}

export async function loadTemplateWithScene(
  templateId: string,
): Promise<{ ok: boolean; template?: PublishedTemplateRecord; error?: string; skipped?: boolean }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Cloud account is not configured.', skipped: true };
  }
  const auth = await ensureFreshSession();
  if (!auth.session?.user) {
    return { ok: false, error: 'Sign in to open templates.', skipped: true };
  }
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Cloud account is not configured.', skipped: true };

  const { data: row, error } = await sb
    .from(TEMPLATES_TABLE)
    .select('*')
    .eq('id', templateId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: 'Template not found.' };

  const template = mapRow(row as TemplateRow);
  if (!template.currentVersionId) {
    return { ok: false, error: 'Template has no published scene yet.' };
  }

  const { data: version, error: versionError } = await sb
    .from(VERSIONS_TABLE)
    .select('*')
    .eq('id', template.currentVersionId)
    .maybeSingle();

  if (versionError) {
    return {
      ok: false,
      error: versionError.message.includes('policy')
        || versionError.message.toLowerCase().includes('permission')
        ? 'This Pro template requires a Pro licence.'
        : versionError.message,
      template,
    };
  }
  if (!version) {
    return { ok: false, error: 'Template scene is unavailable.', template };
  }

  const versionRow = version as VersionRow;
  const scene = parseSceneJson(versionRow.scene_json);
  if (!scene) {
    return { ok: false, error: 'Template scene data is invalid.', template };
  }

  return {
    ok: true,
    template: {
      ...template,
      scene,
      versionNumber: versionRow.version_number,
    },
  };
}

export async function setTemplateStatus(
  templateId: string,
  status: TemplatePublishStatus,
): Promise<{ ok: boolean; template?: PublishedTemplateRecord; error?: string }> {
  const gate = await requireAdminClient();
  if (!gate.ok) return { ok: false, error: gate.error };

  const patch: Record<string, unknown> = { status };
  if (status === 'published') {
    patch.published_at = new Date().toISOString();
  }

  const { data, error } = await gate.sb
    .from(TEMPLATES_TABLE)
    .update(patch)
    .eq('id', templateId)
    .select('*')
    .single();

  if (error || !data) return { ok: false, error: error?.message || 'Could not update status.' };
  publishedCache = null;
  return { ok: true, template: mapRow(data as TemplateRow) };
}

export async function duplicatePublishedTemplate(
  templateId: string,
): Promise<{ ok: boolean; template?: PublishedTemplateRecord; error?: string }> {
  const loaded = await loadTemplateWithScene(templateId);
  if (!loaded.ok || !loaded.template?.scene) {
    return { ok: false, error: loaded.error || 'Could not load template to duplicate.' };
  }
  const source = loaded.template;
  // Rebuild a minimal project-like publish via scene as CompositionTemplate → project path
  // is heavier; instead insert a draft copy with the same scene JSON.
  const gate = await requireAdminClient();
  if (!gate.ok) return { ok: false, error: gate.error };

  const title = `${source.title} copy`.slice(0, 120);
  const { data: created, error } = await gate.sb
    .from(TEMPLATES_TABLE)
    .insert({
      title,
      description: source.description,
      category: source.category,
      tags: source.tags,
      access_tier: source.accessTier,
      status: 'draft',
      library_category: source.libraryCategory,
      schema_version: SCENE_SCHEMA_VERSION,
      slug: slugify(title),
      thumbnail_path: source.thumbnailPath,
      created_by: gate.userId,
    })
    .select('*')
    .single();

  if (error || !created) {
    return { ok: false, error: error?.message || 'Could not duplicate template.' };
  }

  const row = created as TemplateRow;
  const scene = source.scene;
  if (!scene) {
    return { ok: false, error: 'Could not load template to duplicate.' };
  }
  const { data: version, error: versionError } = await gate.sb
    .from(VERSIONS_TABLE)
    .insert({
      template_id: row.id,
      version_number: 1,
      scene_json: {
        ...scene,
        id: row.slug || scene.id,
        label: title,
      },
      schema_version: SCENE_SCHEMA_VERSION,
      created_by: gate.userId,
    })
    .select('*')
    .single();

  if (versionError || !version) {
    return { ok: false, error: versionError?.message || 'Could not copy scene version.' };
  }

  const { data: finalRow, error: linkError } = await gate.sb
    .from(TEMPLATES_TABLE)
    .update({ current_version_id: (version as VersionRow).id })
    .eq('id', row.id)
    .select('*')
    .single();

  if (linkError || !finalRow) {
    return { ok: false, error: linkError?.message || 'Could not finish duplicate.' };
  }

  publishedCache = null;
  return {
    ok: true,
    template: mapRow(finalRow as TemplateRow, {
      scene,
      versionNumber: 1,
    }),
  };
}

export async function deletePublishedTemplate(
  templateId: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireAdminClient();
  if (!gate.ok) return { ok: false, error: gate.error };

  const { error } = await gate.sb
    .from(TEMPLATES_TABLE)
    .delete()
    .eq('id', templateId);

  if (error) return { ok: false, error: error.message };
  publishedCache = null;
  return { ok: true };
}

/** Pull published scenes into the in-memory library (customers + admin). */
export async function syncPublishedTemplatesIntoLibrary(): Promise<{
  ok: boolean;
  count: number;
  error?: string;
}> {
  const listed = await listPublishedTemplates({ force: true, status: 'published' });
  if (!listed.ok) {
    return { ok: false, count: 0, error: listed.error };
  }

  const scenes: CompositionTemplate[] = [];
  for (const item of listed.templates) {
    if (item.accessTier === 'pro') {
      // Metadata-only for locked tiles; still register a stub for browse if scene readable.
    }
    const loaded = await loadTemplateWithScene(item.id);
    if (loaded.ok && loaded.template?.scene) {
      scenes.push(toCompositionTemplate(loaded.template));
    }
  }

  if (scenes.length) {
    registerRuntimePromoted(scenes);
  }
  return { ok: true, count: scenes.length };
}

export function clearPublishedTemplateCache(): void {
  publishedCache = null;
}
