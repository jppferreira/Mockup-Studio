import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Bookmark, Check, Cuboid, Download, Glasses, Headphones, Laptop, LayoutGrid, LoaderCircle, Monitor, Smartphone, Store, Tablet, Trash2, UserRound, Watch, Wrench, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { hasAnimation } from '../lib/animation';
import {
  DEVICE_CATEGORY_ICON,
  DEVICE_CATEGORY_TABS,
  filterDevicesByCategory,
  type DeviceCategoryFilter,
  type DeviceCategoryIconKey,
  type DeviceModel,
} from '../lib/devices';
import {
  APP_ABOUT_SUMMARY,
  EXPORT_USAGE_NOTICE,
  MODEL_LICENSING_NOTICE,
  NON_AFFILIATION_DISCLAIMER,
} from '@shared/legal';
import { getCheckoutConfig } from '@shared/checkout';

const DEVICE_CATEGORY_LUCIDE: Record<DeviceCategoryIconKey, LucideIcon> = {
  'layout-grid': LayoutGrid,
  smartphone: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
  monitor: Monitor,
  watch: Watch,
  headphones: Headphones,
  glasses: Glasses,
  cuboid: Cuboid,
};
import AccentThemePicker from './AccentThemePicker';
import AccountLicencePanel from './AccountLicencePanel';
import CloudAccountPanel from './CloudAccountPanel';
import {
  cloudRowToDocument,
  fetchCloudProjectMeta,
  fetchCloudProjectRow,
  listCloudProjectMeta,
  shouldAdoptRemoteDocument,
  type CloudProjectMeta,
} from '../lib/cloudProjects';
import { getProjectDocument, putProjectDocument } from '../lib/projectStore';
import { getAuthSnapshot } from '../lib/supabaseClient';
import { isDesktopApp } from '../lib/phoneMirror';
import {
  documentToRecentEntry,
  loadRecentProjects,
  normalizeProjectName,
  PROJECT_NAME_MAX,
  shouldAdoptCloudName,
  type RecentProjectEntry,
} from '../lib/recentProjects';
import { formatSyncedClock, lastSyncedStatus, useLastSyncedAt, type SyncConflict } from '../lib/cloudSync';
import type { RecentScreenshot } from '../lib/recentScreenshots';
import {
  getCompositionTemplate,
  listCatalogTemplatesForStore,
  templatesVisibleForTier,
  type CompositionTemplate,
  type TemplateCategory,
} from '../lib/templates';
import type { MockupProject } from '../types';
import {
  canUseProMaxTemplates,
  isFreeDevice,
  planLabel,
  type LicenseState,
  type LicenseTier,
} from '../lib/license';
import DevLicenseSwitcher from './DevLicenseSwitcher';
import { isBundledLocalDevice } from '../lib/localDeviceModels';
import {
  downloadDeviceModel,
  listCachedRemoteDeviceIds,
  peekDeviceModelCached,
  remoteModelsConfigured,
} from '../lib/modelCache';
import {
  installTemplatePack,
  installTemplates,
  isPackFullyInstalled,
  isTemplateInstalled,
  loadInstalledTemplateIds,
  packForTemplate,
  TEMPLATE_STORE_PACKS,
  type StorePackId,
  uninstallTemplates,
} from '../lib/installedTemplates';
import { APP_LOGO_SRC } from '../lib/appBrand';
import DeviceModelThumb from './DeviceModelThumb';
import TemplateThumb, { ProjectThumb } from './TemplateThumb';
import newProjectArt from '../assets/dashboard/new-project.svg';
import iconGrid from '../assets/dashboard/icon-grid.svg';
import iconCube from '../assets/dashboard/icon-cube.svg';
import iconLayers from '../assets/dashboard/icon-layers.svg';
import iconImage from '../assets/dashboard/icon-image.svg';
import iconSettings from '../assets/dashboard/icon-settings.svg';
import iconCubeAccent from '../assets/dashboard/icon-cube-accent.svg';
import iconSearch from '../assets/dashboard/icon-search.svg';
import iconDown from '../assets/dashboard/icon-down.svg';
import iconPlus from '../assets/dashboard/icon-plus.svg';
import iconChevron from '../assets/dashboard/icon-chevron.svg';
import iconDots from '../assets/dashboard/icon-dots.svg';

type DashSection = 'projects' | 'models' | 'templates' | 'my-templates' | 'template-store' | 'assets' | 'settings';
type SortMode = 'edited' | 'name';
type DashNavIcon = string | LucideIcon;

const LONG_PRESS_MS = 480;
const LONG_PRESS_MOVE_PX = 12;

const NAV: { id: DashSection; label: string; icon: DashNavIcon }[] = [
  { id: 'projects', label: 'Projects', icon: iconGrid },
  { id: 'models', label: '3D models', icon: iconCube },
  { id: 'templates', label: 'Templates', icon: iconLayers },
  { id: 'my-templates', label: 'My templates', icon: Bookmark },
  { id: 'template-store', label: 'Template store', icon: Store },
  { id: 'assets', label: 'My assets', icon: iconImage },
  { id: 'settings', label: 'Settings', icon: iconSettings },
];

type StoreMasonryTile = {
  templateId: string;
  packId: StorePackId;
  /** Masonry span for staggered layout */
  masonry: 'hero' | 'tall' | 'wide' | 'standard';
};

const STORE_MASONRY_CYCLE: StoreMasonryTile['masonry'][] = ['hero', 'tall', 'wide', 'standard', 'tall', 'wide'];

/** Prefer featured tiles first, then the rest of the downloadable catalog. */
const FEATURED_STORE_TILES: StoreMasonryTile[] = [
  { templateId: 'solo-hero', packId: 'starter-layouts', masonry: 'standard' },
  { templateId: 'obsidian-plinth', packId: 'pro-max-motion', masonry: 'hero' },
  { templateId: 'triple-fan', packId: 'multi-device', masonry: 'tall' },
  { templateId: 'clay-desk', packId: 'art-director', masonry: 'wide' },
  { templateId: 'social-story-portrait', packId: 'social-studio', masonry: 'tall' },
  { templateId: 'ivory-laptop', packId: 'desk-set', masonry: 'standard' },
  { templateId: 'launch-pair', packId: 'pro-max-motion', masonry: 'wide' },
  { templateId: 'ios-android', packId: 'multi-device', masonry: 'standard' },
  { templateId: 'pedestal-stage', packId: 'art-director', masonry: 'tall' },
  { templateId: 'social-feed-hero', packId: 'social-studio', masonry: 'standard' },
  { templateId: 'concrete-lean', packId: 'desk-set', masonry: 'hero' },
  { templateId: 'chrome-floor', packId: 'pro-max-motion', masonry: 'standard' },
  { templateId: 'duo-stack', packId: 'multi-device', masonry: 'wide' },
  { templateId: 'white-studio', packId: 'pro-max-motion', masonry: 'tall' },
];

const DASH_TABS_KEY = 'mockup-studio-dash-tabs';

type DashTabMemory = {
  section: DashSection;
  deviceFilter: DeviceCategoryFilter;
  templateCategory: TemplateCategory;
};

function isDashSection(value: unknown): value is DashSection {
  return value === 'projects'
    || value === 'models'
    || value === 'templates'
    || value === 'my-templates'
    || value === 'template-store'
    || value === 'assets'
    || value === 'settings';
}

function isTemplateCategory(value: unknown): value is TemplateCategory {
  return value === 'devices' || value === 'scenes' || value === 'social' || value === 'saved';
}

function isDeviceFilter(value: unknown): value is DeviceCategoryFilter {
  return typeof value === 'string' && DEVICE_CATEGORY_TABS.some((tab) => tab.id === value);
}

/** Last home-screen tab, including the chips inside 3D models and Templates. */
function readDashTabMemory(): DashTabMemory {
  const fallback: DashTabMemory = {
    section: 'projects',
    deviceFilter: 'all',
    templateCategory: 'devices',
  };
  try {
    const raw = localStorage.getItem(DASH_TABS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<DashTabMemory>;
    return {
      section: isDashSection(parsed.section) ? parsed.section : fallback.section,
      deviceFilter: isDeviceFilter(parsed.deviceFilter) ? parsed.deviceFilter : fallback.deviceFilter,
      templateCategory: isTemplateCategory(parsed.templateCategory) ? parsed.templateCategory : fallback.templateCategory,
    };
  } catch {
    return fallback;
  }
}

function editedPhrase(timestamp: number) {
  const startOf = (value: number) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const day = 86_400_000;
  const diff = startOf(Date.now()) - startOf(timestamp);
  if (diff <= 0) return 'Edited today';
  if (diff < day * 1.5) return 'Edited yesterday';
  const days = Math.round(diff / day);
  if (days < 7) return `Edited ${days} days ago`;
  if (days < 14) return 'Edited last week';
  return `Edited ${new Date(timestamp).toLocaleDateString()}`;
}

type ListedProject = {
  key: string;
  name: string;
  updatedAt: number;
  deviceId: string;
  project: MockupProject | null;
  preview: string | null;
  filePath?: string;
  recent?: RecentProjectEntry;
  cloudOnly?: boolean;
};

function syncWhereLabel(
  onCloud: boolean,
  email: string | null | undefined,
  checked: boolean,
  checkFailed: boolean,
  desktop: boolean,
) {
  const here = desktop ? 'This Mac' : 'This browser';
  if (!email) return { text: `${here} only`, kind: 'local' as const };
  if (onCloud) return { text: `Cloud · ${email}`, kind: 'cloud' as const };
  if (checkFailed) return { text: 'Cloud · check timed out', kind: 'local' as const };
  if (!checked) return { text: 'Checking cloud…', kind: 'local' as const };
  return { text: `${here} · not uploaded`, kind: 'local' as const };
}

function projectMeta(entry: { updatedAt: number; project: MockupProject | null }) {
  const edited = editedPhrase(entry.updatedAt);
  const clip = entry.project?.animation;
  if (clip && hasAnimation(clip)) {
    const seconds = Math.max(1, Math.round(clip.duration));
    return `${edited} · ${seconds}s animation`;
  }
  return `${edited} · Draft`;
}

export default function ProjectsDashboard({
  recentProjects,
  recentScreenshots,
  devices,
  license,
  licensingDisabled,
  onOpenProject,
  onRemoveProject,
  onRemoveProjects,
  onRenameProject,
  onNewProject,
  onBlankFile,
  onOpenFile,
  onStartTemplate,
  onStartDevice,
  onDeleteSavedTemplate,
  onDeleteShippedTemplate,
  onDuplicateTemplate,
  onRenameTemplate,
  onAddShippedTemplate,
  savedCompositions,
  toolsetSwitchAvailable,
  isDeveloperToolset,
  onSetToolset,
  gatedLicenseTier,
  devLicenseOverride,
  onDevLicenseOverride,
  onExplorePro,
  onLicenseChange,
  onFeedback,
  onShowOnboarding,
  onShowStudioTour,
  onMergeCloudProjects,
  onApplyCloudDeletes,
  onSyncConflicts,
  onCloudSignedInChange,
  cloudSignedInEmail,
  deviceUnlocked,
}: {
  recentProjects: RecentProjectEntry[];
  recentScreenshots: RecentScreenshot[];
  devices: DeviceModel[];
  license: LicenseState;
  licensingDisabled: boolean;
  onOpenProject: (entry: RecentProjectEntry, options?: { alreadySynced?: boolean }) => void;
  onRemoveProject: (id: string) => void;
  onRemoveProjects?: (ids: string[]) => boolean | void;
  onRenameProject: (
    id: string,
    name: string,
    options?: { pushCloud?: boolean },
  ) => Promise<{ ok: boolean; error?: string }>;
  onNewProject: () => void;
  onBlankFile?: () => void;
  onOpenFile: () => void;
  onStartTemplate: (template: CompositionTemplate) => void;
  onStartDevice: (deviceId: string) => void;
  onDeleteSavedTemplate: (id: string) => void;
  onDeleteShippedTemplate?: (template: CompositionTemplate) => void;
  onDuplicateTemplate: (template: CompositionTemplate) => void;
  onRenameTemplate?: (template: CompositionTemplate) => void;
  onAddShippedTemplate?: (category: 'devices' | 'scenes' | 'social') => void;
  savedCompositions: CompositionTemplate[];
  toolsetSwitchAvailable?: boolean;
  isDeveloperToolset?: boolean;
  onSetToolset?: (toolset: 'developer' | 'user') => void;
  gatedLicenseTier?: LicenseTier;
  devLicenseOverride?: LicenseTier | null;
  onDevLicenseOverride?: (tier: LicenseTier | null) => void;
  onExplorePro: () => void;
  onLicenseChange: (next: LicenseState) => void;
  onFeedback: () => void;
  onShowOnboarding?: () => void;
  onShowStudioTour?: () => void;
  onMergeCloudProjects: (entries: RecentProjectEntry[]) => void;
  onApplyCloudDeletes?: (localIds: string[]) => void;
  onSyncConflicts?: (conflicts: SyncConflict[]) => void;
  onCloudSignedInChange?: (email: string | null) => void;
  cloudSignedInEmail?: string | null;
  deviceUnlocked: (deviceId: string) => boolean;
}) {
  const [rememberedTabs] = useState(readDashTabMemory);
  const [section, setSection] = useState<DashSection>(rememberedTabs.section);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [sort, setSort] = useState<SortMode>('edited');
  const [sortOpen, setSortOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [syncMenuOpen, setSyncMenuOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deviceFilter, setDeviceFilter] = useState<DeviceCategoryFilter>(rememberedTabs.deviceFilter);
  const [templateCategory, setTemplateCategory] = useState<TemplateCategory>(rememberedTabs.templateCategory);
  const remoteModels = remoteModelsConfigured();
  const [modelCacheById, setModelCacheById] = useState<Record<string, 'ready' | 'missing' | 'downloading' | 'error'>>({});
  const [modelCacheNotice, setModelCacheNotice] = useState<string | null>(null);
  const syncMenuRef = useRef<HTMLDivElement>(null);
  const longPressRef = useRef<{
    id: string;
    pointerId: number;
    x: number;
    y: number;
    timer: number;
  } | null>(null);
  const suppressOpenRef = useRef(false);

  useEffect(() => {
    if (section !== 'projects' && !query.trim()) setSearchOpen(false);
  }, [section, query]);

  useEffect(() => {
    try {
      localStorage.setItem(DASH_TABS_KEY, JSON.stringify({ section, deviceFilter, templateCategory }));
    } catch {
      /* private mode */
    }
  }, [section, deviceFilter, templateCategory]);
  const desktop = isDesktopApp();
  const [sessionEmail, setSessionEmail] = useState<string | null>(cloudSignedInEmail ?? null);
  const accountEmail = cloudSignedInEmail || sessionEmail;
  const lastSyncedAt = useLastSyncedAt();
  const syncLabel = lastSyncedStatus(Boolean(accountEmail), lastSyncedAt);
  const [cloudRows, setCloudRows] = useState<CloudProjectMeta[]>([]);
  const [cloudChecked, setCloudChecked] = useState(false);
  const [cloudCheckFailed, setCloudCheckFailed] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameNotice, setRenameNotice] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renamingIdRef = useRef<string | null>(null);
  const renameCancelRef = useRef(false);
  const recentRef = useRef(recentProjects);
  const onRenameProjectRef = useRef(onRenameProject);
  recentRef.current = recentProjects;
  onRenameProjectRef.current = onRenameProject;
  const cloudIds = useMemo(() => new Set(cloudRows.map((row) => row.local_id)), [cloudRows]);

  useEffect(() => {
    let cancelled = false;
    void getAuthSnapshot().then((snap) => {
      if (cancelled) return;
      const email = snap.user?.email ?? null;
      setSessionEmail(email);
      onCloudSignedInChange?.(email);
    });
    return () => {
      cancelled = true;
    };
  }, [onCloudSignedInChange]);

  const refreshCloudIds = useCallback(async () => {
    if (!accountEmail) {
      setCloudRows([]);
      setCloudChecked(false);
      setCloudCheckFailed(false);
      return;
    }
    const meta = await listCloudProjectMeta();
    if (!meta.ok) {
      setCloudCheckFailed(true);
      setCloudChecked(true);
      return;
    }
    setCloudRows(meta.rows);
    setCloudChecked(true);
    setCloudCheckFailed(false);
    for (const row of meta.rows) {
      if (!row.local_id || renamingIdRef.current === row.local_id) continue;
      const local = recentRef.current.find((entry) => entry.id === row.local_id);
      if (!local) continue;
      const adopted = shouldAdoptCloudName(
        local.name,
        local.updatedAt,
        row.name,
        Date.parse(row.updated_at) || 0,
        false,
      );
      if (!adopted) continue;
      void onRenameProjectRef.current(row.local_id, adopted, { pushCloud: false });
    }
  }, [accountEmail]);

  useEffect(() => {
    void refreshCloudIds();
  }, [refreshCloudIds, recentProjects.length]);

  useEffect(() => {
    if (!accountEmail) return undefined;
    const tick = () => { void refreshCloudIds(); };
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', onVisible);
    const interval = window.setInterval(tick, 20_000);
    return () => {
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(interval);
    };
  }, [accountEmail, refreshCloudIds]);

  useEffect(() => {
    if (!sortOpen && !menuId) return;
    const close = () => {
      setSortOpen(false);
      setMenuId(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [sortOpen, menuId]);

  useEffect(() => {
    if (!syncMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (!syncMenuRef.current?.contains(event.target as Node)) setSyncMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [syncMenuOpen]);

  const clearLongPress = useCallback(() => {
    if (!longPressRef.current) return;
    window.clearTimeout(longPressRef.current.timer);
    longPressRef.current = null;
  }, []);

  const exitSelectMode = useCallback(() => {
    clearLongPress();
    setSelectMode(false);
    setSelectedIds([]);
    setMenuId(null);
  }, [clearLongPress]);

  const enterSelectMode = useCallback((id: string) => {
    setMenuId(null);
    setSelectMode(true);
    setSelectedIds((current) => (current.includes(id) ? current : [...current, id]));
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((current) => (
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    ));
  }, []);

  useEffect(() => {
    if (section !== 'projects' && selectMode) exitSelectMode();
  }, [section, selectMode, exitSelectMode]);

  useEffect(() => {
    if (!remoteModels || section !== 'models') return undefined;
    let cancelled = false;
    void listCachedRemoteDeviceIds().then((ready) => {
      if (cancelled) return;
      setModelCacheById((prev) => {
        const next = { ...prev };
        for (const id of ready) {
          if (prev[id] === 'downloading') continue;
          next[id] = 'ready';
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [remoteModels, section, deviceFilter]);

  const downloadDashModel = useCallback(async (device: DeviceModel) => {
    if (!remoteModels || isBundledLocalDevice(device.id)) return;
    setModelCacheById((prev) => ({ ...prev, [device.id]: 'downloading' }));
    setModelCacheNotice(null);
    try {
      await downloadDeviceModel(device.id);
      setModelCacheById((prev) => ({ ...prev, [device.id]: 'ready' }));
      setModelCacheNotice(`${device.label} ready offline`);
    } catch (err) {
      setModelCacheById((prev) => ({ ...prev, [device.id]: 'error' }));
      setModelCacheNotice(err instanceof Error ? err.message : `Could not download ${device.label}`);
    }
  }, [remoteModels]);

  useEffect(() => {
    if (!selectMode) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        exitSelectMode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectMode, exitSelectMode]);

  useEffect(() => () => clearLongPress(), [clearLongPress]);

  const deleteSelectedProjects = useCallback(() => {
    if (!selectedIds.length) return;
    const ids = [...selectedIds];
    if (onRemoveProjects) {
      const removed = onRemoveProjects(ids);
      if (removed === false) return;
    } else {
      ids.forEach((id) => onRemoveProject(id));
    }
    setCloudRows((rows) => rows.filter((row) => !ids.includes(row.local_id)));
    exitSelectMode();
  }, [selectedIds, onRemoveProjects, onRemoveProject, exitSelectMode]);

  const projects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const localIds = new Set(recentProjects.map((entry) => entry.id));
    const local: ListedProject[] = recentProjects.map((entry) => ({
      key: entry.id,
      name: entry.name,
      updatedAt: entry.updatedAt,
      deviceId: entry.deviceId,
      project: entry.project,
      preview: entry.preview,
      recent: entry,
      cloudOnly: false,
    }));
    const remoteOnly: ListedProject[] = cloudRows
      .filter((row) => row.local_id && !localIds.has(row.local_id))
      .map((row) => ({
        key: row.local_id,
        name: row.name?.trim() || 'Untitled composition',
        updatedAt: Date.parse(row.updated_at) || 0,
        deviceId: row.device_id || 'iphone-17-pro',
        project: null,
        preview: null,
        cloudOnly: true,
      }));
    return [...local, ...remoteOnly]
      .filter((entry) => !needle || entry.name.toLowerCase().includes(needle))
      .sort((a, b) => (
        sort === 'name'
          ? a.name.localeCompare(b.name)
          : b.updatedAt - a.updatedAt
      ));
  }, [recentProjects, cloudRows, query, sort]);

  const openListedProject = useCallback(async (entry: ListedProject) => {
    setOpeningId(entry.key);
    setOpenError(null);
    try {
      let doc = await getProjectDocument(entry.key);
      const meta = await fetchCloudProjectMeta(entry.key).catch(() => null);
      const remoteRevision = meta && !meta.deleted_at && typeof meta.revision === 'number'
        ? meta.revision
        : 0;
      const takeCloud = !doc || shouldAdoptRemoteDocument(
        doc ? { revision: doc.revision, baseRevision: doc.baseRevision } : null,
        remoteRevision,
      );
      let openedFromCloud = false;
      if (takeCloud && remoteRevision > 0) {
        const row = await fetchCloudProjectRow(entry.key);
        if (row && !row.deleted_at) {
          doc = await cloudRowToDocument(row);
          await putProjectDocument(doc, { id: doc.id, enqueueOutbox: false });
          openedFromCloud = true;
        }
      }
      if (!doc && entry.recent) {
        onOpenProject(entry.recent);
        return;
      }
      if (!doc) {
        setOpenError(`Could not open “${entry.name}”.`);
        return;
      }
      const recent = documentToRecentEntry(doc);
      onMergeCloudProjects([recent]);
      const synced = doc.baseRevision > 0 && doc.revision <= doc.baseRevision;
      onOpenProject(recent, { alreadySynced: synced || openedFromCloud });
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : 'Could not open that project.');
    } finally {
      setOpeningId(null);
    }
  }, [onMergeCloudProjects, onOpenProject]);

  useEffect(() => {
    if (!renamingId) return undefined;
    const frame = requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [renamingId]);

  const beginListedRename = (entry: ListedProject) => {
    renameCancelRef.current = false;
    renamingIdRef.current = entry.key;
    setMenuId(null);
    setRenameNotice(null);
    setRenamingId(entry.key);
    setRenameDraft(entry.name);
  };

  const cancelListedRename = () => {
    renameCancelRef.current = true;
    renamingIdRef.current = null;
    setRenamingId(null);
  };

  const commitListedRename = (entry: ListedProject) => {
    if (renameCancelRef.current) {
      renameCancelRef.current = false;
      return;
    }
    if (renamingIdRef.current !== entry.key) return;
    renamingIdRef.current = null;
    setRenamingId(null);
    const nextName = normalizeProjectName(renameDraft);
    if (!nextName) {
      setRenameNotice('Enter a project name.');
      return;
    }
    setRenameNotice(null);
    if (nextName === entry.name) return;
    const previousRows = cloudRows;
    setCloudRows((rows) => rows.map((row) => (
      row.local_id === entry.key ? { ...row, name: nextName } : row
    )));
    void onRenameProject(entry.key, nextName).then((result) => {
      if (!result.ok) {
        setCloudRows(previousRows);
        setRenameNotice(result.error || 'Couldn\'t rename that project.');
      }
    }).catch(() => {
      setCloudRows(previousRows);
      setRenameNotice('Couldn\'t rename that project.');
    });
  };

  const visibleDevices = useMemo(
    () => filterDevicesByCategory(devices, deviceFilter),
    [devices, deviceFilter],
  );
  const featureTier = gatedLicenseTier ?? license.tier;
  // Dev always authors the full catalog; license override gates User view only.
  const includeAllTemplates = Boolean(isDeveloperToolset);
  const [installedTemplateIds, setInstalledTemplateIds] = useState(() => loadInstalledTemplateIds());
  const installedIdSet = useMemo(() => new Set(installedTemplateIds), [installedTemplateIds]);
  const canUseDeviceLayouts = featureTier !== 'free' || includeAllTemplates;
  const canUseSocialAssets = canUseDeviceLayouts;
  const canUseProMaxPack = canUseProMaxTemplates(featureTier) || includeAllTemplates;
  useEffect(() => {
    if (templateCategory === 'scenes' && !canUseProMaxPack) {
      setTemplateCategory(canUseDeviceLayouts ? 'devices' : 'saved');
      return;
    }
    if ((templateCategory === 'devices' || templateCategory === 'social') && !canUseDeviceLayouts) {
      setTemplateCategory('saved');
    }
  }, [templateCategory, canUseProMaxPack, canUseDeviceLayouts]);
  const templatesList = (category: Exclude<TemplateCategory, 'saved'>) => (
    templatesVisibleForTier(category, {
      tier: featureTier,
      includeAll: includeAllTemplates,
      // User library only shows downloaded templates — never the full catalog by default.
      installedIds: includeAllTemplates ? null : installedIdSet,
    })
  );
  // Listing is install + tier gated inside templatesVisibleForTier (not prefilled).
  const compositionTemplates = templatesList('scenes');
  const sceneTemplates = templatesList('devices');
  const socialTemplates = templatesList('social');
  const templatesUpgradeHint = !includeAllTemplates && installedTemplateIds.length === 0
    ? 'Download templates from the Template store — nothing is installed by default.'
    : !includeAllTemplates && featureTier === 'free'
      ? 'Starter layouts are free to download. Pro unlocks multi-device and social packs.'
      : !includeAllTemplates && featureTier === 'pro' && !canUseProMaxPack
        ? 'Pro Max unlocks scenic packs in the Template store.'
        : null;

  const storeTiles = useMemo(() => {
    const catalog = listCatalogTemplatesForStore();
    const featuredIds = new Set(FEATURED_STORE_TILES.map((tile) => tile.templateId));
    const tiles: StoreMasonryTile[] = [];
    for (const tile of FEATURED_STORE_TILES) {
      if (catalog.some((item) => item.id === tile.templateId)) tiles.push(tile);
    }
    let cycle = 0;
    for (const template of catalog) {
      if (featuredIds.has(template.id)) continue;
      const packId = packForTemplate(template.id)?.id;
      if (!packId) continue;
      tiles.push({
        templateId: template.id,
        packId,
        masonry: STORE_MASONRY_CYCLE[cycle % STORE_MASONRY_CYCLE.length],
      });
      cycle += 1;
    }
    return tiles;
  }, []);

  const canDownloadPack = (packId: StorePackId) => {
    const pack = TEMPLATE_STORE_PACKS[packId];
    if (!pack) return false;
    if (includeAllTemplates) return true;
    if (pack.tier === 'free') return true;
    if (pack.tier === 'pro' || pack.tier === 'addon') return featureTier === 'pro' || featureTier === 'pro_max';
    if (pack.tier === 'pro_max') return featureTier === 'pro_max';
    return false;
  };

  const downloadStoreTemplate = (templateId: string, packId: StorePackId) => {
    if (!canDownloadPack(packId)) {
      onExplorePro();
      return;
    }
    const next = installTemplates([templateId]);
    setInstalledTemplateIds(next);
  };

  const downloadStorePack = (packId: StorePackId) => {
    if (!canDownloadPack(packId)) {
      onExplorePro();
      return;
    }
    const next = installTemplatePack(packId);
    setInstalledTemplateIds(next);
  };

  const removeInstalledTemplate = (templateId: string) => {
    const next = uninstallTemplates([templateId]);
    setInstalledTemplateIds(next);
  };

  const heading = section === 'projects'
    ? { kicker: 'Workspace', title: 'Your projects', sub: 'Open a project or create something new.' }
    : section === 'models'
      ? { kicker: 'Library', title: '3D models', sub: 'Pick a device and start a scene with it.' }
      : section === 'templates'
        ? {
          kicker: 'Library',
          title: toolsetSwitchAvailable
            ? (isDeveloperToolset ? 'Templates · Dev' : 'Templates · User')
            : 'Templates',
          sub: includeAllTemplates
            ? 'Master catalog — author and ship for every user.'
            : 'Downloaded templates only. Get more from the Template store.',
        }
        : section === 'my-templates'
          ? {
            kicker: 'Library',
            title: 'My templates',
            sub: 'Templates you saved from the studio. Signed-in accounts sync them with your cloud projects.',
          }
          : section === 'template-store'
            ? {
              kicker: 'Library',
              title: 'Template store',
              sub: 'Browse and download templates. Nothing is installed until you download it.',
            }
            : section === 'assets'
              ? { kicker: 'Library', title: 'My assets', sub: 'Screenshots saved from recent scenes.' }
              : { kicker: 'Workspace', title: 'Settings', sub: 'Theme, license, project files, and feedback.' };

  return (
    <div className={`projects-dash ${desktop ? 'is-desktop' : ''}`}>
      <header className="dash-header">
        <div className="dash-brand">
          <img className="dash-logo" src={APP_LOGO_SRC} alt="" width={28} height={28} />
          <strong>mokstudio</strong>
          <span className="dash-beta-badge" aria-label="Beta">Beta</span>
        </div>
        <span className="dash-header-rule" aria-hidden />
        <span className="dash-header-label">Your workspace</span>
        <div className="dash-header-actions">
          {toolsetSwitchAvailable && onSetToolset && (
            <div className="workspace-dev-controls dash-header-dev-controls">
              <div
                className={`workspace-view-toggle dash-header-view-toggle${isDeveloperToolset ? ' is-dev' : ' is-user'}`}
                role="group"
                aria-label="Workspace view"
              >
                <button
                  type="button"
                  className={isDeveloperToolset ? 'is-active' : ''}
                  aria-pressed={Boolean(isDeveloperToolset)}
                  title="Dev view — templates open in edit mode"
                  onClick={() => {
                    onSetToolset('developer');
                    setSection('templates');
                    setTemplateCategory('scenes');
                  }}
                >
                  <Wrench size={12} strokeWidth={2.2} aria-hidden />
                  Dev
                </button>
                <button
                  type="button"
                  className={!isDeveloperToolset ? 'is-active' : ''}
                  aria-pressed={!isDeveloperToolset}
                  title="User view — browse the customer template library"
                  onClick={() => onSetToolset('user')}
                >
                  <UserRound size={12} strokeWidth={2.2} aria-hidden />
                  User view
                </button>
              </div>
              {onDevLicenseOverride && (
                <DevLicenseSwitcher
                  compact
                  activeTier={featureTier}
                  overrideActive={devLicenseOverride != null}
                  onSelect={onDevLicenseOverride}
                  onClear={() => onDevLicenseOverride(null)}
                />
              )}
            </div>
          )}
          <div className="sync-menu-wrap dash-sync-menu" ref={syncMenuRef}>
            <button
              type="button"
              className={`sync-status ${accountEmail ? 'is-on' : ''}`}
              aria-expanded={syncMenuOpen}
              aria-haspopup="dialog"
              title={accountEmail
                ? `Signed in as ${accountEmail}.${lastSyncedAt ? ` Last synced ${formatSyncedClock(lastSyncedAt)}.` : ''}`
                : 'Sign in to sync projects across web and Mac'}
              onClick={() => setSyncMenuOpen((open) => !open)}
            >
              {syncLabel}
            </button>
            {syncMenuOpen && (
              <CloudAccountPanel
                variant="menu"
                recentProjects={recentProjects}
                onMergeCloudProjects={onMergeCloudProjects}
                onApplyCloudDeletes={onApplyCloudDeletes}
                onConflicts={onSyncConflicts}
                onSignedInChange={onCloudSignedInChange}
                onAfterSync={() => { void refreshCloudIds(); }}
              />
            )}
          </div>
        </div>
      </header>

      <div className="dash-body">
        <nav className="dash-nav" aria-label="Workspace">
          <div className="dash-nav-list" role="tablist">
            {NAV.map((item) => {
              const active = section === item.id;
              const Icon = typeof item.icon === 'string' ? null : item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`dash-nav-item ${active ? 'is-active' : ''}`}
                  onClick={() => {
                    setSection(item.id);
                    if (item.id === 'my-templates') setTemplateCategory('saved');
                  }}
                >
                  {Icon ? (
                    <Icon size={19} strokeWidth={1.75} aria-hidden />
                  ) : (
                    <img src={item.icon as string} alt="" width={19} height={19} />
                  )}
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="dash-upgrade">
            <img src={iconCubeAccent} alt="" width={22} height={22} />
            <strong>Your creative studio</strong>
            <p>All your scenes in one place</p>
            <button type="button" className="dash-upgrade-action" onClick={onExplorePro}>
              Explore Pro
            </button>
          </div>
        </nav>

        <main className="dash-main">
          <p className="dash-kicker">{heading.kicker}</p>
          <div className="dash-title-row">
            <h1>{heading.title}</h1>
            {section === 'templates' && toolsetSwitchAvailable && onSetToolset && (
              <div
                className={`workspace-view-toggle dash-template-view-toggle${isDeveloperToolset ? ' is-dev' : ' is-user'}`}
                role="group"
                aria-label="Templates view"
              >
                <button
                  type="button"
                  className={isDeveloperToolset ? 'is-active' : ''}
                  aria-pressed={Boolean(isDeveloperToolset)}
                  title="Dev view — edit templates, scene templates, and social media"
                  onClick={() => onSetToolset('developer')}
                >
                  <Wrench size={12} strokeWidth={2.2} aria-hidden />
                  Dev
                </button>
                <button
                  type="button"
                  className={!isDeveloperToolset ? 'is-active' : ''}
                  aria-pressed={!isDeveloperToolset}
                  title="User view — browse as customers see them"
                  onClick={() => onSetToolset('user')}
                >
                  <UserRound size={12} strokeWidth={2.2} aria-hidden />
                  User view
                </button>
              </div>
            )}
            {section === 'projects' && (
              <div className="dash-tools">
                <div className={`dash-search-shell${searchOpen || query ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="dash-search-toggle"
                    aria-label="Search projects"
                    title="Search projects"
                    aria-expanded={searchOpen || Boolean(query)}
                    tabIndex={searchOpen || query ? -1 : 0}
                    onClick={() => {
                      setSearchOpen(true);
                      window.requestAnimationFrame(() => searchInputRef.current?.focus());
                    }}
                  >
                    <img src={iconSearch} alt="" width={19} height={19} />
                  </button>
                  <label className="dash-search">
                    <img src={iconSearch} alt="" width={19} height={19} />
                    <input
                      ref={searchInputRef}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onFocus={() => setSearchOpen(true)}
                      onBlur={() => {
                        if (!query.trim()) setSearchOpen(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          if (query) setQuery('');
                          else {
                            setSearchOpen(false);
                            (event.target as HTMLInputElement).blur();
                          }
                        }
                      }}
                      placeholder="Search projects"
                      aria-label="Search projects"
                      tabIndex={searchOpen || query ? 0 : -1}
                    />
                  </label>
                </div>
                <div
                  className="dash-sort-wrap"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="dash-sort"
                    aria-haspopup="listbox"
                    aria-expanded={sortOpen}
                    onClick={() => setSortOpen((open) => !open)}
                  >
                    {sort === 'edited' ? 'Last edited' : 'Name'}
                    <img src={iconDown} alt="" width={17} height={17} />
                  </button>
                  {sortOpen && (
                    <div className="dash-pop" role="listbox" aria-label="Sort projects">
                      <button type="button" role="option" aria-selected={sort === 'edited'} onClick={() => { setSort('edited'); setSortOpen(false); }}>
                        Last edited
                      </button>
                      <button type="button" role="option" aria-selected={sort === 'name'} onClick={() => { setSort('name'); setSortOpen(false); }}>
                        Name
                      </button>
                    </div>
                  )}
                </div>
                <button type="button" className="dash-new" onClick={onBlankFile ?? onNewProject} title="Blank file">
                  <img src={iconPlus} alt="" width={20} height={20} />
                  Blank file
                </button>
                <button type="button" className="dash-new" onClick={onNewProject} title="New from template">
                  <img src={iconLayers} alt="" width={18} height={18} />
                  Template
                </button>
              </div>
            )}
          </div>
          <p className="dash-sub">{heading.sub}</p>
          <div className="dash-divider" />

          {section === 'projects' && (
            <>
              <div className="dash-section-row">
                <h2>{selectMode ? 'Select projects' : accountEmail ? 'Synced projects' : 'Recent projects'}</h2>
                {selectMode ? (
                  <div className="dash-select-bar" role="toolbar" aria-label="Selected projects">
                    <span>
                      {selectedIds.length === 1
                        ? '1 selected'
                        : `${selectedIds.length} selected`}
                    </span>
                    <button type="button" className="dash-select-cancel" onClick={exitSelectMode}>
                      <X size={14} strokeWidth={2.2} aria-hidden />
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="dash-select-delete"
                      disabled={selectedIds.length === 0}
                      onClick={deleteSelectedProjects}
                    >
                      <Trash2 size={14} strokeWidth={2.2} aria-hidden />
                      Delete
                    </button>
                  </div>
                ) : (
                  <span>{projects.length === 1 ? '1 project' : `${projects.length} projects`}</span>
                )}
              </div>
              {selectMode && (
                <p className="dash-select-hint">Tap cards to select or deselect. Long-press another card to keep selecting.</p>
              )}
              <div className={`dash-grid${selectMode ? ' is-selecting' : ''}`}>
                {!selectMode && (
                  <button type="button" className="dash-card dash-card-create" onClick={onNewProject}>
                    <span className="dash-card-art">
                      <img src={newProjectArt} alt="" width={381} height={180} />
                    </span>
                    <span className="dash-card-copy">
                      <strong>New from template</strong>
                      <span>Start with a template, scene template, or social layout</span>
                      <img className="dash-card-chevron" src={iconChevron} alt="" width={21} height={21} />
                    </span>
                  </button>
                )}

                {projects.map((entry) => {
                  const openEntry = () => {
                    const fresh = loadRecentProjects().find((item) => item.id === entry.key);
                    void openListedProject(fresh
                      ? {
                        ...entry,
                        name: fresh.name,
                        updatedAt: fresh.updatedAt,
                        project: fresh.project,
                        recent: fresh,
                        cloudOnly: false,
                      }
                      : entry);
                  };
                  const renaming = renamingId === entry.key;
                  const selected = selectedIds.includes(entry.key);
                  const where = syncWhereLabel(
                    cloudIds.has(entry.key) || Boolean(entry.cloudOnly),
                    accountEmail,
                    cloudChecked,
                    cloudCheckFailed,
                    desktop,
                  );
                  const copy = (
                    <span className="dash-card-copy">
                      {renaming ? (
                        <label className="dash-card-rename">
                          <span className="sr-only">Project name</span>
                          <input
                            ref={renameInputRef}
                            className="dash-card-rename-input"
                            value={renameDraft}
                            maxLength={PROJECT_NAME_MAX}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            onBlur={() => commitListedRename(entry)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                commitListedRename(entry);
                              } else if (event.key === 'Escape') {
                                event.preventDefault();
                                cancelListedRename();
                              }
                            }}
                          />
                        </label>
                      ) : (
                        <strong>{entry.name}</strong>
                      )}
                      <span>{projectMeta(entry)}</span>
                      <span className={`dash-sync-where is-${where.kind}`}>{where.text}</span>
                    </span>
                  );
                  const beginLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
                    if (event.button !== 0 || renaming || selectMode) return;
                    clearLongPress();
                    const pointerId = event.pointerId;
                    const x = event.clientX;
                    const y = event.clientY;
                    longPressRef.current = {
                      id: entry.key,
                      pointerId,
                      x,
                      y,
                      timer: window.setTimeout(() => {
                        longPressRef.current = null;
                        suppressOpenRef.current = true;
                        enterSelectMode(entry.key);
                      }, LONG_PRESS_MS),
                    };
                  };
                  const moveLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
                    const press = longPressRef.current;
                    if (!press || press.pointerId !== event.pointerId) return;
                    const dx = event.clientX - press.x;
                    const dy = event.clientY - press.y;
                    if ((dx * dx) + (dy * dy) > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) {
                      clearLongPress();
                    }
                  };
                  const endLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
                    const press = longPressRef.current;
                    if (!press || press.pointerId !== event.pointerId) return;
                    clearLongPress();
                  };
                  return (
                    <article
                      key={entry.key}
                      className={`dash-card${menuId === entry.key ? ' is-menu-open' : ''}${renaming ? ' is-renaming' : ''}${selectMode ? ' is-selecting' : ''}${selected ? ' is-selected' : ''}`}
                      aria-selected={selectMode ? selected : undefined}
                    >
                      <button
                        type="button"
                        className="dash-card-open"
                        onPointerDown={beginLongPress}
                        onPointerMove={moveLongPress}
                        onPointerUp={endLongPress}
                        onPointerCancel={endLongPress}
                        onContextMenu={(event) => {
                          if (
                            selectMode
                            || suppressOpenRef.current
                            || longPressRef.current?.id === entry.key
                          ) {
                            event.preventDefault();
                          }
                        }}
                        onClick={() => {
                          if (suppressOpenRef.current) {
                            suppressOpenRef.current = false;
                            return;
                          }
                          if (selectMode) {
                            toggleSelected(entry.key);
                            return;
                          }
                          openEntry();
                        }}
                        title={
                          selectMode
                            ? (selected ? `Deselect ${entry.name}` : `Select ${entry.name}`)
                            : openingId === entry.key
                              ? `Opening ${entry.name}`
                              : `Open ${entry.name}`
                        }
                        disabled={!selectMode && openingId === entry.key}
                        aria-pressed={selectMode ? selected : undefined}
                      >
                        <span className="dash-card-thumb">
                          {entry.project ? (
                            <ProjectThumb
                              project={entry.project}
                              cacheKey={`${entry.key}:${entry.updatedAt}`}
                            />
                          ) : entry.preview ? (
                            <img className="dash-cloud-preview" src={entry.preview} alt="" />
                          ) : null}
                        </span>
                        {renaming ? null : copy}
                      </button>
                      {renaming ? copy : null}
                      {selectMode ? (
                        <span className={`dash-card-check${selected ? ' is-on' : ''}`} aria-hidden>
                          {selected ? <Check size={14} strokeWidth={2.6} /> : null}
                        </span>
                      ) : (
                        <div
                          className="dash-card-menu"
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="dash-card-more"
                            aria-label={`Actions for ${entry.name}`}
                            aria-expanded={menuId === entry.key}
                            onClick={() => setMenuId((current) => (current === entry.key ? null : entry.key))}
                          >
                            <img src={iconDots} alt="" width={19} height={19} />
                          </button>
                          {menuId === entry.key && (
                            <div className="dash-pop dash-pop-card">
                              <button type="button" onClick={() => { setMenuId(null); openEntry(); }}>Open</button>
                              <button
                                type="button"
                                aria-label={`Rename ${entry.name}`}
                                onClick={() => beginListedRename(entry)}
                              >
                                Rename
                              </button>
                              <button
                                type="button"
                                className="is-danger"
                                onClick={() => {
                                  setMenuId(null);
                                  setCloudRows((rows) => rows.filter((row) => row.local_id !== entry.key));
                                  onRemoveProject(entry.recent?.id ?? entry.key);
                                }}
                              >
                                Delete project
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuId(null);
                                  enterSelectMode(entry.key);
                                }}
                              >
                                Select…
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
              {openError && (
                <p className="dash-empty" role="alert">{openError}</p>
              )}
              {renameNotice && (
                <p className="dash-empty" role="alert">{renameNotice}</p>
              )}
              {query.trim() && projects.length === 0 && (
                <p className="dash-empty">No projects match “{query.trim()}”.</p>
              )}
            </>
          )}

          {section === 'models' && (
            <>
              <div className="dash-chips" role="tablist" aria-label="Device category">
                {DEVICE_CATEGORY_TABS.map((tab) => {
                  const Icon = DEVICE_CATEGORY_LUCIDE[DEVICE_CATEGORY_ICON[tab.id]];
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={deviceFilter === tab.id}
                      className={deviceFilter === tab.id ? 'is-active' : ''}
                      onClick={() => setDeviceFilter(tab.id)}
                    >
                      <Icon size={15} strokeWidth={1.8} aria-hidden />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              {modelCacheNotice ? (
                <p className="dash-empty" role="status">{modelCacheNotice}</p>
              ) : null}
              <div className="dash-grid dash-grid-models">
                {visibleDevices.map((device) => {
                  const unlocked = deviceUnlocked(device.id);
                  const proFeature = !isFreeDevice(device.id);
                  const bundled = isBundledLocalDevice(device.id);
                  const cache = bundled
                    ? 'ready'
                    : (modelCacheById[device.id]
                      ?? (peekDeviceModelCached(device.id) ? 'ready' : 'missing'));
                  const showDownload = remoteModels && !bundled && unlocked;
                  return (
                    <div key={device.id} className="dash-model-card-wrap">
                      <button
                        type="button"
                        className={`dash-card dash-model-card ${unlocked ? '' : 'is-locked'} ${proFeature ? 'is-pro-feature' : ''}`}
                        onClick={() => onStartDevice(device.id)}
                        title={unlocked ? `Start with ${device.label}` : `${device.label} is a Pro model`}
                      >
                        {!unlocked ? <span className="pro-feature-tag" aria-label="Locked">Locked</span> : null}
                        {bundled ? <span className="device-model-local-tag" aria-label="Ships with app">Local</span> : null}
                        <span className="dash-card-thumb dash-model-thumb">
                          <DeviceModelThumb deviceId={device.id} />
                        </span>
                        <span className="dash-card-copy">
                          <strong>{device.label}</strong>
                          <span>{device.subtitle}</span>
                        </span>
                      </button>
                      {showDownload ? (
                        <button
                          type="button"
                          className={`device-model-card-download is-${cache}`}
                          disabled={cache === 'downloading' || cache === 'ready'}
                          aria-label={
                            cache === 'ready'
                              ? `${device.label} downloaded`
                              : cache === 'downloading'
                                ? `Downloading ${device.label}`
                                : `Download ${device.label} for offline use`
                          }
                          title={
                            cache === 'ready'
                              ? 'Downloaded — ready to use offline'
                              : cache === 'downloading'
                                ? 'Downloading…'
                                : cache === 'error'
                                  ? 'Retry download'
                                  : 'Download model so it’s ready to use'
                          }
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (cache === 'ready' || cache === 'downloading') return;
                            void downloadDashModel(device);
                          }}
                        >
                          {cache === 'downloading' ? (
                            <LoaderCircle size={12} className="is-spinning" aria-hidden />
                          ) : cache === 'ready' ? (
                            <Check size={12} aria-hidden />
                          ) : (
                            <Download size={12} aria-hidden />
                          )}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {section === 'templates' && (
            <div className="dash-template-stack">
              {templatesUpgradeHint && !canUseProMaxPack && !canUseDeviceLayouts ? (
                <p className="dash-empty">{templatesUpgradeHint}</p>
              ) : null}

              <section className="dash-template-block" aria-labelledby="dash-templates-heading">
                <div className="dash-template-block-head">
                  <h2 id="dash-templates-heading">Templates</h2>
                  {toolsetSwitchAvailable && onAddShippedTemplate && canUseProMaxPack && (
                    <button
                      type="button"
                      className="dash-new dash-template-add"
                      onClick={() => {
                        if (!isDeveloperToolset) onSetToolset?.('developer');
                        setTemplateCategory('scenes');
                        onAddShippedTemplate('scenes');
                      }}
                    >
                      <img src={iconPlus} alt="" width={20} height={20} />
                      New template
                    </button>
                  )}
                </div>
                {!canUseProMaxPack && compositionTemplates.length === 0 ? (
                  <p className="dash-empty">{templatesUpgradeHint || 'Scenic templates unlock with Pro Max in the Template store.'}</p>
                ) : compositionTemplates.length === 0 && !(toolsetSwitchAvailable && onAddShippedTemplate) ? (
                  <p className="dash-empty">
                    {templatesUpgradeHint || 'No scenic templates downloaded yet. Open the Template store to install some.'}
                  </p>
                ) : (
                  <div className="dash-template-rail">
                    <div className="dash-template-carousel" role="list">
                      <div className="dash-template-carousel-track">
                    {toolsetSwitchAvailable && onAddShippedTemplate && (
                      <button
                        type="button"
                        className="dash-template-create dash-template-create-rail"
                        title="New template"
                        aria-label="New template"
                        onClick={() => {
                          if (!isDeveloperToolset) onSetToolset?.('developer');
                          setTemplateCategory('scenes');
                          onAddShippedTemplate('scenes');
                        }}
                      >
                        <img src={iconPlus} alt="" width={28} height={28} />
                        <strong>New template</strong>
                      </button>
                    )}
                    {compositionTemplates.map((template) => {
                      const menuKey = `template:${template.id}`;
                      const canManageShipped = Boolean(toolsetSwitchAvailable);
                      return (
                        <article
                          key={template.id}
                          role="listitem"
                          className={`dash-card dash-template-card${canManageShipped ? ' is-dev-editable' : ''}${menuId === menuKey ? ' is-menu-open' : ''}`}
                        >
                          <button type="button" className="dash-card-open" onClick={() => onStartTemplate(template)}>
                            <span className="dash-card-thumb dash-template-thumb">
                              <TemplateThumb template={template} />
                            </span>
                            <span className="dash-card-copy">
                              <strong>{template.label}</strong>
                            </span>
                          </button>
                          <div className="dash-card-menu" onPointerDown={(event) => event.stopPropagation()}>
                            <button
                              type="button"
                              className="dash-card-more"
                              aria-label={`Actions for ${template.label}`}
                              aria-expanded={menuId === menuKey}
                              onClick={() => setMenuId((current) => (current === menuKey ? null : menuKey))}
                            >
                              <img src={iconDots} alt="" width={19} height={19} />
                            </button>
                            {menuId === menuKey && (
                              <div className="dash-pop dash-pop-card">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMenuId(null);
                                    if (canManageShipped && !isDeveloperToolset) onSetToolset?.('developer');
                                    onStartTemplate(template);
                                  }}
                                >
                                  {canManageShipped ? 'Edit' : 'Open'}
                                </button>
                                {canManageShipped && onRenameTemplate && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMenuId(null);
                                      if (!isDeveloperToolset) onSetToolset?.('developer');
                                      onRenameTemplate(template);
                                    }}
                                  >
                                    Rename
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMenuId(null);
                                    if (canManageShipped && !isDeveloperToolset) onSetToolset?.('developer');
                                    onDuplicateTemplate(template);
                                  }}
                                >
                                  {canManageShipped ? 'Duplicate' : 'Duplicate to Yours'}
                                </button>
                                {canManageShipped && (
                                  <button
                                    type="button"
                                    className="is-danger"
                                    onClick={() => {
                                      setMenuId(null);
                                      if (!isDeveloperToolset) onSetToolset?.('developer');
                                      onDeleteShippedTemplate?.(template);
                                    }}
                                  >
                                    Delete
                                  </button>
                                )}
                                {!includeAllTemplates && installedIdSet.has(template.id) && (
                                  <button
                                    type="button"
                                    className="is-danger"
                                    onClick={() => {
                                      setMenuId(null);
                                      removeInstalledTemplate(template.id);
                                    }}
                                  >
                                    Remove download
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <section className="dash-template-block" aria-labelledby="dash-scene-templates-heading">
                <div className="dash-template-block-head">
                  <h2 id="dash-scene-templates-heading">Scene templates</h2>
                  {toolsetSwitchAvailable && onAddShippedTemplate && canUseDeviceLayouts && (
                    <button
                      type="button"
                      className="dash-new dash-template-add"
                      onClick={() => {
                        if (!isDeveloperToolset) onSetToolset?.('developer');
                        setTemplateCategory('devices');
                        onAddShippedTemplate('devices');
                      }}
                    >
                      <img src={iconPlus} alt="" width={20} height={20} />
                      New scene template
                    </button>
                  )}
                </div>
                {!canUseDeviceLayouts && sceneTemplates.length === 0 ? (
                  <p className="dash-empty">
                    {templatesUpgradeHint || 'Download free starter layouts from the Template store, or upgrade to Pro for more.'}
                  </p>
                ) : sceneTemplates.length === 0 && !(toolsetSwitchAvailable && onAddShippedTemplate) ? (
                  <p className="dash-empty">
                    {templatesUpgradeHint || 'No scene templates downloaded yet. Open the Template store to install some.'}
                  </p>
                ) : (
                  <div className="dash-template-rail">
                    <div className="dash-template-carousel" role="list">
                      <div className="dash-template-carousel-track">
                    {toolsetSwitchAvailable && onAddShippedTemplate && (
                      <button
                        type="button"
                        className="dash-template-create dash-template-create-rail"
                        title="New scene template"
                        aria-label="New scene template"
                        onClick={() => {
                          if (!isDeveloperToolset) onSetToolset?.('developer');
                          setTemplateCategory('devices');
                          onAddShippedTemplate('devices');
                        }}
                      >
                        <img src={iconPlus} alt="" width={28} height={28} />
                        <strong>New scene template</strong>
                      </button>
                    )}
                    {sceneTemplates.map((template) => {
                      const menuKey = `template:${template.id}`;
                      const canManageShipped = Boolean(toolsetSwitchAvailable);
                      return (
                        <article
                          key={template.id}
                          role="listitem"
                          className={`dash-card dash-template-card${canManageShipped ? ' is-dev-editable' : ''}${menuId === menuKey ? ' is-menu-open' : ''}`}
                        >
                          <button type="button" className="dash-card-open" onClick={() => onStartTemplate(template)}>
                            <span className="dash-card-thumb dash-template-thumb">
                              <TemplateThumb template={template} />
                            </span>
                            <span className="dash-card-copy">
                              <strong>{template.label}</strong>
                            </span>
                          </button>
                          <div className="dash-card-menu" onPointerDown={(event) => event.stopPropagation()}>
                            <button
                              type="button"
                              className="dash-card-more"
                              aria-label={`Actions for ${template.label}`}
                              aria-expanded={menuId === menuKey}
                              onClick={() => setMenuId((current) => (current === menuKey ? null : menuKey))}
                            >
                              <img src={iconDots} alt="" width={19} height={19} />
                            </button>
                            {menuId === menuKey && (
                              <div className="dash-pop dash-pop-card">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMenuId(null);
                                    if (canManageShipped && !isDeveloperToolset) onSetToolset?.('developer');
                                    onStartTemplate(template);
                                  }}
                                >
                                  {canManageShipped ? 'Edit' : 'Open'}
                                </button>
                                {canManageShipped && onRenameTemplate && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMenuId(null);
                                      if (!isDeveloperToolset) onSetToolset?.('developer');
                                      onRenameTemplate(template);
                                    }}
                                  >
                                    Rename
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMenuId(null);
                                    if (canManageShipped && !isDeveloperToolset) onSetToolset?.('developer');
                                    onDuplicateTemplate(template);
                                  }}
                                >
                                  {canManageShipped ? 'Duplicate' : 'Duplicate to Yours'}
                                </button>
                                {canManageShipped && (
                                  <button
                                    type="button"
                                    className="is-danger"
                                    onClick={() => {
                                      setMenuId(null);
                                      if (!isDeveloperToolset) onSetToolset?.('developer');
                                      onDeleteShippedTemplate?.(template);
                                    }}
                                  >
                                    Delete
                                  </button>
                                )}
                                {!includeAllTemplates && installedIdSet.has(template.id) && (
                                  <button
                                    type="button"
                                    className="is-danger"
                                    onClick={() => {
                                      setMenuId(null);
                                      removeInstalledTemplate(template.id);
                                    }}
                                  >
                                    Remove download
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                      </div>
                    </div>
                  </div>
                )}

                <div className="dash-template-nest" aria-labelledby="dash-social-heading">
                  <div className="dash-template-block-head">
                    <h3 id="dash-social-heading">Social media</h3>
                    {toolsetSwitchAvailable && onAddShippedTemplate && canUseSocialAssets && (
                      <button
                        type="button"
                        className="dash-new dash-template-add"
                        onClick={() => {
                          if (!isDeveloperToolset) onSetToolset?.('developer');
                          setTemplateCategory('social');
                          onAddShippedTemplate('social');
                        }}
                      >
                        <img src={iconPlus} alt="" width={20} height={20} />
                        New social template
                      </button>
                    )}
                  </div>
                  {!canUseSocialAssets && socialTemplates.length === 0 ? (
                    <p className="dash-empty">Social media packs unlock with Pro in the Template store.</p>
                  ) : socialTemplates.length === 0 && !(toolsetSwitchAvailable && onAddShippedTemplate) ? (
                    <p className="dash-empty">
                      {templatesUpgradeHint || 'No social templates downloaded yet. Open the Template store to install some.'}
                    </p>
                  ) : (
                    <div className="dash-template-rail">
                      <div className="dash-template-carousel" role="list">
                        <div className="dash-template-carousel-track">
                      {toolsetSwitchAvailable && onAddShippedTemplate && (
                        <button
                          type="button"
                          className="dash-template-create dash-template-create-rail"
                          title="New social template"
                          aria-label="New social template"
                          onClick={() => {
                            if (!isDeveloperToolset) onSetToolset?.('developer');
                            setTemplateCategory('social');
                            onAddShippedTemplate('social');
                          }}
                        >
                          <img src={iconPlus} alt="" width={28} height={28} />
                          <strong>New social template</strong>
                        </button>
                      )}
                      {socialTemplates.map((template) => {
                        const menuKey = `template:${template.id}`;
                        const canManageShipped = Boolean(toolsetSwitchAvailable);
                        return (
                          <article
                            key={template.id}
                            role="listitem"
                            className={`dash-card dash-template-card${canManageShipped ? ' is-dev-editable' : ''}${menuId === menuKey ? ' is-menu-open' : ''}`}
                          >
                            <button type="button" className="dash-card-open" onClick={() => onStartTemplate(template)}>
                              <span className="dash-card-thumb dash-template-thumb">
                                <TemplateThumb template={template} />
                              </span>
                              <span className="dash-card-copy">
                                <strong>{template.label}</strong>
                              </span>
                            </button>
                            <div className="dash-card-menu" onPointerDown={(event) => event.stopPropagation()}>
                              <button
                                type="button"
                                className="dash-card-more"
                                aria-label={`Actions for ${template.label}`}
                                aria-expanded={menuId === menuKey}
                                onClick={() => setMenuId((current) => (current === menuKey ? null : menuKey))}
                              >
                                <img src={iconDots} alt="" width={19} height={19} />
                              </button>
                              {menuId === menuKey && (
                                <div className="dash-pop dash-pop-card">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMenuId(null);
                                      if (canManageShipped && !isDeveloperToolset) onSetToolset?.('developer');
                                      onStartTemplate(template);
                                    }}
                                  >
                                    {canManageShipped ? 'Edit' : 'Open'}
                                  </button>
                                  {canManageShipped && onRenameTemplate && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setMenuId(null);
                                        if (!isDeveloperToolset) onSetToolset?.('developer');
                                        onRenameTemplate(template);
                                      }}
                                    >
                                      Rename
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMenuId(null);
                                      if (canManageShipped && !isDeveloperToolset) onSetToolset?.('developer');
                                      onDuplicateTemplate(template);
                                    }}
                                  >
                                    {canManageShipped ? 'Duplicate' : 'Duplicate to Yours'}
                                  </button>
                                  {canManageShipped && (
                                    <button
                                      type="button"
                                      className="is-danger"
                                      onClick={() => {
                                        setMenuId(null);
                                        if (!isDeveloperToolset) onSetToolset?.('developer');
                                        onDeleteShippedTemplate?.(template);
                                      }}
                                    >
                                      Delete
                                    </button>
                                  )}
                                  {!includeAllTemplates && installedIdSet.has(template.id) && (
                                    <button
                                      type="button"
                                      className="is-danger"
                                      onClick={() => {
                                        setMenuId(null);
                                        removeInstalledTemplate(template.id);
                                      }}
                                    >
                                      Remove download
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </article>
                        );
                      })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </section>

            </div>
          )}

          {section === 'template-store' && (
            <div className="dash-store">
              <p className="dash-store-lead">
                Every template is downloadable. Nothing appears under Templates until you install it here.
              </p>
              <div className="dash-store-pack-actions" role="list" aria-label="Download packs">
                {(Object.values(TEMPLATE_STORE_PACKS) as typeof TEMPLATE_STORE_PACKS[StorePackId][]).map((pack) => {
                  const unlocked = canDownloadPack(pack.id);
                  const installed = isPackFullyInstalled(pack.id);
                  return (
                    <button
                      key={pack.id}
                      type="button"
                      role="listitem"
                      className={`dash-store-pack-row${installed ? ' is-owned' : ''}${unlocked ? '' : ' is-locked'}`}
                      onClick={() => {
                        if (!unlocked) {
                          onExplorePro();
                          return;
                        }
                        if (installed) {
                          setSection('templates');
                          setTemplateCategory(
                            pack.id === 'social-studio'
                              ? 'social'
                              : pack.id === 'starter-layouts' || pack.id === 'multi-device'
                                ? 'devices'
                                : 'scenes',
                          );
                          return;
                        }
                        downloadStorePack(pack.id);
                      }}
                    >
                      <span className="dash-store-pack-row-copy">
                        <strong>{pack.name}</strong>
                        <em>{installed ? 'Installed' : pack.priceLabel}</em>
                      </span>
                      <span className={`dash-store-pack-cta${installed || !unlocked ? '' : ' is-primary'}`}>
                        {installed
                          ? 'Open library'
                          : unlocked
                            ? (licensingDisabled ? 'Download pack' : 'Download pack')
                            : pack.tier === 'pro_max'
                              ? (licensingDisabled ? 'View plans' : 'Unlock with Pro Max')
                              : (licensingDisabled ? 'View plans' : 'Unlock with Pro')}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="dash-store-masonry" role="list">
                {storeTiles.map((tile) => {
                  const template = getCompositionTemplate(tile.templateId);
                  if (!template) return null;
                  const pack = TEMPLATE_STORE_PACKS[tile.packId];
                  const unlocked = canDownloadPack(tile.packId);
                  const installed = installedIdSet.has(tile.templateId) || isTemplateInstalled(tile.templateId);
                  const actionLabel = installed
                    ? 'Open'
                    : unlocked
                      ? 'Download'
                      : pack.tier === 'pro_max'
                        ? (licensingDisabled ? 'View plans' : 'Buy Pro Max')
                        : pack.tier === 'free'
                          ? 'Download'
                          : (licensingDisabled ? 'View plans' : 'Buy Pro');
                  return (
                    <button
                      key={`${tile.packId}:${tile.templateId}`}
                      type="button"
                      role="listitem"
                      className={`dash-store-pack is-${tile.masonry}${installed ? ' is-owned' : ''}`}
                      onClick={() => {
                        if (!unlocked) {
                          onExplorePro();
                          return;
                        }
                        if (installed) {
                          onStartTemplate(template);
                          return;
                        }
                        downloadStoreTemplate(tile.templateId, tile.packId);
                      }}
                    >
                      <span className="dash-store-pack-media" aria-hidden>
                        <TemplateThumb template={template} />
                      </span>
                      <span className="dash-store-pack-copy">
                        <em>{installed ? 'Installed' : pack.priceLabel}</em>
                        <strong>{template.label}</strong>
                        <span className="dash-store-pack-name">{pack.name}</span>
                        <ul className="dash-store-pack-includes">
                          {pack.includes.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </span>
                      <span className={`dash-store-pack-cta${installed || !unlocked ? '' : ' is-primary'}`}>
                        <Download size={13} aria-hidden />
                        {actionLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {section === 'my-templates' && (
            savedCompositions.length === 0 ? (
              <p className="dash-empty">Save as template from the File menu or Transform while a project is open. Signed-in accounts sync templates with your cloud projects.</p>
            ) : (
              <div className="dash-template-rail">
                <div className="dash-template-carousel" role="list">
                  <div className="dash-template-carousel-track">
                {savedCompositions.map((template) => {
                  const menuKey = `template:${template.id}`;
                  return (
                    <article
                      key={template.id}
                      role="listitem"
                      className={`dash-card dash-template-card${menuId === menuKey ? ' is-menu-open' : ''}`}
                    >
                      <button type="button" className="dash-card-open" onClick={() => onStartTemplate(template)}>
                        <span className="dash-card-thumb dash-template-thumb">
                          <TemplateThumb template={template} />
                        </span>
                        <span className="dash-card-copy">
                          <strong>{template.label}</strong>
                        </span>
                      </button>
                      <div className="dash-card-menu" onPointerDown={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          className="dash-card-more"
                          aria-label={`Actions for ${template.label}`}
                          aria-expanded={menuId === menuKey}
                          onClick={() => setMenuId((current) => (current === menuKey ? null : menuKey))}
                        >
                          <img src={iconDots} alt="" width={19} height={19} />
                        </button>
                        {menuId === menuKey && (
                          <div className="dash-pop dash-pop-card">
                            <button
                              type="button"
                              onClick={() => {
                                setMenuId(null);
                                onStartTemplate(template);
                              }}
                            >
                              Open
                            </button>
                            {onRenameTemplate && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuId(null);
                                  onRenameTemplate(template);
                                }}
                              >
                                Rename
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setMenuId(null);
                                onDuplicateTemplate(template);
                              }}
                            >
                              Duplicate
                            </button>
                            <button
                              type="button"
                              className="is-danger"
                              onClick={() => {
                                setMenuId(null);
                                onDeleteSavedTemplate(template.id);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
                  </div>
                </div>
              </div>
            )
          )}

          {section === 'assets' && (
            recentScreenshots.length === 0 ? (
              <p className="dash-empty">Screenshots you drop into a scene show up here.</p>
            ) : (
              <div className="dash-grid">
                {recentScreenshots.map((shot) => (
                  <article key={shot.id} className="dash-card dash-asset-card">
                    <span className="dash-card-thumb">
                      <img src={shot.dataUrl} alt="" />
                    </span>
                    <span className="dash-card-copy">
                      <strong>{shot.name}</strong>
                      <span>{editedPhrase(shot.addedAt)}</span>
                    </span>
                  </article>
                ))}
              </div>
            )
          )}

          {section === 'settings' && (
            <div className="dash-settings">
              <div className="dash-setting">
                <AccentThemePicker />
              </div>
              <CloudAccountPanel
                recentProjects={recentProjects}
                onMergeCloudProjects={onMergeCloudProjects}
                onApplyCloudDeletes={onApplyCloudDeletes}
                onConflicts={onSyncConflicts}
                onSignedInChange={onCloudSignedInChange}
                onAfterSync={() => { void refreshCloudIds(); }}
              />
              <AccountLicencePanel
                license={license}
                onLicenseChange={onLicenseChange}
                onOpenPlans={onExplorePro}
              />
              <button type="button" className="dash-setting" onClick={onOpenFile}>
                <strong>Open a project file</strong>
                <span>Load a template you saved earlier</span>
              </button>
              {!licensingDisabled && (
                <button type="button" className="dash-setting" onClick={onExplorePro}>
                  <strong>Explore Pro</strong>
                  <span>Devices, video export, and higher resolutions · {planLabel(featureTier, { markDevOverride: true })}</span>
                </button>
              )}
              <button type="button" className="dash-setting" onClick={onFeedback}>
                <strong>Send feedback</strong>
                <span>Tell us what the studio should do next</span>
              </button>
              {onShowOnboarding && (
                <button type="button" className="dash-setting" onClick={onShowOnboarding}>
                  <strong>Replay onboarding</strong>
                  <span>Intro screens, then the in-app tool walkthrough</span>
                </button>
              )}
              {onShowStudioTour && (
                <button type="button" className="dash-setting" onClick={onShowStudioTour}>
                  <strong>Replay tool walkthrough</strong>
                  <span>Highlight each workspace section again</span>
                </button>
              )}

              <div className="dash-setting dash-legal" id="settings-about">
                <strong>About</strong>
                <span>{APP_ABOUT_SUMMARY}</span>
                <span className="dash-legal-meta">
                  mokstudio · {typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.1.2'}
                </span>
              </div>

              <div className="dash-setting dash-legal" id="settings-legal">
                <strong>Legal</strong>
                <span>{NON_AFFILIATION_DISCLAIMER}</span>
                <span>{EXPORT_USAGE_NOTICE}</span>
                <span>{MODEL_LICENSING_NOTICE}</span>
                <div className="dash-legal-links">
                  {([
                    ['Terms', '/terms'],
                    ['Privacy', '/privacy'],
                    ['Credits', '/credits'],
                  ] as const).map(([label, path]) => (
                    <button
                      key={path}
                      type="button"
                      className="dash-legal-link"
                      onClick={() => {
                        const url = `${getCheckoutConfig().siteUrl}${path}`;
                        void (async () => {
                          try {
                            if (window.mockupDesktop?.openExternal) {
                              await window.mockupDesktop.openExternal(url);
                              return;
                            }
                          } catch {
                            /* fall through */
                          }
                          window.open(url, '_blank', 'noopener,noreferrer');
                        })();
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <p className="dash-footer">
            {cloudSignedInEmail
              ? `Signed in as ${cloudSignedInEmail} · syncing to your account`
              : 'All changes saved automatically'}
          </p>
        </main>
      </div>
    </div>
  );
}
