import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import {
  Aperture, ArrowDownToLine, ArrowLeftRight, Box, Camera, Check, ChevronDown, CircleHelp,
  Clock3, Columns2, Command, Copy, Download, FileCode2, FileImage, Film, FolderOpen, Gauge, ImagePlus, KeyRound, Layers3,
  LayoutTemplate, Lock, Minus, MonitorSmartphone, MoreHorizontal, MousePointer2, Plus, RotateCcw, Rotate3D, Save,
  Settings2, SlidersHorizontal, Smartphone, Sparkles, Sun, Trash2, Upload, X,
} from 'lucide-react';
import AnimationTimeline from './components/AnimationTimeline';
import CropFocusOverlay from './components/CropFocusOverlay';
import CustomDevicePanel from './components/CustomDevicePanel';
import DeviceCanvas, { type CaptureApi, type DeviceSelectPayload } from './components/DeviceCanvas';
import FigmaExploreModal from './components/FigmaExploreModal';
import LicenseModal from './components/LicenseModal';
import SvgExplodeModal from './components/SvgExplodeModal';
import ProgressiveBlurOverlay from './components/ProgressiveBlurOverlay';
import ReflectionMapPicker from './components/ReflectionMapPicker';
import {
  hydrateCustomDeviceUrls,
  loadCustomDeviceMeta,
  subscribeCustomDevices,
  type CustomDeviceMeta,
} from './lib/customDevices';
import { isPlaceholderScreenshot, placeholderForDevice } from './lib/demo';
import {
  defaultCameraPosition, evaluateAnimation, evaluateCamera, hasAnimation, hasCameraAnimation,
  upsertKeyframe,
} from './lib/animation';
import { applyAnimationPreset, getAnimationPreset } from './lib/animationPresets';
import { DEVICE_MODELS, getDevice, isCustomDeviceId, listAllDevices, screenSizeLabel } from './lib/devices';
import { createOverlay, drawOverlays, overlayVisibleAt, type SceneOverlay } from './lib/overlays';
import {
  isImageFile, isVideoFile, readFileAsDataUrl, readImageFromClipboard, readImageFromPasteEvent,
  screenMediaKind, seekAllScreenMedia,
} from './lib/screenMedia';
import {
  isSvgFile, parseSvgDocument, readFileAsText, readSvgTextFromPasteEvent,
  type SvgDocumentModel,
} from './lib/svgLayers';
import {
  isDesktopApp,
  listMirrorDevices,
  snapshotMirrorStream,
  startPhoneMirror,
  stopPhoneMirror,
  type MirrorDevice,
} from './lib/phoneMirror';
import {
  AndroidMirrorPlayer,
  getAndroidMirrorStatus,
  isAndroidMirrorAvailable,
  sortAndroidDevicesPreferred,
  type AndroidDeviceInfo,
} from './lib/androidMirror';
import {
  PLAN_PRICES_GBP,
  canExportVideo,
  formatGbp,
  isDeviceUnlocked,
  isResolutionAllowed,
  loadLicense,
  maxDevicesFor,
  planLabel,
  upgradeCopy,
  type LicenseState,
} from './lib/license';
import { downloadBlob, safeFilename, validateProject } from './lib/project';
import {
  loadRecentScreenshots, rememberRecentScreenshot,
  type RecentScreenshot,
} from './lib/recentScreenshots';
import {
  STILL_FORMATS, VIDEO_FORMATS, encodeAnimationVideo, isStillExport, isVideoExport,
  stillFormatById, videoFormatById, videoFormatsForAlpha,
  type ExportKind, type StillFormatId, type VideoFormatId,
} from './lib/videoExport';
import {
  MAX_PROJECT_TABS, createProjectTab, tabLabel,
  type ProjectTab,
} from './lib/projectTabs';
import {
  formatRecentTime, loadRecentProjects, rememberRecentProject, removeRecentProject,
  type RecentProjectEntry,
} from './lib/recentProjects';
import { deleteCustomScenePreset, loadCustomScenePresets, saveCustomScenePreset } from './lib/scenePresets';
import {
  projectFromTemplate, templatesByCategory,
  type CompositionTemplate, type TemplateCategory,
} from './lib/templates';
import {
  BACKGROUNDS, CAMERA_LENSES, CAMERA_TARGET_ID, DEFAULT_GRADIENT, DEFAULT_PROJECT, DEVICE_COLORS,
  EXPORT_ASPECTS, EXPORT_ASPECT_GROUPS, EXPORT_FPS_OPTIONS, EXPORT_RESOLUTIONS,
  EXPORT_SIZE_LIMITS, MAX_DEVICES, exportAspectFixedSize, exportAspectHasFixed, resolveExportDimensions,
  buildSplitDevices, createDefaultAnimation, createDeviceInstance, getSelectedDevice, gradientCss,
  syncProjectFromSelected,
  type AnimProperty, type BackgroundPreset, type CameraView, type DeviceColor, type ExportAspectId,
  type ExportResolutionId, type GradientColors, type MockupProject, type ReflectionMapSetting,
  type ScenePreset, type Vec3,
} from './types';

type LeftTab = 'scenes' | 'assets';
type Workspace = { tabs: ProjectTab[]; activeId: string | null };
type ExportScale = 0.5 | 1 | 2 | 3 | 4;
type ExportMediaMode = 'static' | 'animated';
type ExportEntry = { id: string; kind: ExportKind; scale: ExportScale };

const EXPORT_SCALES: ExportScale[] = [0.5, 1, 2, 3, 4];

function createExportEntry(kind: ExportKind = 'png', scale: ExportScale = 1): ExportEntry {
  return { id: `export-${Math.random().toString(36).slice(2, 10)}`, kind, scale };
}

function formatExportScale(scale: ExportScale) {
  return `${scale}x`;
}

function scaledExportDimensions(width: number, height: number, scale: ExportScale) {
  const even = (n: number) => {
    const v = Math.max(2, Math.round(n));
    return v % 2 === 0 ? v : v - 1;
  };
  return {
    width: even(width * scale),
    height: even(height * scale),
  };
}

const ALL_EXPORT_FORMATS: { id: ExportKind; label: string; group: 'still' | 'video' }[] = [
  ...STILL_FORMATS.map((item) => ({ id: item.id as ExportKind, label: item.label, group: 'still' as const })),
  ...VIDEO_FORMATS.map((item) => ({ id: item.id as ExportKind, label: item.label, group: 'video' as const })),
];

function createInitialWorkspace(): Workspace {
  const tab = createProjectTab({
    ...DEFAULT_PROJECT,
    gradientColors: { ...DEFAULT_GRADIENT },
    screenshot: placeholderForDevice(DEFAULT_PROJECT.deviceId),
  });
  return { tabs: [tab], activeId: tab.id };
}

function TemplatePreview({ layout }: { layout: CompositionTemplate['preview'] }) {
  return (
    <div className={`template-preview layout-${layout}`} aria-hidden>
      {layout === 'solo' && <span className="phone p1" />}
      {layout === 'pair' && (<><span className="phone p1" /><span className="phone p2" /></>)}
      {layout === 'split' && (<><span className="phone p1" /><span className="phone p2" /></>)}
      {layout === 'stack' && (<><span className="phone p1" /><span className="phone p2" /></>)}
      {layout === 'trio' && (<><span className="phone p1" /><span className="phone p2" /><span className="phone p3" /></>)}
      {layout === 'fan' && (<><span className="phone p1" /><span className="phone p2" /><span className="phone p3" /></>)}
      {layout === 'depth' && (<><span className="phone p1" /><span className="phone p2" /><span className="phone p3" /></>)}
      {layout === 'clay' && (
        <>
          <span className="prop clay sphere s1" />
          <span className="prop clay cube c1" />
          <span className="prop clay torus t1" />
          <span className="phone p1" />
        </>
      )}
      {layout === 'concrete' && (
        <>
          <span className="prop wall" />
          <span className="prop slab" />
          <span className="phone p1" />
        </>
      )}
      {layout === 'pedestal' && (
        <>
          <span className="prop pedestal" />
          <span className="prop clay torus t1" />
          <span className="phone p1" />
        </>
      )}
      {layout === 'desk' && (
        <>
          <span className="prop clay sphere s1" />
          <span className="prop clay cyl" />
          <span className="phone p1" />
          <span className="phone p2" />
        </>
      )}
      {layout === 'studio' && (
        <>
          <span className="prop studio-wall" />
          <span className="prop studio-floor" />
          <span className="phone p1" />
          <span className="prop studio-shadow" />
        </>
      )}
    </div>
  );
}

function SliderField({ label, value, min, max, step = 1, unit = '°', onChange }: {
  label: string; value: number; min: number; max: number; step?: number;
  unit?: string; onChange: (v: number) => void;
}) {
  return (
    <div className="slider-field">
      <div className="slider-heading"><span>{label}</span><span className="slider-number">{value.toFixed(step < 1 ? 1 : 0)}{unit}</span></div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </div>
  );
}

function SwitchControl({
  checked,
  onChange,
  label,
  title,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      className={`switch-control ${checked ? 'is-on' : ''}`}
      aria-checked={checked}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-control-track" aria-hidden>
        <span className="switch-control-thumb" />
      </span>
    </button>
  );
}

function SettingsSection({
  id, title, icon: Icon, trailing, open, onToggle, children, last = false,
}: {
  id: string;
  title: string;
  icon: typeof Box;
  trailing?: string;
  open: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <section className={`settings-section ${last ? 'last-section' : ''} ${open ? 'is-open' : 'is-collapsed'}`}>
      <button
        type="button"
        className="section-heading section-toggle"
        aria-expanded={open}
        aria-controls={`settings-${id}`}
        onClick={() => onToggle(id)}
      >
        <div className="section-heading-left">
          <Icon size={15} strokeWidth={1.9} aria-hidden />
          <span>{title}</span>
        </div>
        <span className="section-heading-right">
          {trailing && <span className="section-meta">{trailing}</span>}
          <ChevronDown size={15} className={`section-chevron ${open ? 'is-open' : ''}`} />
        </span>
      </button>
      <div
        id={`settings-${id}`}
        className="settings-section-collapse"
        aria-hidden={!open}
      >
        <div className="settings-section-body">
          {children}
        </div>
      </div>
    </section>
  );
}

const BUILTIN_SCENE_HINTS: Record<string, string> = {
  midnight: 'Dark, moody elegance',
  studio: 'Warm editorial tones',
  mint: 'Bold emerald atmosphere',
  sunset: 'A splash of colour',
  transparent: 'Ready for compositing',
};

function exportRatioThumbStyle(ratio: number, max = 34): CSSProperties {
  if (ratio >= 1) {
    return { width: max, height: Math.max(10, Math.round(max / ratio)) };
  }
  return { width: Math.max(10, Math.round(max * ratio)), height: max };
}

function sceneThumbStyle(scene: ScenePreset): CSSProperties | undefined {
  if (!scene.gradient) return undefined;
  if (BACKGROUNDS.some((item) => item.id === scene.id)) return undefined;
  return { background: gradientCss(scene.gradient) };
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(createInitialWorkspace);
  const [customPresets, setCustomPresets] = useState<ScenePreset[]>(() => loadCustomScenePresets());
  const [customDevices, setCustomDevices] = useState<CustomDeviceMeta[]>(() => loadCustomDeviceMeta());
  const [devicesTick, setDevicesTick] = useState(0);
  const [presetName, setPresetName] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>('scenes');
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [figmaExploreOpen, setFigmaExploreOpen] = useState(false);
  const [svgExplodeModel, setSvgExplodeModel] = useState<SvgDocumentModel | null>(null);
  const [license, setLicense] = useState<LicenseState>(() => loadLicense());
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateCategory, setTemplateCategory] = useState<TemplateCategory>('devices');
  /** Platforms queued for export — select multiple to render several sizes at once. */
  const [exportAspectIds, setExportAspectIds] = useState<ExportAspectId[]>(['tiktok']);
  /** Live canvas crop frame — `free` hides the overlay. */
  const [previewFrame, setPreviewFrame] = useState<ExportAspectId | 'free'>('free');
  const [exportResolution, setExportResolution] = useState<ExportResolutionId>('fhd');
  const [customExportSize, setCustomExportSize] = useState({ width: 1080, height: 1920 });
  const [exportMode, setExportMode] = useState<'combined' | 'separate'>('combined');
  const [exportMediaMode, setExportMediaMode] = useState<ExportMediaMode>('static');
  const [staticExportEntries, setStaticExportEntries] = useState<ExportEntry[]>(() => [createExportEntry('png')]);
  const [animatedExportEntries, setAnimatedExportEntries] = useState<ExportEntry[]>(() => [createExportEntry('mp4')]);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [deviceMenu, setDeviceMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [gizmoDragging, setGizmoDragging] = useState(false);
  const [openSectionId, setOpenSectionId] = useState<string | null>('device');
  const [deviceDropdownOpen, setDeviceDropdownOpen] = useState(false);
  const [deviceChosen, setDeviceChosen] = useState(false);
  const [sidePanelsHidden, setSidePanelsHidden] = useState(false);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>(() => loadRecentProjects());
  const [recentScreenshots, setRecentScreenshots] = useState<RecentScreenshot[]>(() => loadRecentScreenshots());
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [mirrorStream, setMirrorStream] = useState<MediaStream | null>(null);
  const [mirrorSource, setMirrorSource] = useState<'ios' | 'android' | null>(null);
  const [mirrorDevice, setMirrorDevice] = useState<MirrorDevice | null>(null);
  const [mirrorDevices, setMirrorDevices] = useState<MirrorDevice[]>([]);
  const [androidDevices, setAndroidDevices] = useState<AndroidDeviceInfo[]>([]);
  const [androidAdbError, setAndroidAdbError] = useState<string | null>(null);
  const [androidMirrorLabel, setAndroidMirrorLabel] = useState<string | null>(null);
  const [androidMirrorSerial, setAndroidMirrorSerial] = useState<string | null>(null);
  const [mirrorBusy, setMirrorBusy] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const timelineBeforeHideRef = useRef(true);
  const overlayDragRef = useRef<{ id: string; pointerId: number } | null>(null);
  const mirrorStreamRef = useRef<MediaStream | null>(null);
  const androidPlayerRef = useRef<AndroidMirrorPlayer | null>(null);
  const androidUnsubRef = useRef<(() => void) | null>(null);
  const toggleSection = useCallback((id: string) => {
    setOpenSectionId((current) => (current === id ? null : id));
  }, []);
  const captureRef = useRef<CaptureApi | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const svgInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    void hydrateCustomDeviceUrls().then(() => {
      setCustomDevices(loadCustomDeviceMeta());
      setDevicesTick((n) => n + 1);
    });
    return subscribeCustomDevices(() => {
      setCustomDevices(loadCustomDeviceMeta());
      setDevicesTick((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    mirrorStreamRef.current = mirrorStream;
  }, [mirrorStream]);

  useEffect(() => () => {
    stopPhoneMirror(mirrorStreamRef.current);
    androidUnsubRef.current?.();
    androidUnsubRef.current = null;
    androidPlayerRef.current?.dispose();
    androidPlayerRef.current = null;
    void window.mockupDesktop?.androidStopMirror?.();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const devices = await listMirrorDevices();
        if (!cancelled) setMirrorDevices(devices);
      } catch {
        if (!cancelled) setMirrorDevices([]);
      }
      if (isAndroidMirrorAvailable()) {
        try {
          const status = await getAndroidMirrorStatus();
          if (cancelled) return;
          setAndroidDevices(sortAndroidDevicesPreferred(status.devices || []));
          setAndroidAdbError(status.ok ? null : (status.error || 'ADB unavailable'));
        } catch (err) {
          if (!cancelled) {
            setAndroidDevices([]);
            setAndroidAdbError(err instanceof Error ? err.message : 'ADB unavailable');
          }
        }
      }
    };
    void refresh();
    const onChange = () => { void refresh(); };
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    const timer = window.setInterval(() => { void refresh(); }, 4000);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
      window.clearInterval(timer);
    };
  }, []);

  const allDevices = useMemo(() => listAllDevices(), [customDevices, devicesTick]);
  const entitlementsMaxDevices = maxDevicesFor(license.tier);
  const videoAllowed = canExportVideo(license.tier);

  const activeTab = workspace.tabs.find((tab) => tab.id === workspace.activeId) ?? workspace.tabs[0] ?? null;
  const hasOpenProject = activeTab != null;
  const project = activeTab?.project ?? DEFAULT_PROJECT;
  const animTime = activeTab?.animTime ?? 0;
  const animPlaying = activeTab?.animPlaying ?? false;
  const timelineOpen = activeTab?.timelineOpen ?? false;

  const trackRecent = useCallback((nextProject: MockupProject) => {
    setRecentProjects(rememberRecentProject(nextProject));
  }, []);

  const setProject = useCallback((updater: MockupProject | ((current: MockupProject) => MockupProject)) => {
    setWorkspace((ws) => ({
      ...ws,
      tabs: ws.tabs.map((tab) => {
        if (tab.id !== ws.activeId) return tab;
        const next = typeof updater === 'function' ? updater(tab.project) : updater;
        return { ...tab, project: next };
      }),
    }));
  }, []);

  const setAnimTime = useCallback((value: number | ((time: number) => number)) => {
    setWorkspace((ws) => ({
      ...ws,
      tabs: ws.tabs.map((tab) => {
        if (tab.id !== ws.activeId) return tab;
        return { ...tab, animTime: typeof value === 'function' ? value(tab.animTime) : value };
      }),
    }));
  }, []);

  const setAnimPlaying = useCallback((value: boolean | ((playing: boolean) => boolean)) => {
    setWorkspace((ws) => ({
      ...ws,
      tabs: ws.tabs.map((tab) => {
        if (tab.id !== ws.activeId) return tab;
        return { ...tab, animPlaying: typeof value === 'function' ? value(tab.animPlaying) : value };
      }),
    }));
  }, []);

  const setTimelineOpen = useCallback((value: boolean | ((open: boolean) => boolean)) => {
    setWorkspace((ws) => ({
      ...ws,
      tabs: ws.tabs.map((tab) => {
        if (tab.id !== ws.activeId) return tab;
        return { ...tab, timelineOpen: typeof value === 'function' ? value(tab.timelineOpen) : value };
      }),
    }));
  }, []);

  const allScenes = [...BACKGROUNDS, ...customPresets];
  const isTransparent = project.background === 'transparent';

  useEffect(() => {
    if (!isTransparent) return;
    setAnimatedExportEntries((current) => {
      let changed = false;
      const next = current.map((entry) => {
        if (entry.kind !== 'mp4') return entry;
        changed = true;
        return { ...entry, kind: 'webm' as ExportKind };
      });
      return changed ? next : current;
    });
  }, [isTransparent]);

  const animation = project.animation ?? createDefaultAnimation(project.selectedDeviceId || 'device-main');
  const animActive = timelineOpen || animPlaying;
  const displayProject = useMemo(() => {
    // While the gizmo is live, feed raw project poses — evaluating keys mid-drag
    // overwrote the drag and fought TransformControls.
    if (gizmoDragging || !animActive || !hasAnimation(animation)) return project;
    return {
      ...project,
      animation,
      devices: evaluateAnimation(project.devices, animation, animTime),
    };
  }, [project, animation, animActive, animTime, gizmoDragging]);
  const displaySelected = getSelectedDevice(displayProject);
  const animatedCamera = useMemo(() => {
    if (!animActive || !hasCameraAnimation(animation)) return null;
    return evaluateCamera(
      animation,
      animTime,
      project.cameraView,
      project.compositionMode === 'split',
    );
  }, [animActive, animation, animTime, project.cameraView, project.compositionMode]);

  const bakeAnimationPose = useCallback((time = animTime) => {
    setProject((current) => {
      if (!hasAnimation(current.animation)) return current;
      const devices = evaluateAnimation(current.devices, current.animation, time);
      const nextSelected = devices.find((d) => d.id === current.selectedDeviceId) ?? devices[0];
      return syncProjectFromSelected({ ...current, devices }, nextSelected);
    });
  }, [animTime, setProject]);

  const toggleTimeline = () => {
    setTimelineOpen((open) => {
      if (open) {
        setAnimPlaying(false);
        bakeAnimationPose();
      }
      return !open;
    });
  };

  const updateProject = useCallback((patch: Partial<MockupProject>) => {
    setProject((current) => ({ ...current, ...patch }));
  }, [setProject]);

  const patchOverlay = useCallback((id: string, patch: Partial<SceneOverlay>) => {
    setProject((current) => ({
      ...current,
      overlays: (current.overlays ?? []).map((item) => (
        item.id === id ? { ...item, ...patch } : item
      )),
    }));
  }, [setProject]);

  const normalizeOverlayColor = (value: string) => {
    const trimmed = value.trim();
    const candidate = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(candidate)) return null;
    return candidate.toLowerCase();
  };

  const onOverlayPointerDown = (e: ReactPointerEvent<HTMLDivElement>, overlayId: string) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    overlayDragRef.current = { id: overlayId, pointerId: e.pointerId };
    setSelectedOverlayId(overlayId);
    setOpenSectionId('overlays');
  };

  const onOverlayPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = overlayDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const stage = e.currentTarget.parentElement;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    patchOverlay(drag.id, { x, y });
  };

  const onOverlayPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = overlayDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    overlayDragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  const switchTab = (id: string) => {
    if (id !== workspace.activeId) {
      setAnimPlaying(false);
      setWorkspace((ws) => ({ ...ws, activeId: id }));
    }
    setDeviceMenu(null);
    setRenamingTabId(null);
  };

  const beginRenameTab = (id: string, currentName: string) => {
    if (id !== workspace.activeId) {
      setAnimPlaying(false);
      setWorkspace((ws) => ({ ...ws, activeId: id }));
    }
    setDeviceMenu(null);
    setRenamingTabId(id);
    setRenameDraft(currentName);
  };

  const commitRenameTab = () => {
    if (!renamingTabId) return;
    const nextName = renameDraft.trim() || 'Untitled composition';
    setWorkspace((ws) => ({
      ...ws,
      tabs: ws.tabs.map((tab) => (
        tab.id === renamingTabId
          ? { ...tab, project: { ...tab.project, name: nextName.slice(0, 100) } }
          : tab
      )),
    }));
    setRenamingTabId(null);
  };

  const cancelRenameTab = () => {
    setRenamingTabId(null);
  };

  useEffect(() => {
    if (!renamingTabId) return undefined;
    const id = requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [renamingTabId]);

  const uniqueProjectName = (base: string) => {
    const used = new Set(workspace.tabs.map((tab) => tab.project.name.trim().toLowerCase()));
    if (!used.has(base.trim().toLowerCase())) return base;
    for (let i = 2; i < 100; i += 1) {
      const candidate = `${base} ${i}`;
      if (!used.has(candidate.toLowerCase())) return candidate;
    }
    return `${base} ${Date.now()}`;
  };

  const closeTab = (id: string) => {
    const closing = workspace.tabs.find((tab) => tab.id === id);
    if (closing) trackRecent(closing.project);

    setWorkspace((ws) => {
      const index = ws.tabs.findIndex((tab) => tab.id === id);
      if (index < 0) return ws;
      const tabs = ws.tabs.filter((tab) => tab.id !== id);
      if (!tabs.length) {
        return { tabs: [], activeId: null };
      }
      const activeId = ws.activeId === id
        ? (tabs[Math.max(0, index - 1)] ?? tabs[0]).id
        : ws.activeId;
      return { tabs, activeId };
    });
    setDeviceMenu(null);
    setRenamingTabId(null);
    setExportOpen(false);
    setAnimPlaying(false);
  };

  const openProjectInTab = (nextProject: MockupProject, notice?: string) => {
    trackRecent(nextProject);
    const tab = createProjectTab(nextProject);
    setWorkspace((ws) => {
      if (!ws.tabs.length) {
        return { tabs: [tab], activeId: tab.id };
      }
      if (ws.tabs.length >= MAX_PROJECT_TABS) {
        const activeId = ws.activeId ?? ws.tabs[0]?.id ?? tab.id;
        const tabs = ws.tabs.map((item) => (
          item.id === activeId
            ? { ...item, project: nextProject, animTime: 0, animPlaying: false }
            : item
        ));
        return { tabs, activeId };
      }
      return { tabs: [...ws.tabs, tab], activeId: tab.id };
    });
    setDeviceMenu(null);
    if (notice) notify(notice);
  };

  const openRecentProject = (entry: RecentProjectEntry) => {
    openProjectInTab(
      { ...entry.project, name: uniqueProjectName(entry.project.name || entry.name) },
      `Opened “${entry.name}”`,
    );
  };

  const startFromTemplate = (template: CompositionTemplate) => {
    const needsPro = template.devices.length > 1
      || template.compositionMode === 'split'
      || template.devices.some((d) => !isDeviceUnlocked(license.tier, d.deviceId));
    if (needsPro && license.tier === 'free') {
      notify(upgradeCopy('Multi-device templates and the full device library'));
      setLicenseOpen(true);
      return;
    }
    const finalName = uniqueProjectName(template.label);
    const nextProject = projectFromTemplate(template, { name: finalName });
    const canAddTab = workspace.tabs.length < MAX_PROJECT_TABS;
    setDeviceMenu(null);
    setTemplatePickerOpen(false);
    trackRecent(nextProject);

    if (canAddTab) {
      const tab = createProjectTab(nextProject);
      setWorkspace((ws) => ({ tabs: [...ws.tabs, tab], activeId: tab.id }));
      notify(`Opened “${finalName}” in a new tab`);
      return;
    }

    setWorkspace((ws) => ({
      ...ws,
      tabs: ws.tabs.map((tab) => (
        tab.id === ws.activeId
          ? { ...tab, project: nextProject, animTime: 0, animPlaying: false, timelineOpen: false }
          : tab
      )),
    }));
    notify(`Started “${finalName}”`);
  };

  const patchSelectedDevice = useCallback((patch: Partial<ReturnType<typeof getSelectedDevice>>) => {
    setProject((current) => {
      const selected = getSelectedDevice(current);
      const nextSelected = { ...selected, ...patch, rotation: patch.rotation ? { ...patch.rotation } : { ...selected.rotation }, position: patch.position ? { ...patch.position } : { ...selected.position } };
      const devices = current.devices.map((device) => {
        if (device.id !== selected.id) {
          // Keep split partners in sync for transform when in split mode
          if (current.compositionMode === 'split' && (patch.rotation || patch.scale != null)) {
            return {
              ...device,
              rotation: patch.rotation ? { ...patch.rotation } : device.rotation,
              scale: patch.scale ?? device.scale,
            };
          }
          return device;
        }
        return nextSelected;
      });
      return syncProjectFromSelected({ ...current, devices }, nextSelected);
    });
  }, []);

  const keyPropertyAtPlayhead = (property: AnimProperty, value: number) => {
    setProject((current) => {
      const target = getSelectedDevice(current);
      const existing = current.animation.tracks.find((t) => t.targetId === target.id && t.property === property);
      const tracks = existing
        ? current.animation.tracks.map((t) => (t.id === existing.id ? upsertKeyframe(t, animTime, value) : t))
        : [...current.animation.tracks, upsertKeyframe(
          { id: `track-${target.id}-${property}`, targetId: target.id, property, keyframes: [] },
          animTime,
          value,
        )];
      return { ...current, animation: { ...current.animation, tracks } };
    });
  };

  const updateRotation = (axis: 'x' | 'y' | 'z', value: number) => {
    setProject((current) => {
      const selectedDevice = getSelectedDevice(current);
      const rotation = { ...selectedDevice.rotation, [axis]: value };
      return syncProjectFromSelected({
        ...current,
        devices: current.devices.map((device) => (
          current.compositionMode === 'split' || device.id === selectedDevice.id
            ? { ...device, rotation: { ...rotation } }
            : device
        )),
      }, { ...selectedDevice, rotation });
    });
    if (timelineOpen) keyPropertyAtPlayhead(`rotation.${axis}` as AnimProperty, value);
  };

  const notify = (message: string) => {
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(null), 4300);
  };

  useEffect(() => () => {
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
  }, []);

  const applyScreenImage = (dataUrl: string, name: string, message = 'Screenshot added to your device') => {
    updateProject({ screenshot: dataUrl });
    if (!isPlaceholderScreenshot(dataUrl)) {
      setRecentScreenshots((current) => rememberRecentScreenshot(current, dataUrl, name));
    }
    notify(message);
  };

  const openSvgExplode = (svgText: string, fileName: string) => {
    try {
      const model = parseSvgDocument(svgText, fileName);
      if (!model.layers.length) {
        notify('SVG had no drawable layers');
        return;
      }
      setSvgExplodeModel(model);
      notify(`Loaded “${fileName}” — explode or pick a layer`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not open SVG');
    }
  };

  const importScreenMedia = async (file?: File) => {
    if (!file) return;
    if (isSvgFile(file)) {
      if (file.size > 8 * 1024 * 1024) {
        notify('Use an SVG under 8 MB.');
        return;
      }
      const text = await readFileAsText(file);
      openSvgExplode(text, file.name);
      return;
    }
    const asImage = isImageFile(file);
    const asVideo = isVideoFile(file);
    if (!asImage && !asVideo) {
      notify('Choose a PNG, JPG, WebP, SVG — or MP4 / WebM / MOV video.');
      return;
    }
    const maxBytes = asVideo ? 40 * 1024 * 1024 : 20 * 1024 * 1024;
    if (file.size > maxBytes) {
      notify(asVideo ? 'Use a video under 40 MB.' : 'Use an image under 20 MB.');
      return;
    }
    const url = await readFileAsDataUrl(file);
    if (asVideo) {
      updateProject({ screenshot: url });
      notify('Screen recording added to your device');
      return;
    }
    applyScreenImage(url, file.name);
  };

  const pasteScreenFromClipboard = async (event?: ClipboardEvent) => {
    try {
      const svgText = event ? readSvgTextFromPasteEvent(event) : null;
      if (svgText) {
        openSvgExplode(svgText, 'pasted.svg');
        return;
      }
      const fromEvent = event ? await readImageFromPasteEvent(event) : null;
      const image = fromEvent ?? await readImageFromClipboard();
      applyScreenImage(image.dataUrl, image.name, 'Pasted from clipboard onto the device');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Nothing to paste — copy a frame from Figma first');
    }
  };

  const applyRecentScreenshot = (shot: RecentScreenshot) => {
    updateProject({ screenshot: shot.dataUrl });
    setRecentScreenshots((current) => rememberRecentScreenshot(current, shot.dataUrl, shot.name));
    notify('Screenshot applied');
  };

  const stopMirroring = useCallback(() => {
    androidUnsubRef.current?.();
    androidUnsubRef.current = null;
    androidPlayerRef.current?.dispose();
    androidPlayerRef.current = null;
    void window.mockupDesktop?.androidStopMirror?.();
    stopPhoneMirror(mirrorStreamRef.current);
    mirrorStreamRef.current = null;
    setMirrorStream(null);
    setMirrorSource(null);
    setMirrorDevice(null);
    setAndroidMirrorLabel(null);
    setAndroidMirrorSerial(null);
  }, []);

  const androidReadyDevices = useMemo(
    () => androidDevices.filter((d) => d.state === 'device'),
    [androidDevices],
  );
  const androidPreferredReady = useMemo(
    () => androidReadyDevices.find((d) => d.preferred) ?? androidReadyDevices[0] ?? null,
    [androidReadyDevices],
  );
  const iosReady = mirrorDevices.length > 0;
  const androidReady = androidReadyDevices.length > 0;

  const connectIosMirror = async () => {
    const { stream, device } = await startPhoneMirror();
    mirrorStreamRef.current = stream;
    setMirrorStream(stream);
    setMirrorSource('ios');
    setMirrorDevice(device);
    setAndroidMirrorLabel(null);
    setAndroidMirrorSerial(null);
    stream.getVideoTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (mirrorStreamRef.current === stream) stopMirroring();
      });
    });
    notify(
      device.continuityLikely
        ? `Mirroring ${device.label} (looks like Continuity Camera — use USB for the phone screen)`
        : `Mirroring ${device.label}`,
    );
  };

  const connectAndroidMirror = async (serial?: string) => {
    if (!window.mockupDesktop?.androidStartMirror) {
      throw new Error('Android mirror requires the Mac desktop app with ADB.');
    }
    const player = new AndroidMirrorPlayer();
    androidPlayerRef.current = player;
    const unsubFrame = window.mockupDesktop.onAndroidMirrorFrame?.((frame) => {
      void player.pushFrame(frame).catch(() => { /* drop bad frame */ });
    });
    const unsubError = window.mockupDesktop.onAndroidMirrorError?.((payload) => {
      notify(payload.message || 'Android mirror failed');
      stopMirroring();
    });
    androidUnsubRef.current = () => {
      unsubFrame?.();
      unsubError?.();
    };

    const result = await window.mockupDesktop.androidStartMirror(serial);
    const stream = player.getMediaStream();
    mirrorStreamRef.current = stream;
    setMirrorStream(stream);
    setMirrorSource('android');
    setMirrorDevice(null);
    setAndroidMirrorLabel(result.device.label);
    setAndroidMirrorSerial(result.device.serial);
    notify(
      result.device.preferred
        ? `Mirroring ${result.device.label}`
        : `Mirroring ${result.device.label} (Pixel/Samsung preferred; other brands are experimental)`,
    );
  };

  /** Single Phone Mirror entry — auto-picks iOS or Android from what's plugged in. */
  const startPhoneMirroring = async () => {
    if (mirrorBusy) return;
    if (mirrorStream) {
      stopMirroring();
      notify('Mirror stopped');
      return;
    }

    const scenePlatform = getDevice(project.deviceId).platform;
    let target: 'ios' | 'android' | null = null;
    if (iosReady && !androidReady) target = 'ios';
    else if (androidReady && !iosReady) target = 'android';
    else if (iosReady && androidReady) target = scenePlatform === 'android' ? 'android' : 'ios';
    else if (!isDesktopApp() && iosReady) target = 'ios';
    else {
      // Re-probe once in case lists are stale, then decide.
      try {
        const [iosList, androidStatus] = await Promise.all([
          listMirrorDevices({ unlockLabels: true }),
          isAndroidMirrorAvailable() ? getAndroidMirrorStatus() : Promise.resolve(null),
        ]);
        const androidList = (androidStatus?.devices || []).filter((d) => d.state === 'device');
        if (iosList.length && !androidList.length) target = 'ios';
        else if (androidList.length && !iosList.length) target = 'android';
        else if (iosList.length && androidList.length) target = scenePlatform === 'android' ? 'android' : 'ios';
      } catch {
        /* fall through */
      }
    }

    if (!target) {
      notify(
        isDesktopApp()
          ? 'No phone found. Plug in an iPhone (USB + Trust) or Android (USB debugging + ADB), then try again.'
          : 'Phone Mirror works in the Mac app. Plug in an iPhone over USB, or use Android with ADB.',
      );
      return;
    }

    setMirrorBusy(true);
    try {
      stopMirroring();
      if (target === 'ios') await connectIosMirror();
      else await connectAndroidMirror(androidPreferredReady?.serial);
    } catch (err) {
      stopMirroring();
      notify(err instanceof Error ? err.message : 'Could not start phone mirror');
    } finally {
      setMirrorBusy(false);
    }
  };

  const mirrorStatusLabel = (() => {
    if (mirrorStream) {
      if (mirrorSource === 'android' && androidMirrorLabel) return `Live · ${androidMirrorLabel}`;
      if (mirrorSource === 'ios' && mirrorDevice) return `Live · ${mirrorDevice.label}`;
      return 'Live';
    }
    if (iosReady && androidReady) {
      const androidName = androidPreferredReady?.label || 'Android';
      return `Ready · ${mirrorDevices[0].label} · ${androidName}`;
    }
    if (iosReady) return `Ready · ${mirrorDevices[0].label}`;
    if (androidReady) return `Ready · ${androidPreferredReady!.label}`;
    if (androidDevices.some((d) => d.state === 'unauthorized')) return 'Android connected — allow USB debugging';
    if (androidAdbError && isDesktopApp()) return 'ADB missing for Android';
    return isDesktopApp() ? 'Plug in an iPhone or Android over USB' : 'Use the Mac app for USB mirror';
  })();

  const snapshotMirror = async () => {
    if (!mirrorStream || mirrorBusy) return;
    setMirrorBusy(true);
    try {
      let dataUrl: string;
      let name: string;
      if (mirrorSource === 'android') {
        if (!window.mockupDesktop?.androidSnapshot) {
          throw new Error('Android snapshot is unavailable');
        }
        const snap = await window.mockupDesktop.androidSnapshot(androidMirrorSerial || undefined);
        dataUrl = snap.dataUrl;
        name = androidMirrorLabel ? `${androidMirrorLabel} snapshot` : 'Android snapshot';
      } else {
        dataUrl = await snapshotMirrorStream(mirrorStream);
        name = mirrorDevice ? `${mirrorDevice.label} snapshot` : 'iPhone snapshot';
      }
      updateProject({ screenshot: dataUrl });
      setRecentScreenshots((current) => rememberRecentScreenshot(current, dataUrl, name));
      notify('Snapshot applied to the device screen');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Snapshot failed');
    } finally {
      setMirrorBusy(false);
    }
  };

  const keyCameraAtPlayhead = () => {
    const base = animatedCamera
      ?? defaultCameraPosition(project.cameraView, project.compositionMode === 'split');
    setTimelineOpen(true);
    updateProject({
      animation: {
        ...animation,
        tracks: (['camera.x', 'camera.y', 'camera.z'] as const).reduce((tracks, property) => {
          const existing = tracks.find((t) => t.targetId === CAMERA_TARGET_ID && t.property === property);
          const value = property === 'camera.x' ? base.x : property === 'camera.y' ? base.y : base.z;
          if (existing) {
            return tracks.map((t) => (t.id === existing.id ? upsertKeyframe(t, animTime, value) : t));
          }
          return [
            ...tracks,
            {
              id: `track-camera-${property}`,
              targetId: CAMERA_TARGET_ID,
              property,
              keyframes: upsertKeyframe(
                { id: 'tmp', targetId: CAMERA_TARGET_ID, property, keyframes: [] },
                animTime,
                value,
              ).keyframes,
            },
          ];
        }, animation.tracks),
      },
    });
    notify('Camera keyframed');
  };

  const applyMotionPreset = (presetId: string) => {
    const preset = getAnimationPreset(presetId);
    if (!preset) return;
    const selected = getSelectedDevice(project);
    const targets = project.compositionMode === 'split' ? project.devices : selected;
    const next = applyAnimationPreset(animation, targets, preset);
    updateProject({ animation: next });
    setAnimTime(0);
    setAnimPlaying(true);
    setTimelineOpen(true);
    notify(`${preset.label} motion applied`);
  };

  const onImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    void importScreenMedia(event.currentTarget.files?.[0]).catch((e: Error) => notify(e.message));
    event.currentTarget.value = '';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    void importScreenMedia(event.dataTransfer.files[0]).catch((e: Error) => notify(e.message));
  };

  const onSave = async () => {
    if (!hasOpenProject) return;
    try {
      const contents = JSON.stringify(project, null, 2);
      const fileName = safeFilename(project.name);
      if (window.mockupDesktop) {
        const result = await window.mockupDesktop.saveProject(contents, fileName);
        if (!result.canceled) {
          trackRecent(project);
          notify('Project saved successfully');
        }
      } else {
        downloadBlob(new Blob([contents], { type: 'application/json' }), `${fileName}.mockup.json`);
        trackRecent(project);
        notify('Project downloaded');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to save project');
    }
  };

  const applyProject = (data: string) => {
    const parsed = validateProject(JSON.parse(data) as unknown);
    const named = { ...parsed, name: uniqueProjectName(parsed.name || 'Opened project') };
    openProjectInTab(named, `Opened “${named.name}”`);
  };

  const onOpen = async () => {
    try {
      if (window.mockupDesktop) {
        const result = await window.mockupDesktop.openProject();
        if (!result.canceled && result.contents) applyProject(result.contents);
      } else projectInputRef.current?.click();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to open project');
    }
  };

  const onProjectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      if (file.size > 45_000_000) throw new Error('This project file is too large.');
      applyProject(await file.text());
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Invalid project');
    }
  };

  const primaryExportAspect = (
    previewFrame !== 'free' && exportAspectIds.includes(previewFrame)
      ? previewFrame
      : exportAspectIds[0]
  ) ?? 'tiktok';

  const resolveExportSize = (aspectId: ExportAspectId = primaryExportAspect) => {
    const resolutionId = exportAspectHasFixed(aspectId)
      ? 'native'
      : aspectId === 'custom'
        ? 'custom'
        : exportResolution === 'native'
          ? 'fhd'
          : exportResolution;
    return resolveExportDimensions(aspectId, resolutionId, customExportSize);
  };

  const availableResolutions = useMemo(() => {
    const flexible = exportAspectIds.some((id) => !exportAspectHasFixed(id) && id !== 'custom');
    const onlyCustom = exportAspectIds.length > 0 && exportAspectIds.every((id) => id === 'custom');
    const onlyFixed = exportAspectIds.length > 0 && exportAspectIds.every((id) => exportAspectHasFixed(id));
    if (onlyCustom) {
      return EXPORT_RESOLUTIONS.filter((item) => item.id === 'custom');
    }
    if (onlyFixed) {
      return EXPORT_RESOLUTIONS.filter((item) => item.id === 'native' || item.id === 'custom');
    }
    if (flexible) {
      return EXPORT_RESOLUTIONS.filter((item) => item.id !== 'native');
    }
    return EXPORT_RESOLUTIONS.filter((item) => item.id !== 'native');
  }, [exportAspectIds]);

  const previewAspect = previewFrame === 'free'
    ? null
    : EXPORT_ASPECTS.find((item) => item.id === previewFrame) ?? null;

  const aspectSlug = (aspectId: ExportAspectId) => {
    const aspect = EXPORT_ASPECTS.find((item) => item.id === aspectId);
    return (aspect?.shortLabel ?? aspectId).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  };

  const focusPlatformAspect = useCallback((id: ExportAspectId) => {
    const fixed = exportAspectFixedSize(id);
    if (fixed) {
      setPreviewFrame(id);
      setExportResolution('native');
      setCustomExportSize(fixed);
      return;
    }
    if (id === 'custom') {
      setPreviewFrame('free');
      setExportResolution('custom');
      return;
    }
    setPreviewFrame(id);
    setExportResolution((current) => (current === 'native' || current === 'custom' ? 'fhd' : current));
  }, []);

  const applyPlatformFrame = useCallback((id: ExportAspectId | 'free') => {
    if (id === 'free') {
      setPreviewFrame('free');
      return;
    }
    setExportAspectIds((current) => {
      if (id === 'custom') return ['custom'];
      if (current.includes(id)) return current;
      return [...current.filter((item) => item !== 'custom'), id];
    });
    focusPlatformAspect(id);
  }, [focusPlatformAspect]);

  const toggleExportAspect = useCallback((id: ExportAspectId) => {
    if (id === 'custom') {
      setExportAspectIds(['custom']);
      focusPlatformAspect(id);
      return;
    }
    const withoutCustom = exportAspectIds.filter((item) => item !== 'custom');
    if (withoutCustom.includes(id)) {
      const next = withoutCustom.filter((item) => item !== id);
      if (!next.length) {
        setExportAspectIds([id]);
        focusPlatformAspect(id);
        return;
      }
      setExportAspectIds(next);
      const fallback = (
        previewFrame !== 'free'
        && previewFrame !== 'custom'
        && next.includes(previewFrame)
          ? previewFrame
          : next[0]
      );
      focusPlatformAspect(fallback);
      return;
    }
    setExportAspectIds([...withoutCustom, id]);
    focusPlatformAspect(id);
  }, [exportAspectIds, focusPlatformAspect, previewFrame]);

  const saveCapture = async (url: string, fileName: string, extension: StillFormatId = 'png') => {
    if (window.mockupDesktop) {
      const result = await window.mockupDesktop.saveImage(url, fileName);
      return !result.canceled;
    }
    const image = await (await fetch(url)).blob();
    downloadBlob(image, `${fileName}.${extension}`);
    return true;
  };

  const blobToBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read export data'));
    reader.readAsDataURL(blob);
  });

  const saveMediaBlob = async (blob: Blob, fileName: string, extension: string, mimeType: string) => {
    if (window.mockupDesktop?.saveMedia) {
      const dataBase64 = await blobToBase64(blob);
      const result = await window.mockupDesktop.saveMedia(dataBase64, fileName, extension, mimeType);
      return !result.canceled;
    }
    downloadBlob(blob, `${fileName}.${extension}`);
    return true;
  };

  const waitFrames = (count = 2) => new Promise<void>((resolve) => {
    const step = (left: number) => {
      if (left <= 0) resolve();
      else requestAnimationFrame(() => step(left - 1));
    };
    step(count);
  });

  const stillDataUrlFromCanvas = (canvas: HTMLCanvasElement, format: StillFormatId) => {
    if (format === 'webp') {
      const url = canvas.toDataURL('image/webp', 0.92);
      if (url.startsWith('data:image/webp')) return url;
    }
    return canvas.toDataURL('image/png');
  };

  const captureStillCanvas = async (width: number, height: number, time: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create export canvas');
    captureRef.current!.drawFrame(width, height, ctx);
    await drawOverlays(ctx, project.overlays, width, height, time);
    return canvas;
  };

  const exportStillsAtSize = async (
    formats: StillFormatId[],
    width: number,
    height: number,
    scaleLabel: string,
    platformTag = '',
  ) => {
    if (!captureRef.current) throw new Error('The 3D preview is not ready yet');
    if (!formats.length) return;
    const scaleSuffix = scaleLabel === '1x' ? '' : `@${scaleLabel}`;
    const platformSuffix = platformTag ? `${platformTag}-` : '';
    const baseName = `${safeFilename(project.name)}-${platformSuffix}${width}x${height}${scaleSuffix}`;
    const labels = formats.map((format) => stillFormatById(format).label).join(' + ');

    if (project.compositionMode === 'split' && exportMode === 'separate') {
      const snapshot = project;
      const iosOnly = snapshot.devices.filter((d) => getDevice(d.deviceId).platform === 'ios').map((d) => ({ ...d, position: { x: 0, y: 0, z: 0 } }));
      const androidOnly = snapshot.devices.filter((d) => getDevice(d.deviceId).platform === 'android').map((d) => ({ ...d, position: { x: 0, y: 0, z: 0 } }));
      if (!iosOnly.length || !androidOnly.length) throw new Error('Split composition needs both iOS and Android devices.');

      setExportProgress(`Rendering iOS ${labels}…`);
      setProject({ ...snapshot, compositionMode: 'single', devices: iosOnly, selectedDeviceId: iosOnly[0].id, deviceId: iosOnly[0].deviceId });
      await waitFrames(3);
      const iosCanvas = await captureStillCanvas(width, height, animTime);
      for (const format of formats) {
        await saveCapture(stillDataUrlFromCanvas(iosCanvas, format), `${baseName}-ios`, format);
      }

      setExportProgress(`Rendering Android ${labels}…`);
      setProject({ ...snapshot, compositionMode: 'single', devices: androidOnly, selectedDeviceId: androidOnly[0].id, deviceId: androidOnly[0].deviceId });
      await waitFrames(3);
      const androidCanvas = await captureStillCanvas(width, height, animTime);
      for (const format of formats) {
        await saveCapture(stillDataUrlFromCanvas(androidCanvas, format), `${baseName}-android`, format);
      }

      setProject(snapshot);
      return;
    }

    setExportProgress(`Rendering ${platformTag ? `${platformTag} · ` : ''}${labels}${scaleLabel !== '1x' ? ` · ${scaleLabel}` : ''}…`);
    const canvas = await captureStillCanvas(width, height, animTime);
    const suffix = project.compositionMode === 'split' ? '-ios-android' : '';
    for (const format of formats) {
      await saveCapture(stillDataUrlFromCanvas(canvas, format), `${baseName}${suffix}`, format);
    }
  };

  const exportVideoAtSize = async (
    format: VideoFormatId,
    width: number,
    height: number,
    scaleLabel: string,
    platformTag = '',
  ) => {
    if (!captureRef.current) throw new Error('The 3D preview is not ready yet');
    if (!hasAnimation(animation) && !hasCameraAnimation(animation)) {
      throw new Error('Add animation keyframes before exporting video');
    }
    const formatInfo = videoFormatById(format);
    setExportProgress(`Preparing ${platformTag ? `${platformTag} · ` : ''}${formatInfo.label}${scaleLabel !== '1x' ? ` · ${scaleLabel}` : ''}…`);
    const blob = await encodeAnimationVideo({
      format,
      width,
      height,
      fps: animation.fps,
      duration: animation.duration,
      transparent: project.background === 'transparent',
      soundtrack: project.soundtrackData
        ? {
          dataUrl: project.soundtrackData,
          start: project.soundtrackStart,
          offset: project.soundtrackOffset,
          duration: project.soundtrackDuration,
          fadeIn: project.soundtrackFadeIn,
          fadeOut: project.soundtrackFadeOut,
        }
        : null,
      onProgress: (_ratio, label) => setExportProgress(`${formatInfo.label}: ${label}`),
      renderFrame: async (time, ctx, frameWidth, frameHeight) => {
        flushSync(() => setAnimTime(time));
        await seekAllScreenMedia(time);
        await waitFrames(2);
        captureRef.current?.drawFrame(frameWidth, frameHeight, ctx);
        await drawOverlays(ctx, project.overlays, frameWidth, frameHeight, time);
      },
    });
    const scaleSuffix = scaleLabel === '1x' ? '' : `@${scaleLabel}`;
    const platformSuffix = platformTag ? `${platformTag}-` : '';
    const baseName = `${safeFilename(project.name)}-${platformSuffix}${width}x${height}${scaleSuffix}`;
    await saveMediaBlob(blob, baseName, formatInfo.extension, formatInfo.mime);
  };

  const exportEntries = exportMediaMode === 'static' ? staticExportEntries : animatedExportEntries;
  const setExportEntries = exportMediaMode === 'static' ? setStaticExportEntries : setAnimatedExportEntries;
  const exportKinds = exportEntries.map((entry) => entry.kind);
  const selectedVideoFormats = Array.from(new Set(exportKinds.filter(isVideoExport)));
  const hasVideoExportSelected = exportMediaMode === 'animated';
  const hasStillExportSelected = exportMediaMode === 'static';
  const exportNeedsAnimation = hasVideoExportSelected
    && !hasAnimation(animation)
    && !hasCameraAnimation(animation);

  const availableVideoFormats = videoFormatsForAlpha(isTransparent);

  const nextExportKind = (): ExportKind => {
    const videoIds = new Set(availableVideoFormats.map((item) => item.id));
    const order = ALL_EXPORT_FORMATS
      .filter((item) => (
        exportMediaMode === 'static'
          ? item.group === 'still'
          : item.group === 'video' && videoAllowed && videoIds.has(item.id as VideoFormatId)
      ))
      .map((item) => item.id);
    const unused = order.find((kind) => !exportKinds.includes(kind));
    return unused ?? order[0] ?? (exportMediaMode === 'static' ? 'png' : (isTransparent ? 'webm' : 'mp4'));
  };

  const setExportMediaModeSafe = (mode: ExportMediaMode) => {
    if (mode === 'animated' && !videoAllowed) {
      notify(upgradeCopy('MP4 / GIF export'));
      setLicenseOpen(true);
      return;
    }
    setExportMediaMode(mode);
  };

  const addExportEntry = () => {
    if (exportMediaMode === 'animated' && !videoAllowed) {
      notify(upgradeCopy('MP4 / GIF export'));
      setLicenseOpen(true);
      return;
    }
    const kind = nextExportKind();
    setExportEntries((current) => [...current, createExportEntry(kind)]);
  };

  const updateExportEntry = (id: string, patch: Partial<Pick<ExportEntry, 'kind' | 'scale'>>) => {
    if (patch.kind) {
      if (exportMediaMode === 'static' && !isStillExport(patch.kind)) return;
      if (exportMediaMode === 'animated' && !isVideoExport(patch.kind)) return;
      if (isVideoExport(patch.kind) && isTransparent && patch.kind === 'mp4') {
        notify('MP4 cannot keep transparency. Use WebM or GIF.');
        return;
      }
      if (isVideoExport(patch.kind) && !videoAllowed) {
        notify(upgradeCopy('MP4 / GIF export'));
        setLicenseOpen(true);
        return;
      }
    }
    setExportEntries((current) => current.map((entry) => (
      entry.id === id ? { ...entry, ...patch } : entry
    )));
  };

  const removeExportEntry = (id: string) => {
    setExportEntries((current) => (
      current.length <= 1 ? current : current.filter((entry) => entry.id !== id)
    ));
  };

  const exportActionLabel = exporting
    ? (exportProgress || 'Rendering…')
    : `Export ${project.name || 'composition'}`;

  const runExport = async () => {
    if (!exportEntries.length) {
      notify('Add at least one export');
      return;
    }
    if (!exportAspectIds.length) {
      notify('Select at least one platform size');
      return;
    }
    if (hasVideoExportSelected && !videoAllowed) {
      notify(upgradeCopy('MP4 / GIF export'));
      setLicenseOpen(true);
      return;
    }
    const maxScale = Math.max(...exportEntries.map((entry) => entry.scale));
    const largestEdge = Math.max(...exportAspectIds.map((aspectId) => {
      const size = resolveExportSize(aspectId);
      const scaled = scaledExportDimensions(size.width, size.height, maxScale as ExportScale);
      return Math.max(scaled.width, scaled.height);
    }));
    if (!isResolutionAllowed(license.tier, largestEdge)) {
      notify(`Free exports up to Full HD. ${upgradeCopy('Higher resolutions')}`);
      setLicenseOpen(true);
      return;
    }
    if (exportNeedsAnimation) {
      notify('Add animation keyframes before exporting video');
      return;
    }

    const wasPlaying = animPlaying;
    setAnimPlaying(false);
    if (hasVideoExportSelected) setTimelineOpen(true);
    setExporting(true);
    try {
      const stillGroups = new Map<ExportScale, StillFormatId[]>();
      for (const entry of exportEntries) {
        if (!isStillExport(entry.kind)) continue;
        const list = stillGroups.get(entry.scale) ?? [];
        if (!list.includes(entry.kind)) list.push(entry.kind);
        stillGroups.set(entry.scale, list);
      }
      const multiPlatform = exportAspectIds.length > 1;
      for (const aspectId of exportAspectIds) {
        const baseSize = resolveExportSize(aspectId);
        const platformTag = multiPlatform ? aspectSlug(aspectId) : '';
        for (const [scale, formats] of stillGroups) {
          const size = scaledExportDimensions(baseSize.width, baseSize.height, scale);
          await exportStillsAtSize(formats, size.width, size.height, formatExportScale(scale), platformTag);
        }
        for (const entry of exportEntries) {
          if (!isVideoExport(entry.kind)) continue;
          const size = scaledExportDimensions(baseSize.width, baseSize.height, entry.scale);
          await exportVideoAtSize(entry.kind, size.width, size.height, formatExportScale(entry.scale), platformTag);
        }
      }
      setExportOpen(false);
      const formatLabels = exportEntries.map((entry) => {
        const format = isStillExport(entry.kind)
          ? stillFormatById(entry.kind).label
          : videoFormatById(entry.kind).label;
        return entry.scale === 1 ? format : `${format} ${formatExportScale(entry.scale)}`;
      });
      const withAudio = Boolean(project.soundtrackData) && selectedVideoFormats.includes('mp4');
      const sizeCount = exportAspectIds.length;
      if (sizeCount > 1) {
        notify(`Exported ${sizeCount} sizes · ${formatLabels.join(', ')}${withAudio ? ' · MP4 includes soundtrack' : ''}`);
      } else if (formatLabels.length === 1) {
        notify(withAudio ? `${formatLabels[0]} exported with soundtrack` : `${formatLabels[0]} exported`);
      } else {
        notify(`Exported ${formatLabels.join(', ')}${withAudio ? ' · MP4 includes soundtrack' : ''}`);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setExporting(false);
      setExportProgress(null);
      setAnimPlaying(wasPlaying);
    }
  };

  const enableSplitComposition = () => {
    if (license.tier === 'free') {
      notify(upgradeCopy('Multi-device / split compositions'));
      setLicenseOpen(true);
      return;
    }
    setProject((current) => {
      const selected = getSelectedDevice(current);
      const devices = buildSplitDevices(selected);
      return syncProjectFromSelected({
        ...current,
        compositionMode: 'split',
        devices,
        cameraView: 'front',
      }, devices[0]);
    });
    setDeviceMenu(null);
    notify('Split iOS + Android composition ready');
  };

  const enableSingleComposition = () => {
    setProject((current) => {
      const selected = getSelectedDevice(current);
      const single = createDeviceInstance({
        id: 'device-main',
        deviceId: selected.deviceId,
        rotation: { ...selected.rotation },
        scale: selected.scale,
        position: { x: 0, y: 0, z: 0 },
        glassReflection: selected.glassReflection,
      });
      return syncProjectFromSelected({
        ...current,
        compositionMode: 'single',
        devices: [single],
      }, single);
    });
    setDeviceMenu(null);
    notify('Single device composition');
  };

  const onSelectDevice = (payload: DeviceSelectPayload) => {
    setDeviceChosen(true);
    setProject((current) => {
      const selected = current.devices.find((d) => d.id === payload.id) ?? getSelectedDevice(current);
      return syncProjectFromSelected(current, selected);
    });
    setDeviceMenu({ id: payload.id, x: payload.clientX, y: payload.clientY });
  };

  const onRotateDevice = (id: string, rotation: Vec3, opts?: { recordKeys?: boolean }) => {
    const recordKeys = opts?.recordKeys !== false;
    const nextRotation = {
      x: Math.max(-180, Math.min(180, rotation.x)),
      y: Math.max(-180, Math.min(180, rotation.y)),
      z: Math.max(-180, Math.min(180, rotation.z)),
    };
    setProject((current) => {
      const selectedDevice = current.devices.find((d) => d.id === id) ?? getSelectedDevice(current);
      const devices = current.devices.map((device) => (
        current.compositionMode === 'split' || device.id === id
          ? { ...device, rotation: { ...nextRotation } }
          : device
      ));
      const nextSelected = devices.find((d) => d.id === selectedDevice.id) ?? devices[0];
      let next = syncProjectFromSelected({ ...current, devices }, nextSelected);
      if (timelineOpen && recordKeys) {
        let tracks = next.animation.tracks;
        (['rotation.x', 'rotation.y', 'rotation.z'] as const).forEach((property) => {
          const axis = property.split('.')[1] as 'x' | 'y' | 'z';
          const existing = tracks.find((t) => t.targetId === id && t.property === property);
          const base = existing ?? { id: `track-${id}-${property}`, targetId: id, property, keyframes: [] };
          const updated = upsertKeyframe(base, animTime, nextRotation[axis]);
          tracks = existing
            ? tracks.map((t) => (t.id === existing.id ? updated : t))
            : [...tracks, updated];
        });
        next = { ...next, animation: { ...next.animation, tracks } };
      }
      return next;
    });
  };

  const onMoveDevice = (id: string, position: Vec3, opts?: { recordKeys?: boolean }) => {
    const recordKeys = opts?.recordKeys !== false;
    const nextPosition = {
      x: Math.max(-10, Math.min(10, position.x)),
      y: Math.max(-6, Math.min(6, position.y)),
      z: Math.max(-8, Math.min(8, position.z)),
    };
    setProject((current) => {
      const devices = current.devices.map((device) => (
        device.id === id ? { ...device, position: { ...nextPosition } } : device
      ));
      const nextSelected = devices.find((d) => d.id === id) ?? devices[0];
      if (!nextSelected) return current;
      let next = syncProjectFromSelected({ ...current, devices }, nextSelected);
      // Keys only on commit — mid-drag writes caused an animation feedback loop.
      if (timelineOpen && recordKeys) {
        let tracks = next.animation.tracks;
        (['position.x', 'position.y', 'position.z'] as const).forEach((property) => {
          const axis = property.split('.')[1] as 'x' | 'y' | 'z';
          const existing = tracks.find((t) => t.targetId === id && t.property === property);
          const base = existing ?? { id: `track-${id}-${property}`, targetId: id, property, keyframes: [] };
          const updated = upsertKeyframe(base, animTime, nextPosition[axis]);
          tracks = existing
            ? tracks.map((t) => (t.id === existing.id ? updated : t))
            : [...tracks, updated];
        });
        next = { ...next, animation: { ...next.animation, tracks } };
      }
      return next;
    });
  };

  const duplicateSelectedDevice = () => {
    let message = 'Device duplicated';
    setProject((current) => {
      if (current.compositionMode === 'split') {
        message = 'Switch to single mode to duplicate freely';
        return current;
      }
      if (current.devices.length >= entitlementsMaxDevices) {
        message = license.tier === 'free'
          ? upgradeCopy('Multi-device scenes')
          : `You can place up to ${entitlementsMaxDevices} devices`;
        return current;
      }
      if (current.devices.length >= MAX_DEVICES) {
        message = `You can place up to ${MAX_DEVICES} devices`;
        return current;
      }
      const selected = getSelectedDevice(current);
      const copy = createDeviceInstance({
        deviceId: selected.deviceId,
        rotation: { ...selected.rotation, y: selected.rotation.y + 18 },
        scale: selected.scale,
        position: { x: selected.position.x + 1.15, y: selected.position.y, z: selected.position.z },
        glassReflection: selected.glassReflection,
      });
      return syncProjectFromSelected({ ...current, devices: [...current.devices, copy] }, copy);
    });
    setDeviceMenu(null);
    if (message.includes('Pro')) setLicenseOpen(true);
    notify(message);
  };

  const rotateSelectedDevice = () => {
    setProject((current) => {
      const selected = getSelectedDevice(current);
      const rotation = { ...selected.rotation, y: ((selected.rotation.y + 45 + 180) % 360) - 180 };
      const devices = current.devices.map((device) => (
        current.compositionMode === 'split' || device.id === selected.id
          ? { ...device, rotation: { ...rotation } }
          : device
      ));
      return syncProjectFromSelected({ ...current, devices }, { ...selected, rotation });
    });
    notify('Rotated 45°');
  };

  const deleteSelectedDevice = () => {
    setProject((current) => {
      if (current.compositionMode === 'split' || current.devices.length <= 1) {
        notify('Keep at least one device in the scene');
        return current;
      }
      const remaining = current.devices.filter((d) => d.id !== current.selectedDeviceId);
      return syncProjectFromSelected({ ...current, devices: remaining }, remaining[0]);
    });
    setDeviceMenu(null);
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (event.code === 'Space' || event.key === ' ') {
        if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
        event.preventDefault();
        setTimelineOpen(true);
        setAnimPlaying((playing) => {
          if (playing) return false;
          setAnimTime((time) => (time >= animation.duration - 0.001 ? 0 : time));
          return true;
        });
        return;
      }

      if ((event.key === '.' || event.code === 'Period') && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (typing) return;
        event.preventDefault();
        setSidePanelsHidden((hidden) => {
          const nextHidden = !hidden;
          if (nextHidden) {
            timelineBeforeHideRef.current = timelineOpen;
            if (timelineOpen) {
              setAnimPlaying(false);
              setTimelineOpen(false);
            }
          } else if (timelineBeforeHideRef.current) {
            setTimelineOpen(true);
          }
          return nextHidden;
        });
        return;
      }

      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') { event.preventDefault(); void onSave(); }
      if (key === 'o') { event.preventDefault(); void onOpen(); }
      if (key === 'e') { event.preventDefault(); setExportOpen(true); }
      if (key === 't') {
        event.preventDefault();
        if (workspace.tabs.length < MAX_PROJECT_TABS) setTemplatePickerOpen(true);
      }
      if (key === 'w' && workspace.activeId) {
        event.preventDefault();
        closeTab(workspace.activeId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  useEffect(() => {
    if (!hasOpenProject) return;
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      const svgText = readSvgTextFromPasteEvent(event);
      const items = event.clipboardData?.items;
      const hasImage = items
        ? Array.from(items).some((item) => (
          item.type.startsWith('image/')
          || item.type === 'image/svg+xml'
          || (item.kind === 'file' && (item.type.startsWith('image/') || item.type === 'image/svg+xml'))
        ))
        : Boolean(event.clipboardData?.files?.length);
      if (!svgText && !hasImage) return;
      event.preventDefault();
      void pasteScreenFromClipboard(event);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const chooseScene = (scene: ScenePreset) => {
    updateProject({
      background: scene.id as BackgroundPreset,
      gradientColors: scene.gradient ? { ...scene.gradient } : { ...project.gradientColors },
    });
  };

  const updateGradient = (key: keyof GradientColors, value: string) => {
    const trimmed = value.trim();
    const candidate = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(candidate)) return;
    const hex = candidate.toLowerCase();
    if (hex === project.gradientColors[key]) return;
    const next = { ...project.gradientColors, [key]: hex };
    const keepsBuiltin = BACKGROUNDS.some((item) => item.id === project.background && item.gradient
      && item.gradient.center === next.center && item.gradient.mid === next.mid && item.gradient.edge === next.edge);
    const keepsCustom = customPresets.some((item) => item.id === project.background && item.gradient
      && item.gradient.center === next.center && item.gradient.mid === next.mid && item.gradient.edge === next.edge);
    updateProject({
      gradientColors: next,
      background: keepsBuiltin || keepsCustom || project.background === 'transparent'
        ? project.background
        : 'custom',
    });
  };

  const onSavePreset = () => {
    if (isTransparent) {
      notify('Switch to a coloured background before saving a preset');
      return;
    }
    const name = presetName.trim() || `Custom ${customPresets.length + 1}`;
    const preset = saveCustomScenePreset(name, project.gradientColors);
    setCustomPresets(loadCustomScenePresets());
    updateProject({ background: preset.id, gradientColors: { ...preset.gradient! } });
    setPresetName('');
    setSavingPreset(false);
    setLeftTab('scenes');
    notify(`Saved “${preset.label}” preset`);
  };

  const onDeletePreset = (id: string) => {
    const next = deleteCustomScenePreset(id);
    setCustomPresets(next);
    if (project.background === id) {
      updateProject({ background: 'custom' });
    }
    notify('Custom preset removed');
  };

  const resetDevice = () => {
    setProject((current) => {
      const selected = getSelectedDevice(current);
      const rotation = { ...DEFAULT_PROJECT.rotation };
      const devices = current.devices.map((device) => (
        current.compositionMode === 'split' || device.id === selected.id
          ? { ...device, rotation: { ...rotation }, scale: 1, position: current.compositionMode === 'split' ? device.position : { x: 0, y: 0, z: 0 } }
          : device
      ));
      const nextSelected = devices.find((d) => d.id === selected.id) ?? devices[0];
      return syncProjectFromSelected({ ...current, devices, cameraView: 'front' }, nextSelected);
    });
    notify('Camera and device position reset');
  };

  return (
    <div className={`app-shell ${hasOpenProject ? 'has-project' : ''}`}>
      <header className="topbar">
        <div className="brand-area" title="Mockup Studio">
          <div className="brand-mark" aria-label="Mockup Studio">
            <svg viewBox="0 0 36 36" width="18" height="18" fill="none" aria-hidden>
              <rect x="6.5" y="8" width="14" height="20" rx="3" transform="rotate(-12 13.5 18)" stroke="currentColor" strokeWidth="1.75" opacity="0.45" />
              <rect x="11" y="7" width="14" height="22" rx="3.2" stroke="currentColor" strokeWidth="1.75" opacity="0.72" />
              <rect x="15.5" y="8.5" width="13.5" height="19" rx="3" transform="rotate(10 22.25 18)" fill="currentColor" />
            </svg>
          </div>
        </div>
        <div className="document-area">
          <div className="project-tabs" role="tablist" aria-label="Open projects">
            {workspace.tabs.map((tab) => {
              const active = tab.id === workspace.activeId;
              const renaming = renamingTabId === tab.id;
              return (
                <div key={tab.id} className={`project-tab ${active ? 'active' : ''} ${renaming ? 'is-renaming' : ''}`} role="presentation">
                  {renaming ? (
                    <div className="project-tab-rename">
                      <Layers3 size={13} />
                      <input
                        ref={renameInputRef}
                        className="project-tab-rename-input"
                        aria-label="Rename project"
                        value={renameDraft}
                        maxLength={100}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={commitRenameTab}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitRenameTab();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            cancelRenameTab();
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className="project-tab-button"
                      title={`${tab.project.name} — tap again to rename`}
                      onClick={() => {
                        if (active) beginRenameTab(tab.id, tab.project.name);
                        else switchTab(tab.id);
                      }}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        beginRenameTab(tab.id, tab.project.name);
                      }}
                    >
                      <Layers3 size={13} />
                      <span>{tabLabel(tab.project)}</span>
                    </button>
                  )}
                  {!renaming && (
                    <button
                      type="button"
                      className="project-tab-close"
                      title={workspace.tabs.length <= 1 ? 'Close and go to recent projects' : 'Close tab'}
                      aria-label={`Close ${tab.project.name}`}
                      onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </header>

      {!hasOpenProject ? (
        <main className="recent-home">
          <div className="recent-home-inner">
            <div className="recent-home-hero">
              <div className="recent-home-mark"><Clock3 size={22} /></div>
              <h1>Recent projects</h1>
              <p>Close a tab anytime to return here. Open a recent composition, start from a template, or open a file.</p>
              <div className="recent-home-actions">
                <button type="button" className="button primary-button" onClick={() => setTemplatePickerOpen(true)}>
                  <LayoutTemplate size={16} /> New from template
                </button>
                <button type="button" className="button subtle-button" onClick={() => void onOpen()}>
                  <FolderOpen size={16} /> Open file
                </button>
              </div>
            </div>

            <div className="recent-grid">
              {recentProjects.map((entry) => {
                const device = getDevice(entry.deviceId);
                return (
                  <div key={entry.id} className="recent-card">
                    <button
                      type="button"
                      className="recent-card-main"
                      onClick={() => openRecentProject(entry)}
                      title={`Open ${entry.name}`}
                    >
                      <div className="recent-thumb">
                        {entry.preview ? (
                          <img src={entry.preview} alt="" />
                        ) : (
                          <div className="recent-thumb-fallback"><Smartphone size={28} /></div>
                        )}
                      </div>
                      <div className="recent-card-body">
                        <strong>{entry.name}</strong>
                        <span>{device.label} · {entry.deviceCount > 1 ? `${entry.deviceCount} devices` : '1 device'}</span>
                        <em>{formatRecentTime(entry.updatedAt)}</em>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="recent-card-remove"
                      title="Remove from recent"
                      aria-label={`Remove ${entry.name} from recent`}
                      onClick={() => setRecentProjects(removeRecentProject(entry.id))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                className="recent-card recent-card-new"
                onClick={() => setTemplatePickerOpen(true)}
                title="Create a new project from a template"
              >
                <span className="recent-new-icon" aria-hidden>
                  <Plus size={26} strokeWidth={2.2} />
                </span>
                <strong>New project</strong>
              </button>
            </div>
          </div>
        </main>
      ) : (
      <div className={`workspace ${sidePanelsHidden ? 'panels-hidden' : ''}`}>
        <aside className="left-panel" aria-hidden={sidePanelsHidden}>
          <div className="panel-title-row">
            <h2>Workspace</h2>
            <button
              className="icon-button"
              title="New project from template"
              aria-label="New project from template"
              onClick={() => setTemplatePickerOpen(true)}
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="panel-tabs">
            <button className={leftTab === 'scenes' ? 'panel-tab selected' : 'panel-tab'} onClick={() => setLeftTab('scenes')}>
              <LayoutTemplate size={15} /> Scenes
            </button>
            <button className={leftTab === 'assets' ? 'panel-tab selected' : 'panel-tab'} onClick={() => setLeftTab('assets')}>
              <FileImage size={15} /> Assets
            </button>
          </div>
          <div className="left-scroll">
            {leftTab === 'scenes' ? (
              <>
                <div className="field-caption section-label">Scenes <span>{allScenes.length}</span></div>
                <div className="scene-grid">
                  {allScenes.map((item) => (
                    <div key={item.id} className={`scene-card-wrap ${project.background === item.id ? 'active' : ''}`}>
                      <button type="button" className={`scene-card ${project.background === item.id ? 'active' : ''}`}
                        onClick={() => chooseScene(item)} title={BUILTIN_SCENE_HINTS[item.id] ?? item.description}>
                        <div className={`scene-thumb ${BACKGROUNDS.some((b) => b.id === item.id) ? `bg-${item.id}` : ''}`} style={sceneThumbStyle(item)}>
                          <div className="scene-mini-device"><span /></div>
                          {project.background === item.id && <span className="scene-check"><Check size={12} strokeWidth={3} /></span>}
                        </div>
                        <strong>{item.label}</strong>
                      </button>
                      {item.id.startsWith('custom-') && (
                        <button type="button" className="scene-delete" title="Delete preset" aria-label={`Delete ${item.label}`}
                          onClick={() => onDeletePreset(item.id)}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                  {project.background === 'custom' && (
                    <button type="button" className="scene-card active" onClick={() => undefined} title="Edited colours">
                      <div className="scene-thumb" style={{ background: gradientCss(project.gradientColors) }}>
                        <div className="scene-mini-device"><span /></div>
                        <span className="scene-check"><Check size={12} strokeWidth={3} /></span>
                      </div>
                      <strong>Custom</strong>
                    </button>
                  )}
                </div>

                <div className="field-caption section-label aspect-sidebar-label">
                  Aspect ratio
                  <span>
                    {exportAspectIds.length > 1
                      ? `${exportAspectIds.length} sizes`
                      : previewAspect
                        ? previewAspect.hint
                        : 'Free'}
                  </span>
                </div>
                <p className="aspect-sidebar-hint">Select multiple to export together</p>
                <div className="aspect-sidebar-grid" role="group" aria-label="Platform aspect ratio">
                  <button
                    type="button"
                    className={`aspect-sidebar-chip ${previewFrame === 'free' ? 'is-preview' : ''}`}
                    title="Hide crop overlay"
                    onClick={() => applyPlatformFrame('free')}
                  >
                    <div className="aspect-sidebar-ratio aspect-sidebar-ratio-free" />
                    <strong>Free</strong>
                    <span>No crop</span>
                  </button>
                  {EXPORT_ASPECTS.filter((item) => item.id !== 'custom').map((item) => {
                    const selected = exportAspectIds.includes(item.id);
                    const previewing = previewFrame === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`aspect-sidebar-chip ${selected ? 'selected' : ''} ${previewing ? 'is-preview' : ''}`}
                        title={`${item.label} · ${item.hint}${selected ? ' · queued for export' : ''}`}
                        onClick={() => toggleExportAspect(item.id)}
                      >
                        <div className="aspect-sidebar-ratio" style={exportRatioThumbStyle(item.ratio, 18)} />
                        <strong>{item.shortLabel}</strong>
                        <span>{item.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="assets-stack">
                  <section className="assets-block" aria-label="Import">
                    <div className="field-caption section-label assets-section-label">
                      Import
                      <span>{screenSizeLabel(getDevice(project.deviceId).screenSize)}</span>
                    </div>
                    <button
                      type="button"
                      className="upload-zone upload-zone-compact"
                      onClick={() => imageInputRef.current?.click()}
                      title={`Import screenshot or video for ${getDevice(project.deviceId).label}`}
                    >
                      <ImagePlus size={18} strokeWidth={1.6} />
                      <div className="upload-zone-copy">
                        <strong>Screenshot or video</strong>
                        <span>PNG, JPG, WebP, SVG, MP4 · drop or browse</span>
                      </div>
                    </button>
                    <div className="assets-secondary-row">
                      <button
                        type="button"
                        className="assets-secondary-btn"
                        onClick={() => svgInputRef.current?.click()}
                        title="Import SVG and keep groups as layers for explode view"
                      >
                        <FileCode2 size={13} strokeWidth={1.7} />
                        SVG layers
                      </button>
                      <button
                        type="button"
                        className="assets-secondary-btn"
                        onClick={() => void pasteScreenFromClipboard()}
                        title="Paste PNG or SVG from clipboard"
                      >
                        ⌘V Paste
                      </button>
                      <button
                        type="button"
                        className="assets-secondary-btn"
                        onClick={() => setFigmaExploreOpen(true)}
                        title="Open a Figma file link with a personal access token"
                      >
                        Figma
                      </button>
                    </div>
                  </section>

                  <section className="assets-block" aria-label="Phone Mirror">
                    <div className="field-caption section-label assets-section-label">Phone Mirror</div>
                    <div className={`phone-mirror-card ${mirrorStream ? 'is-live' : ''}`}>
                      <div className="phone-mirror-meta">
                        <strong>
                          <MonitorSmartphone size={14} strokeWidth={1.7} />
                          {mirrorStream
                            ? (mirrorSource === 'android' ? 'Android' : 'iPhone')
                            : 'Auto-detect'}
                        </strong>
                        <span title={mirrorStatusLabel}>{mirrorStatusLabel}</span>
                      </div>
                      <div className="phone-mirror-actions">
                        <button
                          type="button"
                          className={`button ${mirrorStream ? 'mirror-active' : 'secondary-button'}`}
                          disabled={mirrorBusy}
                          onClick={() => void startPhoneMirroring()}
                          title={mirrorStream ? 'Stop phone mirror' : 'Mirror the connected iPhone or Android over USB'}
                        >
                          {mirrorBusy ? 'Connecting…' : mirrorStream ? 'Stop' : 'Phone Mirror'}
                        </button>
                        <button
                          type="button"
                          className="button secondary-button"
                          disabled={!mirrorStream || mirrorBusy}
                          onClick={() => void snapshotMirror()}
                          title="Snapshot the live phone screen onto the mockup"
                        >
                          <Camera size={13} />
                          Snapshot
                        </button>
                      </div>
                    </div>
                  </section>

                  {project.screenshot && (
                    <section className="assets-block" aria-label="Current screen">
                      <div className="asset-card asset-card-compact">
                        <div className="asset-preview"><img src={project.screenshot} alt="Uploaded screen" /></div>
                        <div>
                          <strong>{isPlaceholderScreenshot(project.screenshot) ? 'Size guide' : 'Current screen'}</strong>
                          <span>{screenSizeLabel(getDevice(project.deviceId).screenSize)} px</span>
                        </div>
                        <button title="Replace screenshot" aria-label="Replace screenshot" onClick={() => imageInputRef.current?.click()}><ArrowLeftRight size={15} /></button>
                      </div>
                    </section>
                  )}

                  {recentScreenshots.length > 0 && (
                    <section className="assets-block" aria-label="Recent screenshots">
                      <div className="field-caption section-label assets-section-label">
                        Recent
                        <span>{recentScreenshots.length}</span>
                      </div>
                      <div className="recent-shot-row" role="list">
                        {recentScreenshots.map((shot) => (
                          <button
                            key={shot.id}
                            type="button"
                            role="listitem"
                            className={`recent-shot ${project.screenshot === shot.dataUrl ? 'is-active' : ''}`}
                            title={`Apply ${shot.name}`}
                            aria-label={`Apply ${shot.name}`}
                            onClick={() => applyRecentScreenshot(shot)}
                          >
                            <img src={shot.dataUrl} alt="" />
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="left-panel-footer">
            <button
              type="button"
              className="left-panel-settings"
              title={`License · ${planLabel(license.tier)} · Pro ${formatGbp(PLAN_PRICES_GBP.pro)}`}
              aria-label="License and plans"
              onClick={() => setLicenseOpen(true)}
            >
              <KeyRound size={15} strokeWidth={1.9} />
              <span>{planLabel(license.tier)}</span>
            </button>
            <button
              type="button"
              className="left-panel-settings"
              title="Settings & shortcuts"
              aria-label="Settings & shortcuts"
              onClick={() => setHelpOpen(true)}
            >
              <Settings2 size={15} strokeWidth={1.9} />
              <span>Settings</span>
            </button>
          </div>
        </aside>

        <main className="canvas-panel" onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }} onDrop={onDrop}>
          <div className={`canvas-stage ${sidePanelsHidden ? 'chrome-hidden' : timelineOpen ? 'with-timeline' : ''}`}>
            <div className="canvas-top-right">
              {mirrorStream ? (
                <div className="mirror-live-chip" role="status">
                  <span className="mirror-live-dot" aria-hidden />
                  {mirrorSource === 'android' ? 'Android' : 'iPhone'}
                  {' · '}
                  {mirrorSource === 'android'
                    ? (androidMirrorLabel || 'device')
                    : (mirrorDevice?.label || 'device')}
                  <button type="button" disabled={mirrorBusy} onClick={() => void snapshotMirror()}>
                    <Camera size={12} /> Snapshot
                  </button>
                  <button type="button" className="mirror-stop" disabled={mirrorBusy} onClick={() => { stopMirroring(); notify('Mirror stopped'); }}>
                    Stop
                  </button>
                </div>
              ) : (
                <p className="canvas-usage-hint">
                  Hold <kbd>Space</kbd> + drag to pan · Drag the gimbal to rotate
                </p>
              )}
            </div>
            <div className={`canvas-render ${project.background === 'transparent' ? 'transparent-grid' : ''}`}>
              <DeviceCanvas
                project={displayProject}
                captureRef={captureRef}
                mediaPlaying={animPlaying}
                liveStream={mirrorStream}
                cameraPosition={animatedCamera}
                onSelectDevice={onSelectDevice}
                onClearSelection={() => setDeviceMenu(null)}
                onRotateDevice={onRotateDevice}
                onMoveDevice={onMoveDevice}
                onGizmoDraggingChange={setGizmoDragging}
              />
              <ProgressiveBlurOverlay
                top={displayProject.edgeBlurTop ?? false}
                bottom={displayProject.edgeBlurBottom ?? false}
                amount={displayProject.edgeBlurAmount ?? DEFAULT_PROJECT.edgeBlurAmount}
                bottomClearance={
                  sidePanelsHidden
                    ? 'none'
                    : timelineOpen
                      ? 'open'
                      : 'collapsed'
                }
              />
              {(project.overlays ?? []).map((overlay) => (
                overlayVisibleAt(overlay, animTime) ? (
                  <div
                    key={overlay.id}
                    className={`canvas-overlay-layer ${selectedOverlayId === overlay.id ? 'is-selected' : ''} ${overlay.kind === 'text' ? 'is-text' : ''}`}
                    style={{
                      left: `${overlay.x * 100}%`,
                      top: `${overlay.y * 100}%`,
                      opacity: overlay.opacity,
                      transform: `translate(-50%, -50%) scale(${overlay.scale})`,
                      color: overlay.color || '#fff',
                      fontSize: `${Math.max(14, (overlay.fontSize ?? 0.055) * 420)}px`,
                    }}
                    onPointerDown={(e) => onOverlayPointerDown(e, overlay.id)}
                    onPointerMove={onOverlayPointerMove}
                    onPointerUp={onOverlayPointerUp}
                    onPointerCancel={onOverlayPointerUp}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedOverlayId(overlay.id);
                      setOpenSectionId('overlays');
                    }}
                  >
                    {overlay.kind === 'text' ? overlay.text : null}
                    {overlay.kind === 'image' && overlay.imageData ? (
                      <img src={overlay.imageData} alt="" draggable={false} />
                    ) : null}
                  </div>
                ) : null
              ))}
            </div>
            {previewAspect && (
              <CropFocusOverlay
                ratio={previewAspect.ratio}
                label={previewAspect.label}
                hint={previewAspect.hint}
              />
            )}
            {project.compositionMode === 'split' && (
              <div className="split-labels">
                <span>iOS</span>
                <span>Android</span>
              </div>
            )}
            {deviceMenu && (
              <div className="device-action-menu" style={{ left: Math.min(deviceMenu.x, window.innerWidth - 240), top: Math.min(deviceMenu.y, window.innerHeight - 200) }}>
                <div className="device-action-hint">
                  Drag rings to rotate · arrows move left / right / up / down
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDeviceMenu(null);
                    setLeftTab('assets');
                    imageInputRef.current?.click();
                  }}
                >
                  <ImagePlus size={14} /> Replace screenshot
                </button>
                <button
                  type="button"
                  disabled={mirrorBusy}
                  onClick={() => {
                    setDeviceMenu(null);
                    setLeftTab('assets');
                    void startPhoneMirroring();
                  }}
                >
                  <MonitorSmartphone size={14} /> {mirrorStream ? 'Stop Phone Mirror' : 'Phone Mirror'}
                </button>
                {mirrorStream && (
                  <button
                    type="button"
                    disabled={mirrorBusy}
                    onClick={() => {
                      setDeviceMenu(null);
                      void snapshotMirror();
                    }}
                  >
                    <Camera size={14} /> Snapshot
                  </button>
                )}
                <button type="button" onClick={duplicateSelectedDevice}><Copy size={14} /> Duplicate</button>
                <button type="button" onClick={rotateSelectedDevice}><Rotate3D size={14} /> Snap +45°</button>
                <button type="button" className="danger" onClick={deleteSelectedDevice} disabled={project.compositionMode === 'split' || project.devices.length <= 1}><Trash2 size={14} /> Remove</button>
                <div className="device-action-meta">Ideal size {screenSizeLabel(getDevice(project.deviceId).screenSize)}</div>
              </div>
            )}
            {dragOver && (
              <div className="drag-overlay">
                <Upload size={37} />
                <b>Drop screenshot to replace</b>
                <span>Image or video · {screenSizeLabel(getDevice(project.deviceId).screenSize)}</span>
              </div>
            )}
            <div className="canvas-watermark"><Aperture size={16} /> Mockup Studio</div>
          </div>
          {!sidePanelsHidden && (
            <div className={`workspace-bottom-chrome ${timelineOpen ? 'is-raised' : ''}`}>
              <nav className="workspace-mode-dock" aria-label="Workspace mode">
                <div className="workspace-mode-dock-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={!timelineOpen}
                    className={!timelineOpen ? 'is-active' : ''}
                    onClick={() => { if (timelineOpen) toggleTimeline(); }}
                  >
                    Composition
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={timelineOpen}
                    className={timelineOpen ? 'is-active' : ''}
                    onClick={() => { if (!timelineOpen) toggleTimeline(); }}
                  >
                    Animate
                  </button>
                </div>
              </nav>
              <div className="view-buttons" role="group" aria-label="Camera views">
                <button type="button" onClick={() => updateProject({ cameraView: 'front' })} className={project.cameraView === 'front' ? 'active' : ''}>Front</button>
                <button type="button" onClick={() => updateProject({ cameraView: 'left' })} className={project.cameraView === 'left' ? 'active' : ''}>Left</button>
                <button type="button" onClick={() => updateProject({ cameraView: 'right' })} className={project.cameraView === 'right' ? 'active' : ''}>Right</button>
                <button type="button" onClick={() => updateProject({ cameraView: 'top' })} className={project.cameraView === 'top' ? 'active' : ''}>Top</button>
                <span className="view-buttons-divider" aria-hidden />
                <button
                  type="button"
                  className={`view-mirror-btn ${mirrorStream ? 'active' : ''}`}
                  title={mirrorStream ? 'Stop phone mirror' : 'Phone Mirror — auto-detect iPhone or Android'}
                  aria-label={mirrorStream ? 'Stop phone mirror' : 'Phone Mirror'}
                  disabled={mirrorBusy}
                  onClick={() => void startPhoneMirroring()}
                >
                  <MonitorSmartphone size={14} />
                </button>
                {mirrorStream && (
                  <button
                    type="button"
                    className="view-mirror-btn"
                    title="Snapshot phone screen"
                    aria-label="Snapshot phone screen"
                    disabled={mirrorBusy}
                    onClick={() => void snapshotMirror()}
                  >
                    <Camera size={14} />
                  </button>
                )}
                <button
                  type="button"
                  className="view-reset-btn"
                  title="Reset camera and rotation"
                  aria-label="Reset camera"
                  onClick={resetDevice}
                >
                  <RotateCcw size={14} />
                </button>
              </div>
            </div>
          )}
          <AnimationTimeline
            open={timelineOpen}
            chromeHidden={sidePanelsHidden}
            onToggle={toggleTimeline}
            clip={animation}
            onChange={(next) => updateProject({ animation: next })}
            currentTime={animTime}
            onSeek={setAnimTime}
            playing={animPlaying}
            onPlayingChange={setAnimPlaying}
            selectedDevice={displaySelected}
            devices={project.devices}
            soundtrackName={project.soundtrackName ?? null}
            soundtrackData={project.soundtrackData ?? null}
            soundtrackStart={project.soundtrackStart ?? DEFAULT_PROJECT.soundtrackStart}
            soundtrackOffset={project.soundtrackOffset ?? DEFAULT_PROJECT.soundtrackOffset}
            soundtrackDuration={project.soundtrackDuration ?? project.animation.duration}
            soundtrackFadeIn={project.soundtrackFadeIn ?? DEFAULT_PROJECT.soundtrackFadeIn}
            soundtrackFadeOut={project.soundtrackFadeOut ?? DEFAULT_PROJECT.soundtrackFadeOut}
            onSoundtrackChange={(next) => updateProject(next
              ? {
                soundtrackName: next.name,
                soundtrackData: next.dataUrl,
                soundtrackStart: 0,
                soundtrackOffset: 0,
                soundtrackDuration: project.animation.duration,
                soundtrackFadeIn: DEFAULT_PROJECT.soundtrackFadeIn,
                soundtrackFadeOut: DEFAULT_PROJECT.soundtrackFadeOut,
              }
              : {
                soundtrackName: null,
                soundtrackData: null,
                soundtrackStart: DEFAULT_PROJECT.soundtrackStart,
                soundtrackOffset: DEFAULT_PROJECT.soundtrackOffset,
                soundtrackDuration: DEFAULT_PROJECT.soundtrackDuration,
                soundtrackFadeIn: DEFAULT_PROJECT.soundtrackFadeIn,
                soundtrackFadeOut: DEFAULT_PROJECT.soundtrackFadeOut,
              })}
            onSoundtrackPatch={(patch) => updateProject(patch)}
          />
        </main>

        <aside className="right-panel" aria-hidden={sidePanelsHidden}>
          <div className="inspector-scroll">
            <SettingsSection id="device" title="Device" icon={Smartphone} open={openSectionId === 'device'} onToggle={toggleSection}>
              <div className="option-toggle-row">
                <span>iOS + Android</span>
                <SwitchControl
                  checked={project.compositionMode === 'split'}
                  label="iOS + Android"
                  title={project.compositionMode === 'split' ? 'Return to a single device' : 'Show both platforms side by side'}
                  onChange={(on) => (on ? enableSplitComposition() : enableSingleComposition())}
                />
              </div>
              <div className={`device-dropdown ${deviceDropdownOpen ? 'is-open' : ''}`}>
                <button
                  type="button"
                  className="device-dropdown-trigger"
                  disabled={project.compositionMode === 'split'}
                  aria-expanded={deviceDropdownOpen}
                  aria-haspopup="listbox"
                  title={project.compositionMode === 'split' ? 'Device locked in split mode' : 'Choose device'}
                  onClick={() => setDeviceDropdownOpen((open) => !open)}
                >
                  <span className="device-dropdown-copy">
                    <strong>{getDevice(project.deviceId).label}</strong>
                    <span>
                      {isCustomDeviceId(project.deviceId) ? 'Custom' : getDevice(project.deviceId).platform === 'ios' ? 'iOS' : 'Android'}
                      {' · '}
                      {screenSizeLabel(getDevice(project.deviceId).screenSize)}
                    </span>
                  </span>
                  <ChevronDown size={14} className="device-dropdown-chevron" />
                </button>
                {deviceDropdownOpen && project.compositionMode !== 'split' && (
                  <div className="device-dropdown-menu" role="listbox" aria-label="Devices">
                    {allDevices.map((device) => {
                      const unlocked = isDeviceUnlocked(license.tier, device.id);
                      return (
                        <button
                          key={device.id}
                          type="button"
                          role="option"
                          aria-selected={project.deviceId === device.id}
                          className={`device-dropdown-option ${project.deviceId === device.id ? 'is-selected' : ''} ${unlocked ? '' : 'is-locked'}`}
                          title={unlocked
                            ? `${device.subtitle} · ${screenSizeLabel(device.screenSize)}`
                            : `Pro ${formatGbp(PLAN_PRICES_GBP.pro)} — unlock full device library`}
                          onClick={() => {
                            if (!unlocked) {
                              notify(upgradeCopy('The full device library'));
                              setLicenseOpen(true);
                              setDeviceDropdownOpen(false);
                              return;
                            }
                            patchSelectedDevice({ deviceId: device.id });
                            setDeviceChosen(true);
                            if (isPlaceholderScreenshot(project.screenshot)) {
                              updateProject({ screenshot: placeholderForDevice(device) });
                            }
                            setDeviceDropdownOpen(false);
                          }}
                        >
                          <span className="device-dropdown-copy">
                            <strong>{device.label}</strong>
                            <span>
                              {isCustomDeviceId(device.id) ? 'Custom' : device.platform === 'ios' ? 'iOS' : 'Android'}
                              {' · '}
                              {screenSizeLabel(device.screenSize)}
                              {!unlocked && ' · Pro'}
                            </span>
                          </span>
                          {project.deviceId === device.id ? <Check size={13} /> : !unlocked ? <Lock size={13} /> : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <CustomDevicePanel
                selectedDeviceId={project.deviceId}
                customDevices={customDevices}
                disabled={project.compositionMode === 'split'}
                onNotify={notify}
                onImported={(meta) => {
                  setCustomDevices(loadCustomDeviceMeta());
                  setDevicesTick((n) => n + 1);
                  patchSelectedDevice({ deviceId: meta.id });
                  if (isPlaceholderScreenshot(project.screenshot)) {
                    updateProject({ screenshot: placeholderForDevice(meta.id) });
                  }
                }}
                onUpdated={() => {
                  setCustomDevices(loadCustomDeviceMeta());
                  setDevicesTick((n) => n + 1);
                  if (isPlaceholderScreenshot(project.screenshot) && isCustomDeviceId(project.deviceId)) {
                    updateProject({ screenshot: placeholderForDevice(project.deviceId) });
                  }
                }}
                onDeleted={(id) => {
                  setCustomDevices(loadCustomDeviceMeta());
                  setDevicesTick((n) => n + 1);
                  if (project.deviceId === id) {
                    const fallback = DEVICE_MODELS[0];
                    patchSelectedDevice({ deviceId: fallback.id });
                    if (isPlaceholderScreenshot(project.screenshot)) {
                      updateProject({ screenshot: placeholderForDevice(fallback) });
                    }
                  }
                }}
              />
              {deviceChosen && (
                <button className="button full-outline compact" onClick={() => { setLeftTab('assets'); imageInputRef.current?.click(); }}>
                  <ImagePlus size={14} />
                  {screenMediaKind(project.screenshot) === 'video' ? 'Replace screen video' : 'Replace screenshot'}
                </button>
              )}
              <div className="field-caption" style={{ marginTop: 10 }}>FINISH</div>
              <div className="device-finish-grid" role="group" aria-label="Device finish">
                {DEVICE_COLORS.map((finish) => (
                  <button
                    key={finish.id}
                    type="button"
                    className={`device-finish-swatch ${(project.deviceColor === finish.id || (finish.id === 'clay' && project.clayMode)) ? 'selected' : ''}`}
                    title={finish.label}
                    onClick={() => updateProject({
                      deviceColor: finish.id as DeviceColor,
                      clayMode: finish.id === 'clay',
                    })}
                  >
                    <span style={{ background: finish.hex }} />
                    <em>{finish.label}</em>
                  </button>
                ))}
              </div>
            </SettingsSection>

            <SettingsSection id="transform" title="Transform" icon={Rotate3D} open={openSectionId === 'transform'} onToggle={toggleSection}>
              <SliderField label="Rotate X" min={-90} max={90} value={displaySelected.rotation.x} onChange={(v) => updateRotation('x', v)} />
              <SliderField label="Rotate Y" min={-180} max={180} value={displaySelected.rotation.y} onChange={(v) => updateRotation('y', v)} />
              <SliderField label="Rotate Z" min={-90} max={90} value={displaySelected.rotation.z} onChange={(v) => updateRotation('z', v)} />
              <SliderField label="Scale" min={0.6} max={1.3} step={0.05} unit="×" value={displaySelected.scale} onChange={(v) => {
                patchSelectedDevice({ scale: v });
                if (timelineOpen) keyPropertyAtPlayhead('scale', v);
              }} />
              <div className="field-caption" style={{ marginTop: 4 }}>MATERIALS</div>
              <SliderField
                label="Glass reflection"
                min={0}
                max={1}
                step={0.05}
                unit=""
                value={displaySelected.glassReflection ?? 0.55}
                onChange={(v) => patchSelectedDevice({ glassReflection: v })}
              />
              <button className="text-button" onClick={resetDevice}><RotateCcw size={13} /> Reset transform</button>
            </SettingsSection>

            <SettingsSection id="overlays" title="Overlays" icon={Layers3} open={openSectionId === 'overlays'} onToggle={toggleSection}>
              <div className="overlay-actions">
                <button
                  type="button"
                  className="button full-outline compact"
                  onClick={() => {
                    const next = createOverlay({
                      kind: 'text',
                      endTime: animation.duration,
                    });
                    updateProject({
                      overlays: [...(project.overlays ?? []), next],
                    });
                    setSelectedOverlayId(next.id);
                  }}
                >
                  <Plus size={14} /> Add text
                </button>
              </div>
              {(project.overlays ?? []).length === 0 && (
                <p className="field-caption">Add titles, then drag them on the canvas. Colour, size, and timing edit below.</p>
              )}
              {(project.overlays ?? []).map((overlay) => (
                <div
                  key={overlay.id}
                  className={`overlay-editor ${selectedOverlayId === overlay.id ? 'is-selected' : ''}`}
                  onClick={() => setSelectedOverlayId(overlay.id)}
                >
                  {overlay.kind === 'text' && (
                    <textarea
                      className="text-input overlay-text-area"
                      value={overlay.text ?? ''}
                      placeholder="Headline"
                      rows={2}
                      onChange={(e) => patchOverlay(overlay.id, { text: e.target.value })}
                    />
                  )}
                  {overlay.kind === 'text' && (
                    <div className="overlay-row overlay-row-color">
                      <label className="overlay-color-field">
                        Colour
                        <span className="gradient-color-input">
                          <input
                            type="color"
                            value={overlay.color || '#ffffff'}
                            aria-label="Text colour"
                            onChange={(e) => {
                              const hex = normalizeOverlayColor(e.target.value);
                              if (hex) patchOverlay(overlay.id, { color: hex });
                            }}
                          />
                          <input
                            type="text"
                            defaultValue={overlay.color || '#ffffff'}
                            key={`overlay-color-${overlay.id}-${overlay.color || '#ffffff'}`}
                            maxLength={7}
                            aria-label="Text colour hex"
                            onBlur={(e) => {
                              const hex = normalizeOverlayColor(e.target.value);
                              if (hex) patchOverlay(overlay.id, { color: hex });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                          />
                        </span>
                      </label>
                      <label>
                        Size
                        <input
                          type="range"
                          min={0.02}
                          max={0.16}
                          step={0.005}
                          value={overlay.fontSize ?? 0.055}
                          onChange={(e) => patchOverlay(overlay.id, { fontSize: Number(e.target.value) })}
                        />
                      </label>
                    </div>
                  )}
                  <div className="overlay-row">
                    <label>
                      X
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={overlay.x}
                        onChange={(e) => patchOverlay(overlay.id, { x: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Y
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={overlay.y}
                        onChange={(e) => patchOverlay(overlay.id, { y: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                  <div className="overlay-row">
                    <label>
                      Opacity
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={overlay.opacity}
                        onChange={(e) => patchOverlay(overlay.id, { opacity: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Scale
                      <input
                        type="range"
                        min={0.4}
                        max={2.5}
                        step={0.05}
                        value={overlay.scale}
                        onChange={(e) => patchOverlay(overlay.id, { scale: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                  <div className="overlay-row">
                    <label>
                      In
                      <input
                        type="number"
                        min={0}
                        max={30}
                        step={0.1}
                        value={Number(overlay.startTime.toFixed(1))}
                        onChange={(e) => patchOverlay(overlay.id, {
                          startTime: Math.max(0, Number(e.target.value) || 0),
                        })}
                      />
                    </label>
                    <label>
                      Out
                      <input
                        type="number"
                        min={0}
                        max={30}
                        step={0.1}
                        value={Number(overlay.endTime.toFixed(1))}
                        onChange={(e) => patchOverlay(overlay.id, {
                          endTime: Math.max(0, Number(e.target.value) || 0),
                        })}
                      />
                    </label>
                    <button
                      type="button"
                      className="icon-button danger"
                      title="Remove overlay"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateProject({
                          overlays: (project.overlays ?? []).filter((item) => item.id !== overlay.id),
                        });
                        if (selectedOverlayId === overlay.id) setSelectedOverlayId(null);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </SettingsSection>

            <SettingsSection id="environment" title="Environment" icon={Aperture} open={openSectionId === 'environment'} onToggle={toggleSection}>
              <div className="env-stack">
                <div className="env-group">
                  <div className="field-caption">Reflection</div>
                  <ReflectionMapPicker
                    value={project.reflectionMap ?? 'match_background'}
                    customImage={project.reflectionMapImage ?? null}
                    background={project.background}
                    colors={project.background === 'transparent' ? null : project.gradientColors}
                    onChange={(id: ReflectionMapSetting) => updateProject({ reflectionMap: id })}
                    onCustomImage={(dataUrl) => updateProject({
                      reflectionMapImage: dataUrl,
                      reflectionMap: dataUrl ? 'custom' : 'match_background',
                    })}
                  />
                </div>

                <div className="env-group">
                  <div className="field-caption">Light & shadow</div>
                  <div className="env-sliders">
                    <SliderField
                      label="Key light"
                      min={0.5}
                      max={5}
                      step={0.1}
                      unit="×"
                      value={project.lightIntensity}
                      onChange={(v) => updateProject({ lightIntensity: v })}
                    />
                    <SliderField
                      label="Fill light"
                      min={0}
                      max={2.5}
                      step={0.05}
                      unit="×"
                      value={project.fillIntensity ?? DEFAULT_PROJECT.fillIntensity}
                      onChange={(v) => updateProject({ fillIntensity: v })}
                    />
                    <SliderField
                      label="Shadow softness"
                      min={0.2}
                      max={8}
                      step={0.1}
                      unit=""
                      value={project.shadowSoftness ?? DEFAULT_PROJECT.shadowSoftness}
                      onChange={(v) => updateProject({ shadowSoftness: v })}
                    />
                    <SliderField
                      label="Shadow strength"
                      min={0}
                      max={0.85}
                      step={0.01}
                      unit=""
                      value={project.shadowOpacity ?? DEFAULT_PROJECT.shadowOpacity}
                      onChange={(v) => updateProject({ shadowOpacity: v })}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  className="text-button env-quiet-action"
                  onClick={() => updateProject({
                    lightIntensity: DEFAULT_PROJECT.lightIntensity,
                    fillIntensity: DEFAULT_PROJECT.fillIntensity,
                    shadowSoftness: DEFAULT_PROJECT.shadowSoftness,
                    shadowOpacity: DEFAULT_PROJECT.shadowOpacity,
                  })}
                >
                  <Sun size={12} /> Reset lighting & shadows
                </button>
              </div>
            </SettingsSection>

            <SettingsSection id="look" title="Look & motion" icon={Sparkles} open={openSectionId === 'look'} onToggle={toggleSection}>
              <div className="scene-look-block is-inspector">
                {!isTransparent && (
                  <div className="scene-look-group">
                    <div className="field-caption scene-look-sub">Colours</div>
                    <div className="gradient-color-grid">
                      {([
                        ['center', 'Center'],
                        ['mid', 'Mid'],
                        ['edge', 'Edge'],
                      ] as const).map(([key, label]) => (
                        <label key={key} className="gradient-color-field">
                          <span className="gradient-color-label">{label}</span>
                          <span className="gradient-color-input">
                            <input type="color" value={project.gradientColors[key]} aria-label={`${label} colour`}
                              onChange={(e) => updateGradient(key, e.target.value)} />
                            <input
                              type="text"
                              defaultValue={project.gradientColors[key]}
                              key={`${key}-${project.gradientColors[key]}`}
                              maxLength={7}
                              aria-label={`${label} hex`}
                              onBlur={(e) => updateGradient(key, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.currentTarget.blur();
                                }
                              }}
                            />
                          </span>
                        </label>
                      ))}
                    </div>
                    {savingPreset ? (
                      <div className="preset-save-row">
                        <input
                          className="preset-name-input"
                          placeholder="Preset name"
                          value={presetName}
                          maxLength={40}
                          autoFocus
                          onChange={(e) => setPresetName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') onSavePreset();
                            if (e.key === 'Escape') setSavingPreset(false);
                          }}
                        />
                        <button type="button" className="button subtle-button" onClick={() => setSavingPreset(false)}>Cancel</button>
                        <button type="button" className="button primary-button" onClick={onSavePreset}>Save</button>
                      </div>
                    ) : (
                      <button type="button" className="text-button env-quiet-action" onClick={() => setSavingPreset(true)}>
                        <Save size={12} /> Save as preset
                      </button>
                    )}
                  </div>
                )}

                <div className="scene-look-group">
                  <div className="field-caption scene-look-sub">Motion</div>
                  <div className="motion-preset-row" role="group" aria-label="Motion presets">
                    {([
                      ['turntable', 'Turntable'],
                      ['spin', 'Spin 360'],
                      ['float', 'Float'],
                      ['tilt', 'Tilt'],
                      ['orbit', 'Orbit'],
                      ['zoom', 'Zoom In'],
                      ['present', 'Present'],
                      ['wobble', 'Wobble'],
                    ] as const).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className="motion-preset-chip"
                        title={`Apply ${label} motion`}
                        onClick={() => applyMotionPreset(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="scene-look-group">
                  <div className="field-caption scene-look-sub">Edge blur</div>
                  <div className="env-toggle-stack">
                    <div className="option-toggle-row">
                      <span>Top</span>
                      <SwitchControl
                        checked={project.edgeBlurTop ?? false}
                        label="Top edge blur"
                        onChange={(on) => updateProject({ edgeBlurTop: on })}
                      />
                    </div>
                    <div className="option-toggle-row">
                      <span>Bottom</span>
                      <SwitchControl
                        checked={project.edgeBlurBottom ?? false}
                        label="Bottom edge blur"
                        onChange={(on) => updateProject({ edgeBlurBottom: on })}
                      />
                    </div>
                  </div>
                  {((project.edgeBlurTop ?? false) || (project.edgeBlurBottom ?? false)) && (
                    <SliderField
                      label="Blur amount"
                      min={4}
                      max={64}
                      step={1}
                      unit="px"
                      value={project.edgeBlurAmount ?? DEFAULT_PROJECT.edgeBlurAmount}
                      onChange={(v) => updateProject({ edgeBlurAmount: v })}
                    />
                  )}
                </div>
              </div>
            </SettingsSection>

            <SettingsSection id="camera" title="Camera" icon={Settings2} open={openSectionId === 'camera'} onToggle={toggleSection}>
              <div className="field-caption">Angle</div>
              <div className="camera-preset-grid">
                {(['front', 'left', 'right', 'top'] as CameraView[]).map((view) => (
                  <button key={view} onClick={() => updateProject({ cameraView: view })}
                    className={project.cameraView === view ? 'selected' : ''}>{view[0].toUpperCase() + view.slice(1)}</button>
                ))}
              </div>
              <div className="field-caption" style={{ marginTop: 12 }}>Lens</div>
              <div className="camera-preset-grid">
                {CAMERA_LENSES.map((lens) => (
                  <button
                    key={lens.id}
                    type="button"
                    title={`${lens.label} ${lens.hint}`}
                    onClick={() => updateProject({ cameraLens: lens.id })}
                    className={(project.cameraLens ?? 'standard') === lens.id ? 'selected' : ''}
                  >
                    {lens.label}
                  </button>
                ))}
              </div>
              <p className="field-caption" style={{ marginTop: 8 }}>
                {CAMERA_LENSES.find((l) => l.id === (project.cameraLens ?? 'standard'))?.hint ?? '~35 mm'} · changes perspective FOV
              </p>
              <button type="button" className="button full-outline compact" style={{ marginTop: 10 }} onClick={keyCameraAtPlayhead}>
                <Aperture size={14} /> Key camera at playhead
              </button>
              <p className="field-caption" style={{ marginTop: 8 }}>
                Opens the timeline and stores the current camera position as keyframes.
              </p>
            </SettingsSection>
          </div>
          <div className="inspector-footer inspector-export-panel">
            <div className="figma-export-head">
              <span>Export</span>
              <button
                type="button"
                className="figma-export-add"
                disabled={exporting}
                onClick={addExportEntry}
                title="Add export"
                aria-label="Add export"
              >
                <Plus size={14} strokeWidth={2} />
              </button>
            </div>
            <div className="figma-export-segment" role="tablist" aria-label="Export type">
              <button
                type="button"
                role="tab"
                aria-selected={exportMediaMode === 'static'}
                className={exportMediaMode === 'static' ? 'is-active' : ''}
                disabled={exporting}
                onClick={() => setExportMediaModeSafe('static')}
              >
                Static
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={exportMediaMode === 'animated'}
                className={`${exportMediaMode === 'animated' ? 'is-active' : ''} ${videoAllowed ? '' : 'is-locked'}`}
                disabled={exporting}
                title={videoAllowed ? 'Animated export' : `Pro ${formatGbp(PLAN_PRICES_GBP.pro)} — unlock video export`}
                onClick={() => setExportMediaModeSafe('animated')}
              >
                Animated{!videoAllowed ? ' · Pro' : ''}
              </button>
            </div>
            <div className="figma-export-list" role="list" aria-label="Export files">
              {exportEntries.map((entry) => (
                <div key={entry.id} className="figma-export-row" role="listitem">
                  <select
                    className="figma-export-scale"
                    value={entry.scale}
                    disabled={exporting}
                    aria-label="Export scale"
                    onChange={(e) => updateExportEntry(entry.id, { scale: Number(e.target.value) as ExportScale })}
                  >
                    {EXPORT_SCALES.map((scale) => (
                      <option key={scale} value={scale}>{formatExportScale(scale)}</option>
                    ))}
                  </select>
                  <select
                    className="figma-export-format"
                    value={entry.kind}
                    disabled={exporting}
                    aria-label="Export format"
                    onChange={(e) => updateExportEntry(entry.id, { kind: e.target.value as ExportKind })}
                  >
                    {exportMediaMode === 'static'
                      ? STILL_FORMATS.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))
                      : availableVideoFormats.map((item) => (
                        <option key={item.id} value={item.id} disabled={!videoAllowed}>
                          {item.label}{!videoAllowed ? ' · Pro' : ''}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    className="figma-export-icon"
                    disabled={exporting}
                    title="Export size settings"
                    aria-label="Export size settings"
                    onClick={() => setExportOpen(true)}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                  <button
                    type="button"
                    className="figma-export-icon"
                    disabled={exporting || exportEntries.length <= 1}
                    onClick={() => removeExportEntry(entry.id)}
                    title="Remove export"
                    aria-label="Remove export"
                  >
                    <Minus size={14} />
                  </button>
                </div>
              ))}
            </div>
            {exportNeedsAnimation && (
              <p className="export-panel-warning">Add timeline keyframes before exporting video.</p>
            )}
            {exportMediaMode === 'animated' && isTransparent && (
              <p className="export-panel-warning">
                Transparent plate: WebM keeps alpha in Chrome / Firefox / Edge. GIF works everywhere. MP4 cannot keep transparency.
              </p>
            )}
            {exportProgress && <p className="export-panel-progress">{exportProgress}</p>}
            <button
              type="button"
              className="figma-export-button"
              disabled={exporting || exportNeedsAnimation || exportEntries.length === 0}
              onClick={() => setExportOpen(true)}
            >
              {exportActionLabel}
            </button>
          </div>
        </aside>
      </div>
      )}

      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg,video/mp4,video/webm,video/quicktime" hidden onChange={onImageChange} />
      <input
        ref={svgInputRef}
        type="file"
        accept="image/svg+xml,.svg"
        hidden
        onChange={(event) => {
          void importScreenMedia(event.currentTarget.files?.[0]).catch((e: Error) => notify(e.message));
          event.currentTarget.value = '';
        }}
      />
      <input ref={projectInputRef} type="file" accept=".json,.mockup.json,application/json" hidden onChange={(e) => { void onProjectFile(e); }} />

      {hasOpenProject && exportOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !exporting) setExportOpen(false); }}>
          <div className="export-modal export-modal-wide" role="dialog" aria-modal="true" aria-labelledby="export-title">
            <div className="modal-head"><div className="modal-icon"><Download size={21} /></div>
              <button className="modal-close" aria-label="Close export settings" onClick={() => setExportOpen(false)} disabled={exporting}><X size={19} /></button></div>
            <h2 id="export-title">Export your masterpiece</h2>
            <p>
              {exportAspectIds.length > 1
                ? `Export ${exportAspectIds.length} platform sizes at once — each gets its own file.`
                : exportEntries.length > 1
                  ? `Ready to export ${exportEntries.length} formats. Select more sizes below to batch platforms too.`
                  : hasVideoExportSelected
                    ? `Renders your timeline (${animation.duration.toFixed(1)}s · ${animation.fps} fps) as ${videoFormatById(selectedVideoFormats[0]).label}.`
                    : 'Choose one or more sizes. We’ll render each as a high-resolution asset.'}
            </p>

            {hasVideoExportSelected && (
              <>
                <div className="modal-field-label">FRAME RATE</div>
                <div className="export-fps-row" role="group" aria-label="Export frame rate">
                  {EXPORT_FPS_OPTIONS.map((fps) => (
                    <button
                      key={fps}
                      type="button"
                      className={`export-fps ${animation.fps === fps ? 'selected' : ''}`}
                      disabled={exporting}
                      onClick={() => updateProject({ animation: { ...animation, fps } })}
                    >
                      {fps} fps
                    </button>
                  ))}
                </div>
              </>
            )}

            {hasStillExportSelected && project.compositionMode === 'split' && (
              <>
                <div className="modal-field-label">PLATFORM OUTPUT</div>
                <div className="export-preset-list" style={{ marginBottom: 18 }}>
                  <button type="button" className={`export-preset ${exportMode === 'combined' ? 'selected' : ''}`} onClick={() => setExportMode('combined')} disabled={exporting}>
                    <Columns2 size={18} />
                    <div><strong>Combined split</strong><span>One file with iOS + Android side by side</span></div>
                    <span className="radio-dot">{exportMode === 'combined' && <span />}</span>
                  </button>
                  <button type="button" className={`export-preset ${exportMode === 'separate' ? 'selected' : ''}`} onClick={() => setExportMode('separate')} disabled={exporting}>
                    <Copy size={18} />
                    <div><strong>Both platforms</strong><span>Two files — iOS and Android separately</span></div>
                    <span className="radio-dot">{exportMode === 'separate' && <span />}</span>
                  </button>
                </div>
              </>
            )}

            <div className="modal-field-label">
              SIZES
              <span>{exportAspectIds.length > 1 ? `${exportAspectIds.length} selected` : 'Tap to multi-select'}</span>
            </div>
            {EXPORT_ASPECT_GROUPS.map((group) => {
              const items = EXPORT_ASPECTS.filter((item) => item.group === group.id);
              if (items.length === 0) return null;
              const groupSelected = items.filter((item) => exportAspectIds.includes(item.id)).length;
              return (
                <div key={group.id} className="export-aspect-group">
                  <div className="modal-field-label">
                    {group.label.toUpperCase()}
                    {groupSelected > 0 ? <span>{groupSelected}</span> : <span />}
                  </div>
                  <div className="export-aspect-grid">
                    {items.map((item) => {
                      const selected = exportAspectIds.includes(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`export-aspect ${selected ? 'selected' : ''}`}
                          disabled={exporting}
                          title={'fixed' in item && item.fixed
                            ? `${item.fixed.width} × ${item.fixed.height}`
                            : item.hint}
                          onClick={() => toggleExportAspect(item.id)}
                        >
                          <div className="export-ratio" style={exportRatioThumbStyle(item.ratio)} />
                          <strong>{item.label}</strong>
                          <span>{'fixed' in item && item.fixed
                            ? `${item.fixed.width}×${item.fixed.height}`
                            : item.hint}</span>
                          {selected && <span className="export-aspect-check" aria-hidden><Check size={11} strokeWidth={3} /></span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className="modal-field-label">RESOLUTION <span>{resolveExportSize().label} px</span></div>
            <div className="export-resolution-row" role="group" aria-label="Output resolution">
              {availableResolutions.map((item) => {
                const preview = resolveExportDimensions(
                  primaryExportAspect,
                  item.id,
                  item.id === 'custom' ? customExportSize : undefined,
                );
                const longEdge = Math.max(preview.width, preview.height);
                const allowed = isResolutionAllowed(license.tier, longEdge);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`export-resolution ${exportResolution === item.id ? 'selected' : ''} ${allowed ? '' : 'is-locked'}`}
                    disabled={exporting}
                    title={allowed
                      ? `${preview.width} × ${preview.height}`
                      : `Free up to Full HD · Pro ${formatGbp(PLAN_PRICES_GBP.pro)}`}
                    onClick={() => {
                      if (!allowed) {
                        notify(`Free exports up to Full HD. ${upgradeCopy('Higher resolutions')}`);
                        setLicenseOpen(true);
                        return;
                      }
                      setExportResolution(item.id);
                      if (item.id !== 'custom' && item.id !== 'native') {
                        setCustomExportSize({ width: preview.width, height: preview.height });
                      }
                    }}
                  >
                    <strong>{item.label}{!allowed && ' · Pro'}</strong>
                    <span>{item.id === 'custom' || item.id === 'native' ? item.detail : `${preview.width}×${preview.height}`}</span>
                  </button>
                );
              })}
            </div>

            {(exportAspectIds.includes('custom') || exportResolution === 'custom') && (
              <div className="export-custom-size">
                <label>
                  <span>Width</span>
                  <input
                    type="number"
                    min={EXPORT_SIZE_LIMITS.min}
                    max={EXPORT_SIZE_LIMITS.max}
                    step={2}
                    value={customExportSize.width}
                    disabled={exporting}
                    onChange={(e) => {
                      setExportResolution('custom');
                      setCustomExportSize((current) => ({
                        ...current,
                        width: Number(e.target.value) || current.width,
                      }));
                    }}
                  />
                </label>
                <label>
                  <span>Height</span>
                  <input
                    type="number"
                    min={EXPORT_SIZE_LIMITS.min}
                    max={EXPORT_SIZE_LIMITS.max}
                    step={2}
                    value={customExportSize.height}
                    disabled={exporting}
                    onChange={(e) => {
                      setExportResolution('custom');
                      setCustomExportSize((current) => ({
                        ...current,
                        height: Number(e.target.value) || current.height,
                      }));
                    }}
                  />
                </label>
                <span className="export-custom-hint">{EXPORT_SIZE_LIMITS.min}–{EXPORT_SIZE_LIMITS.max} px</span>
              </div>
            )}
            {exportNeedsAnimation && (
              <p className="export-warning">Add keyframes on the timeline before exporting video or GIF.</p>
            )}
            {exportProgress && <p className="export-progress">{exportProgress}</p>}
            <div className="export-modal-actions"><button className="button subtle-button" disabled={exporting} onClick={() => setExportOpen(false)}>Cancel</button>
              <button
                className="button primary-button"
                disabled={exporting || exportNeedsAnimation || exportEntries.length === 0}
                onClick={() => void runExport()}
              >
                <ArrowDownToLine size={16} />
                {exporting
                  ? (exportProgress || 'Rendering…')
                  : exportAspectIds.length > 1 || exportEntries.length > 1
                    ? `Export ${exportAspectIds.length * exportEntries.length} files`
                    : exportActionLabel}
              </button></div>
          </div>
        </div>
      )}
      {helpOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setHelpOpen(false); }}>
          <div className="export-modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
            <div className="modal-head"><div className="modal-icon"><CircleHelp size={21} /></div>
              <button className="modal-close" aria-label="Close help" onClick={() => setHelpOpen(false)}><X size={19} /></button></div>
            <h2 id="help-title">Welcome to Mockup Studio</h2>
            <p>Your private, local-first device mockup editor.</p>
            <div className="help-rows">
              <div><MousePointer2 size={17} /><span>Drag on the preview to orbit the 3D phone. Scroll to zoom. Hold Space + drag to pan.</span></div>
              <div><ImagePlus size={17} /><span>Drop a screenshot onto the preview or select Assets → Import.</span></div>
              <div><MonitorSmartphone size={17} /><span>Plug in an iPhone or Android over USB and use Phone Mirror — it auto-detects the device. Snapshot freezes the live screen onto the mockup.</span></div>
              <div><SlidersHorizontal size={17} /><span>Drag gizmo arrows to move the device, rings to rotate. Tune colour, lighting and backgrounds in Properties.</span></div>
              <div><Gauge size={17} /><span>Space play/pause · long-press & drag to multi-select keys · set Ease on selection · Delete removes selected.</span></div>
              <div><Command size={17} /><span>⌘S Save · ⌘O Open · ⌘E Export · ⌘T New from template · ⌘W Close tab (last tab → recent projects) · . hide panels.</span></div>
            </div>
            <button className="button primary-button modal-full-button" onClick={() => setHelpOpen(false)}>Start creating</button>
          </div>
        </div>
      )}
      {templatePickerOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setTemplatePickerOpen(false); }}>
          <div className="export-modal template-modal" role="dialog" aria-modal="true" aria-labelledby="template-title">
            <div className="modal-head">
              <div className="modal-icon"><LayoutTemplate size={21} /></div>
              <button className="modal-close" aria-label="Close templates" onClick={() => setTemplatePickerOpen(false)}><X size={19} /></button>
            </div>
            <h2 id="template-title">Start a new project</h2>
            <p>Choose a device layout or a pre-built scene with props like clay shapes and concrete walls. Opens in a new tab.</p>
            <div className="template-category-tabs" role="tablist" aria-label="Template type">
              <button
                type="button"
                role="tab"
                aria-selected={templateCategory === 'devices'}
                className={templateCategory === 'devices' ? 'active' : ''}
                onClick={() => setTemplateCategory('devices')}
              >
                <Smartphone size={14} /> Device templates
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={templateCategory === 'scenes'}
                className={templateCategory === 'scenes' ? 'active' : ''}
                onClick={() => setTemplateCategory('scenes')}
              >
                <Sparkles size={14} /> Pre-compositions
              </button>
            </div>
            <div className="modal-field-label">
              {templateCategory === 'devices' ? 'DEVICE LAYOUTS' : 'SCENE COMPOSITIONS'}
              <span>{workspace.tabs.length}/{MAX_PROJECT_TABS} tabs</span>
            </div>
            <div className="template-grid">
              {templatesByCategory(templateCategory).map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="template-card"
                  onClick={() => startFromTemplate(template)}
                >
                  <TemplatePreview layout={template.preview} />
                  <div className="template-card-body">
                    <strong>{template.label}</strong>
                    <span>{template.description}</span>
                    <em>{template.badge}</em>
                  </div>
                </button>
              ))}
            </div>
            <div className="export-modal-actions">
              <button type="button" className="button subtle-button" onClick={() => setTemplatePickerOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <LicenseModal
        open={licenseOpen}
        license={license}
        onClose={() => setLicenseOpen(false)}
        onChange={setLicense}
        onNotify={notify}
      />
      <FigmaExploreModal
        open={figmaExploreOpen}
        onClose={() => setFigmaExploreOpen(false)}
        onNotify={notify}
        onApply={(dataUrl, layerName) => {
          applyScreenImage(dataUrl, layerName, `Applied “${layerName}” from Figma`);
        }}
      />
      <SvgExplodeModal
        open={svgExplodeModel != null}
        model={svgExplodeModel}
        onClose={() => setSvgExplodeModel(null)}
        onNotify={notify}
        onApply={(dataUrl, layerName) => {
          applyScreenImage(dataUrl, layerName, `Applied “${layerName}” from SVG`);
        }}
      />
      {toast && <div className="toast"><span className="toast-dot" /> {toast}<button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={14} /></button></div>}
    </div>
  );
}
