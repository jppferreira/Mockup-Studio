import { validateProject } from './project';
import { libraryGet, libraryPut } from './libraryDb';
import { MAX_PROJECT_TABS, createProjectTabId, type ProjectTab } from './projectTabs';
import {
  EXPORT_ASPECTS, EXPORT_RESOLUTIONS, EXPORT_SIZE_LIMITS,
  type ExportResolutionId,
} from '../types';

const SESSION_KEY = 'workspace';

/** True only for a reload of this document, not a fresh visit to the site or app. */
export function isDocumentReload(): boolean {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type) return nav.type === 'reload';
  } catch {
    /* Older runtimes only expose the legacy navigation type. */
  }
  const legacy = performance.navigation;
  return legacy?.type === 1;
}

const ASPECT_IDS = new Set<string>(EXPORT_ASPECTS.map((item) => item.id));
const RESOLUTION_IDS = new Set<string>(EXPORT_RESOLUTIONS.map((item) => item.id));

export interface SessionFrameSize {
  exportAspectIds: string[];
  previewFrame: string;
  exportResolution: ExportResolutionId;
  customExportSize: { width: number; height: number };
}

export interface SessionWorkspace {
  tabs: ProjectTab[];
  activeId: string | null;
  frameSize?: SessionFrameSize;
}

function evenSize(n: number) {
  const v = Math.max(EXPORT_SIZE_LIMITS.min, Math.min(EXPORT_SIZE_LIMITS.max, Math.round(n)));
  return v % 2 === 0 ? v : v - 1;
}

function cleanPixel(value: unknown, fallback: number) {
  return evenSize(typeof value === 'number' && Number.isFinite(value) ? value : fallback);
}

/** Validate persisted frame/export size prefs; drop anything that no longer exists. */
export function sanitizeSessionFrameSize(raw: unknown): SessionFrameSize | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Partial<SessionFrameSize>;
  const aspectIds = Array.isArray(entry.exportAspectIds)
    ? entry.exportAspectIds.filter((id): id is string => (
      typeof id === 'string'
      && id.length > 0
      && (ASPECT_IDS.has(id) || id.startsWith('size-'))
    ))
    : [];
  const exportAspectIds = aspectIds.length ? [...new Set(aspectIds)] : ['custom'];
  let previewFrame = typeof entry.previewFrame === 'string' && entry.previewFrame
    ? entry.previewFrame
    : (exportAspectIds[0] === 'custom' ? 'free' : exportAspectIds[0]);
  if (
    previewFrame !== 'free'
    && !exportAspectIds.includes(previewFrame)
    && !ASPECT_IDS.has(previewFrame)
    && !previewFrame.startsWith('size-')
  ) {
    previewFrame = exportAspectIds[0] === 'custom' ? 'free' : (exportAspectIds[0] ?? 'free');
  }
  const exportResolution = (
    typeof entry.exportResolution === 'string' && RESOLUTION_IDS.has(entry.exportResolution)
      ? entry.exportResolution as ExportResolutionId
      : 'fhd'
  );
  const custom = entry.customExportSize && typeof entry.customExportSize === 'object'
    ? entry.customExportSize as Partial<{ width: number; height: number }>
    : {};
  return {
    exportAspectIds,
    previewFrame,
    exportResolution,
    customExportSize: {
      width: cleanPixel(custom.width, 1080),
      height: cleanPixel(custom.height, 1920),
    },
  };
}

export async function saveSessionWorkspace(
  workspace: SessionWorkspace,
  frameSize?: SessionFrameSize | null,
): Promise<void> {
  const tabs = workspace.tabs.slice(0, MAX_PROJECT_TABS).map((tab) => ({
    id: tab.id,
    project: tab.project,
    animTime: tab.animTime,
    animPlaying: false,
    timelineOpen: tab.timelineOpen,
    syncPath: tab.syncPath ?? null,
    shippedTemplateId: tab.shippedTemplateId ?? null,
  }));
  const cleaned = frameSize ? sanitizeSessionFrameSize(frameSize) : (
    workspace.frameSize ? sanitizeSessionFrameSize(workspace.frameSize) : null
  );
  await libraryPut('session', SESSION_KEY, {
    activeId: workspace.activeId,
    tabs,
    ...(cleaned ? { frameSize: cleaned } : {}),
  });
}

export async function loadSessionWorkspace(): Promise<SessionWorkspace | null> {
  const raw = await libraryGet<{ activeId?: unknown; tabs?: unknown; frameSize?: unknown }>('session', SESSION_KEY);
  if (!raw || !Array.isArray(raw.tabs)) return null;
  const tabs: ProjectTab[] = [];
  for (const item of raw.tabs.slice(0, MAX_PROJECT_TABS)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Partial<ProjectTab>;
    try {
      const project = validateProject(row.project);
      tabs.push({
        id: typeof row.id === 'string' && row.id ? row.id : createProjectTabId(),
        project,
        animTime: typeof row.animTime === 'number' && Number.isFinite(row.animTime) ? row.animTime : 0,
        animPlaying: false,
        timelineOpen: row.timelineOpen === true,
        syncPath: typeof row.syncPath === 'string' ? row.syncPath : null,
        shippedTemplateId: typeof row.shippedTemplateId === 'string' && row.shippedTemplateId.trim()
          ? row.shippedTemplateId.trim()
          : null,
      });
    } catch {
      /* Skip a tab whose project no longer validates. */
    }
  }
  const frameSize = sanitizeSessionFrameSize(raw.frameSize) ?? undefined;
  if (!tabs.length && !frameSize) return null;
  const activeId = tabs.length === 0
    ? null
    : (typeof raw.activeId === 'string' && tabs.some((tab) => tab.id === raw.activeId)
      ? raw.activeId
      : tabs[0].id);
  return { tabs, activeId, frameSize };
}
