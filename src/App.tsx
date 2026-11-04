import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import {
  Aperture, ArrowDownToLine, ArrowLeftRight, Box, Check, ChevronDown, CircleHelp,
  Clock3, Columns2, Command, Copy, Download, FileImage, Film, FolderOpen, Gauge, ImagePlus, Layers3,
  LayoutTemplate, Maximize, MousePointer2, Move, Plus, RotateCcw, Rotate3D, Save,
  Settings2, SlidersHorizontal, Smartphone, Sparkles, Sun, Trash2, Upload, X,
} from 'lucide-react';
import AnimationTimeline from './components/AnimationTimeline';
import DeviceCanvas, { type CaptureApi, type DeviceSelectPayload } from './components/DeviceCanvas';
import ReflectionMapPicker from './components/ReflectionMapPicker';
import type { GizmoMode } from './components/RotationBall';
import { isPlaceholderScreenshot, placeholderForDevice } from './lib/demo';
import { evaluateAnimation, hasAnimation, upsertKeyframe } from './lib/animation';
import { DEVICE_MODELS, getDevice, screenSizeLabel } from './lib/devices';
import { downloadBlob, safeFilename, validateProject } from './lib/project';
import {
  STILL_FORMATS, VIDEO_FORMATS, encodeAnimationVideo, isStillExport, isVideoExport,
  stillFormatById, videoFormatById,
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
  BACKGROUNDS, DEFAULT_GRADIENT, DEFAULT_PROJECT, EXPORT_ASPECTS, EXPORT_RESOLUTIONS,
  EXPORT_SIZE_LIMITS, MAX_DEVICES, resolveExportDimensions,
  buildSplitDevices, createDefaultAnimation, createDeviceInstance, getSelectedDevice, gradientCss,
  syncProjectFromSelected,
  type AnimProperty, type BackgroundPreset, type CameraView, type ExportAspectId,
  type ExportResolutionId, type GradientColors, type MockupProject, type ReflectionMapSetting,
  type ScenePreset, type Vec3,
} from './types';

type LeftTab = 'scenes' | 'assets';
type Workspace = { tabs: ProjectTab[]; activeId: string | null };

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
        <div className="section-heading-left"><Icon size={15} strokeWidth={1.9} /> <span>{title}</span></div>
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

function sceneThumbStyle(scene: ScenePreset): CSSProperties | undefined {
  if (!scene.gradient) return undefined;
  if (BACKGROUNDS.some((item) => item.id === scene.id)) return undefined;
  return { background: gradientCss(scene.gradient) };
}

function swatchStyle(scene: ScenePreset): CSSProperties | undefined {
  return sceneThumbStyle(scene);
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(createInitialWorkspace);
  const [customPresets, setCustomPresets] = useState<ScenePreset[]>(() => loadCustomScenePresets());
  const [presetName, setPresetName] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>('scenes');
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateCategory, setTemplateCategory] = useState<TemplateCategory>('devices');
  const [exportAspect, setExportAspect] = useState<ExportAspectId>('portrait');
  const [exportResolution, setExportResolution] = useState<ExportResolutionId>('fhd');
  const [customExportSize, setCustomExportSize] = useState({ width: 1080, height: 1920 });
  const [exportMode, setExportMode] = useState<'combined' | 'separate'>('combined');
  const [exportKind, setExportKind] = useState<ExportKind>('png');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [deviceMenu, setDeviceMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('rotate');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    device: true,
    transform: true,
    environment: false,
    camera: false,
  });
  const [sidePanelsHidden, setSidePanelsHidden] = useState(false);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>(() => loadRecentProjects());
  const renameInputRef = useRef<HTMLInputElement>(null);
  const timelineBeforeHideRef = useRef(true);
  const toggleSection = useCallback((id: string) => {
    setOpenSections((current) => ({ ...current, [id]: !current[id] }));
  }, []);
  const captureRef = useRef<CaptureApi | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | null>(null);

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
  const activeScene = allScenes.find((item) => item.id === project.background)
    ?? (project.background === 'custom'
      ? { id: 'custom', label: 'Custom gradient', description: 'Edited colours', gradient: project.gradientColors } as ScenePreset
      : BACKGROUNDS[0]);
  const isTransparent = project.background === 'transparent';

  const animation = project.animation ?? createDefaultAnimation(project.selectedDeviceId || 'device-main');
  const animActive = timelineOpen || animPlaying;
  const displayProject = useMemo(() => {
    if (!animActive || !hasAnimation(animation)) return project;
    return {
      ...project,
      animation,
      devices: evaluateAnimation(project.devices, animation, animTime),
    };
  }, [project, animation, animActive, animTime]);
  const displaySelected = getSelectedDevice(displayProject);

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
          ? { ...tab, project: nextProject, animTime: 0, animPlaying: false, timelineOpen: true }
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

  const importImage = async (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify('Choose a PNG, JPG or WebP image.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      notify('Use an image under 20 MB.');
      return;
    }
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read image'));
      reader.readAsDataURL(file);
    });
    updateProject({ screenshot: url });
    notify('Screenshot added to your device');
  };

  const onImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    void importImage(event.currentTarget.files?.[0]).catch((e: Error) => notify(e.message));
    event.currentTarget.value = '';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    void importImage(event.dataTransfer.files[0]).catch((e: Error) => notify(e.message));
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

  const resolveExportSize = () => resolveExportDimensions(exportAspect, exportResolution, customExportSize);

  const availableResolutions = useMemo(() => {
    if (exportAspect === 'appstore') {
      return EXPORT_RESOLUTIONS.filter((item) => item.id === 'native' || item.id === 'custom');
    }
    if (exportAspect === 'custom') {
      return EXPORT_RESOLUTIONS.filter((item) => item.id === 'custom');
    }
    return EXPORT_RESOLUTIONS.filter((item) => item.id !== 'native');
  }, [exportAspect]);

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

  const exportStill = async (format: StillFormatId) => {
    if (!captureRef.current) {
      notify('The 3D preview is not ready yet');
      return;
    }
    const size = resolveExportSize();
    const formatInfo = stillFormatById(format);
    const mime = formatInfo.mime as 'image/png' | 'image/webp';
    setExporting(true);
    setExportProgress(`Rendering ${formatInfo.label}…`);
    try {
      const baseName = `${safeFilename(project.name)}-${size.width}x${size.height}`;

      if (project.compositionMode === 'split' && exportMode === 'separate') {
        const snapshot = project;
        const iosOnly = snapshot.devices.filter((d) => getDevice(d.deviceId).platform === 'ios').map((d) => ({ ...d, position: { x: 0, y: 0, z: 0 } }));
        const androidOnly = snapshot.devices.filter((d) => getDevice(d.deviceId).platform === 'android').map((d) => ({ ...d, position: { x: 0, y: 0, z: 0 } }));
        if (!iosOnly.length || !androidOnly.length) throw new Error('Split composition needs both iOS and Android devices.');

        setProject({ ...snapshot, compositionMode: 'single', devices: iosOnly, selectedDeviceId: iosOnly[0].id, deviceId: iosOnly[0].deviceId });
        await waitFrames(3);
        const iosUrl = await captureRef.current!.toImage(size.width, size.height, mime);
        await saveCapture(iosUrl, `${baseName}-ios`, format);

        setProject({ ...snapshot, compositionMode: 'single', devices: androidOnly, selectedDeviceId: androidOnly[0].id, deviceId: androidOnly[0].deviceId });
        await waitFrames(3);
        const androidUrl = await captureRef.current!.toImage(size.width, size.height, mime);
        await saveCapture(androidUrl, `${baseName}-android`, format);

        setProject(snapshot);
        setExportOpen(false);
        notify(`Exported iOS and Android ${formatInfo.label}s`);
      } else {
        const url = await captureRef.current.toImage(size.width, size.height, mime);
        const suffix = project.compositionMode === 'split' ? '-ios-android' : '';
        const ok = await saveCapture(url, `${baseName}${suffix}`, format);
        if (ok) {
          setExportOpen(false);
          notify(project.compositionMode === 'split'
            ? `Split iOS + Android ${formatInfo.label} exported`
            : `High-resolution ${formatInfo.label} exported`);
        }
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Image export failed');
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  };

  const exportVideo = async (format: VideoFormatId) => {
    if (!captureRef.current) {
      notify('The 3D preview is not ready yet');
      return;
    }
    if (!hasAnimation(animation)) {
      notify('Add animation keyframes before exporting video');
      return;
    }
    const size = resolveExportSize();
    const formatInfo = videoFormatById(format);
    const wasPlaying = animPlaying;
    setAnimPlaying(false);
    setTimelineOpen(true);
    setExporting(true);
    setExportProgress(`Preparing ${formatInfo.label}…`);
    try {
      const blob = await encodeAnimationVideo({
        format,
        width: size.width,
        height: size.height,
        fps: animation.fps,
        duration: animation.duration,
        onProgress: (_ratio, label) => setExportProgress(label),
        renderFrame: async (time, ctx, width, height) => {
          flushSync(() => setAnimTime(time));
          await waitFrames(2);
          captureRef.current?.drawFrame(width, height, ctx);
        },
      });
      const baseName = `${safeFilename(project.name)}-${size.width}x${size.height}`;
      const ok = await saveMediaBlob(blob, baseName, formatInfo.extension, formatInfo.mime);
      if (ok) {
        setExportOpen(false);
        notify(`${formatInfo.label} exported`);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Video export failed');
    } finally {
      setExporting(false);
      setExportProgress(null);
      setAnimPlaying(wasPlaying);
    }
  };

  const runExport = async () => {
    if (isStillExport(exportKind)) await exportStill(exportKind);
    else if (isVideoExport(exportKind)) await exportVideo(exportKind);
  };

  const enableSplitComposition = () => {
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
    setProject((current) => {
      const selected = current.devices.find((d) => d.id === payload.id) ?? getSelectedDevice(current);
      return syncProjectFromSelected(current, selected);
    });
    setDeviceMenu({ id: payload.id, x: payload.clientX, y: payload.clientY });
  };

  const onRotateDevice = (id: string, rotation: Vec3) => {
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
      if (timelineOpen) {
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

  const onMoveDevice = (id: string, position: Vec3) => {
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
      // Only write position keys for the device being dragged — never blast rotation
      // onto split partners mid-move (that was fighting the gizmo in compositions).
      if (timelineOpen) {
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
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-area">
          <div className="brand-mark"><Box size={19} strokeWidth={2.2} /></div>
          <span className="brand-name">mockup<span>studio</span></span>
          <span className="brand-beta">BETA</span>
        </div>
        <div className="document-area">
          <span className="document-divider" />
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
            <button
              type="button"
              className="project-tab-add"
              title={workspace.tabs.length >= MAX_PROJECT_TABS ? `Limit of ${MAX_PROJECT_TABS} tabs` : 'New project from template'}
              aria-label="New project from template"
              disabled={workspace.tabs.length >= MAX_PROJECT_TABS}
              onClick={() => setTemplatePickerOpen(true)}
            >
              <Plus size={14} />
            </button>
          </div>
          <span className="saved-indicator"><span /> {hasOpenProject ? `${workspace.tabs.length} open` : 'Recent'}</span>
        </div>
        <div className="top-actions">
          <button className="top-icon-button" aria-label="Help" title="Help" onClick={() => setHelpOpen(true)}><CircleHelp size={18} /></button>
          <span className="top-action-separator" />
          <button className="button subtle-button" onClick={() => void onOpen()}><FolderOpen size={16} /> <span>Open</span></button>
          <button className="button subtle-button" disabled={!hasOpenProject} onClick={() => void onSave()}><Save size={16} /> <span>Save</span></button>
          <button className="button primary-button" disabled={!hasOpenProject} onClick={() => setExportOpen(true)}><ArrowDownToLine size={16} /> <span>Export image</span></button>
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
            <div><div className="eyebrow">WORKSPACE</div><h2>Your canvas</h2></div>
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
                <div className="field-caption section-label">PRESET COLLECTION <span>{String(allScenes.length).padStart(2, '0')}</span></div>
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
                        <span className="scene-sub">{item.description}</span>
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
                      <span className="scene-sub">Unsaved colours</span>
                    </button>
                  )}
                </div>
                <div className="left-divider" />
                <div className="section-title-small"><Sparkles size={15} /> CREATE SOMETHING GREAT</div>
                <p className="helper-text">Tune gradient colours in Properties, then save them as your own scene preset.</p>
                <div className="tip-card"><span className="tip-badge"><MousePointer2 size={14} /></span>
                  <div><b>Quick tip</b><p>Click and drag on the canvas to orbit your device in 3D.</p></div>
                </div>
              </>
            ) : (
              <>
                <div className="field-caption section-label">YOUR SCREENSHOT</div>
                <button className="upload-zone" onClick={() => imageInputRef.current?.click()}>
                  <ImagePlus size={25} strokeWidth={1.5} />
                  <strong>Import screenshot</strong>
                  <span>PNG, JPG or WebP · Max 20 MB</span>
                  <span className="upload-size-hint">
                    {getDevice(project.deviceId).label}: {screenSizeLabel(getDevice(project.deviceId).screenSize)}
                  </span>
                </button>
                {project.screenshot && (
                  <div className="asset-card">
                    <div className="asset-preview"><img src={project.screenshot} alt="Uploaded screen" /></div>
                    <div>
                      <strong>{isPlaceholderScreenshot(project.screenshot) ? 'Size guide' : 'Current screen'}</strong>
                      <span>{screenSizeLabel(getDevice(project.deviceId).screenSize)} px</span>
                    </div>
                    <button title="Replace screenshot" aria-label="Replace screenshot" onClick={() => imageInputRef.current?.click()}><ArrowLeftRight size={15} /></button>
                  </div>
                )}
                <div className="left-divider" />
                <p className="helper-text">Use a screenshot matching {screenSizeLabel(getDevice(project.deviceId).screenSize)} for a sharp fit. Files stay on this computer.</p>
              </>
            )}
          </div>
          <div className="left-footer"><span className="footer-pulse" /><span>All edits stay on this device</span></div>
        </aside>

        <main className="canvas-panel" onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }} onDrop={onDrop}>
          <div className={`canvas-stage ${sidePanelsHidden ? 'chrome-hidden' : timelineOpen ? 'with-timeline' : 'timeline-collapsed-pad'}`}>
            <div className="canvas-top-left"><span className="canvas-live-dot" /> LIVE 3D PREVIEW <span className="canvas-top-split" /> <span>{animPlaying ? 'Playing' : project.compositionMode === 'split' ? 'iOS + Android' : 'Interactive'}</span></div>
            <div className="canvas-top-right">
              <div className="composition-toggle">
                <button type="button" className={project.compositionMode === 'single' ? 'active' : ''} onClick={enableSingleComposition}>Single</button>
                <button type="button" className={project.compositionMode === 'split' ? 'active' : ''} onClick={enableSplitComposition}><Columns2 size={13} /> iOS + Android</button>
              </div>
              <button
                type="button"
                className={`canvas-round-button ${timelineOpen ? 'is-active' : ''}`}
                title="Animation timeline"
                aria-label="Toggle animation timeline"
                onClick={toggleTimeline}
              >
                <Gauge size={16} />
              </button>
              <span className="device-tag"><Smartphone size={14} /> {project.compositionMode === 'split' ? 'Split composition' : getDevice(project.deviceId).label}</span>
              <button className="canvas-round-button" title="Reset camera and rotation" aria-label="Reset camera" onClick={resetDevice}><RotateCcw size={16} /></button>
            </div>
            <div className={`canvas-render ${project.background === 'transparent' ? 'transparent-grid' : ''}`}>
              <DeviceCanvas
                project={displayProject}
                captureRef={captureRef}
                gizmoMode={gizmoMode}
                onSelectDevice={onSelectDevice}
                onClearSelection={() => setDeviceMenu(null)}
                onRotateDevice={onRotateDevice}
                onMoveDevice={onMoveDevice}
              />
            </div>
            {project.compositionMode === 'split' && (
              <div className="split-labels">
                <span>iOS</span>
                <span>Android</span>
              </div>
            )}
            {deviceMenu && (
              <div className="device-action-menu" style={{ left: Math.min(deviceMenu.x, window.innerWidth - 240), top: Math.min(deviceMenu.y, window.innerHeight - 200) }}>
                <div className="device-action-hint">
                  {gizmoMode === 'rotate'
                    ? 'Drag rings to rotate · arrows move left / right / up / down'
                    : 'Drag arrows to move · rings still rotate'}
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
                <span>PNG, JPG, WebP · {screenSizeLabel(getDevice(project.deviceId).screenSize)}</span>
              </div>
            )}
            <div className={`canvas-bottom-controls ${timelineOpen ? 'with-timeline' : ''}`}>
              <div className="canvas-hint-row">
                <div className="gizmo-mode-toggle" role="group" aria-label="Device gizmo mode">
                  <button
                    type="button"
                    className={gizmoMode === 'rotate' ? 'active' : ''}
                    title="Rotate device"
                    aria-pressed={gizmoMode === 'rotate'}
                    onClick={() => setGizmoMode('rotate')}
                  >
                    <Rotate3D size={14} /> Rotate
                  </button>
                  <button
                    type="button"
                    className={gizmoMode === 'translate' ? 'active' : ''}
                    title="Move device left / right / up / down"
                    aria-pressed={gizmoMode === 'translate'}
                    onClick={() => setGizmoMode('translate')}
                  >
                    <Move size={14} /> Move
                  </button>
                </div>
                <div className="canvas-hint">
                  <MousePointer2 size={14} />
                  {gizmoMode === 'rotate' ? 'Rings rotate · arrows move' : 'Arrows move · rings rotate'}
                  <span>·</span> Hold Space + drag to pan
                </div>
              </div>
              <div className="view-buttons">
                <button onClick={() => updateProject({ cameraView: 'front' })} className={project.cameraView === 'front' ? 'active' : ''}>Front</button>
                <button onClick={() => updateProject({ cameraView: 'left' })} className={project.cameraView === 'left' ? 'active' : ''}>Left</button>
                <button onClick={() => updateProject({ cameraView: 'right' })} className={project.cameraView === 'right' ? 'active' : ''}>Right</button>
                <button onClick={() => updateProject({ cameraView: 'top' })} className={project.cameraView === 'top' ? 'active' : ''}>Top</button>
              </div>
            </div>
            <div className="canvas-watermark"><Aperture size={16} /> Mockup Studio</div>
          </div>
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
          />
        </main>

        <aside className="right-panel" aria-hidden={sidePanelsHidden}>
          <div className="inspector-scroll">
            <SettingsSection id="device" title="Device" icon={Smartphone} trailing="01" open={!!openSections.device} onToggle={toggleSection}>
              <button
                type="button"
                className={`split-launch ${project.compositionMode === 'split' ? 'is-active' : ''}`}
                onClick={() => (project.compositionMode === 'split' ? enableSingleComposition() : enableSplitComposition())}
              >
                <Columns2 size={16} />
                <div>
                  <strong>{project.compositionMode === 'split' ? 'Split mode on' : 'Quick iOS + Android'}</strong>
                  <span>{project.compositionMode === 'split' ? 'Tap to return to a single device' : 'Generate both platforms side by side'}</span>
                </div>
              </button>
              <div className="device-list">
                {DEVICE_MODELS.map((device) => (
                  <button
                    key={device.id}
                    type="button"
                    className={`device-picker ${project.deviceId === device.id ? 'is-selected' : ''}`}
                    disabled={project.compositionMode === 'split'}
                    title={`${device.subtitle} · ${screenSizeLabel(device.screenSize)}`}
                    onClick={() => {
                      patchSelectedDevice({ deviceId: device.id });
                      if (isPlaceholderScreenshot(project.screenshot)) {
                        updateProject({ screenshot: placeholderForDevice(device) });
                      }
                    }}
                  >
                    <div className="device-picker-icon"><Smartphone size={16} strokeWidth={1.7} /></div>
                    <div className="device-picker-copy">
                      <strong>{device.label}</strong>
                      <span className="device-picker-meta">
                        <span>{device.platform === 'ios' ? 'iOS' : 'Android'}</span>
                        <span aria-hidden>·</span>
                        <span className="device-size-hint">{screenSizeLabel(device.screenSize)}</span>
                      </span>
                    </div>
                    {project.deviceId === device.id && <Check size={13} className="device-selected" />}
                  </button>
                ))}
              </div>
              <button className="button full-outline compact" onClick={() => { setLeftTab('assets'); imageInputRef.current?.click(); }}><ImagePlus size={14} /> Replace screenshot</button>
            </SettingsSection>

            <SettingsSection id="transform" title="Transform" icon={Rotate3D} open={!!openSections.transform} onToggle={toggleSection}>
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

            <SettingsSection id="environment" title="Environment" icon={Aperture} open={!!openSections.environment} onToggle={toggleSection}>
              <div className="field-caption">BACKGROUND</div>
              <div className="background-options wrap-options">
                {allScenes.map((item) => (
                  <button key={item.id}
                    className={`background-swatch ${BACKGROUNDS.some((b) => b.id === item.id) ? `bg-${item.id}` : ''} ${project.background === item.id ? 'selected' : ''}`}
                    style={swatchStyle(item)}
                    title={item.label} aria-label={`${item.label} background`} onClick={() => chooseScene(item)}>
                    {project.background === item.id && <Check size={15} />}
                  </button>
                ))}
                {project.background === 'custom' && (
                  <button type="button" className="background-swatch selected" style={{ background: gradientCss(project.gradientColors) }}
                    title="Custom gradient" aria-label="Custom gradient">
                    <Check size={15} />
                  </button>
                )}
              </div>
              <div className="selection-label">{activeScene.label} <ChevronDown size={13}/></div>

              {!isTransparent && (
                <>
                  <div className="field-caption">GRADIENT COLOURS</div>
                  <div className="gradient-color-grid">
                    {([
                      ['center', 'Center'],
                      ['mid', 'Mid'],
                      ['edge', 'Edge'],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="gradient-color-field">
                        <span>{label}</span>
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
                  <div className="gradient-preview" style={{ background: gradientCss(project.gradientColors) }} aria-hidden />
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
                    <button type="button" className="text-button" onClick={() => setSavingPreset(true)}>
                      <Save size={13} /> Save as preset
                    </button>
                  )}
                </>
              )}

              <div className="field-caption" style={{ marginTop: 14 }}>REFLECTION MAP</div>
              <p className="field-help">Chrome-ball preview of what glass samples — pick a map or upload your own.</p>
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

              <div className="field-caption" style={{ marginTop: 14 }}>LIGHTING</div>
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
              <div className="field-caption" style={{ marginTop: 4 }}>SHADOWS</div>
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
              <button
                type="button"
                className="text-button"
                onClick={() => updateProject({
                  lightIntensity: DEFAULT_PROJECT.lightIntensity,
                  fillIntensity: DEFAULT_PROJECT.fillIntensity,
                  shadowSoftness: DEFAULT_PROJECT.shadowSoftness,
                  shadowOpacity: DEFAULT_PROJECT.shadowOpacity,
                })}
              >
                <Sun size={13} /> Reset lighting & shadows
              </button>
            </SettingsSection>

            <SettingsSection id="camera" title="Camera presets" icon={Settings2} open={!!openSections.camera} onToggle={toggleSection} last>
              <div className="camera-preset-grid">
                {(['front', 'left', 'right', 'top'] as CameraView[]).map((view) => (
                  <button key={view} onClick={() => updateProject({ cameraView: view })}
                    className={project.cameraView === view ? 'selected' : ''}>{view[0].toUpperCase() + view.slice(1)}</button>
                ))}
              </div>
            </SettingsSection>
          </div>
          <div className="inspector-footer"><div className="export-callout"><div><strong>Ready to share?</strong><span>Export a crisp, high-res image.</span></div><Maximize size={17} /></div>
            <button className="button primary-button inspector-export" onClick={() => setExportOpen(true)}><Download size={16} /> Export mockup <span>⌘ E</span></button>
          </div>
        </aside>
      </div>
      )}

      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onImageChange} />
      <input ref={projectInputRef} type="file" accept=".json,.mockup.json,application/json" hidden onChange={(e) => { void onProjectFile(e); }} />

      {hasOpenProject && exportOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !exporting) setExportOpen(false); }}>
          <div className="export-modal export-modal-wide" role="dialog" aria-modal="true" aria-labelledby="export-title">
            <div className="modal-head"><div className="modal-icon"><Download size={21} /></div>
              <button className="modal-close" aria-label="Close export settings" onClick={() => setExportOpen(false)} disabled={exporting}><X size={19} /></button></div>
            <h2 id="export-title">Export your masterpiece</h2>
            <p>{isStillExport(exportKind)
              ? (project.compositionMode === 'split'
                ? `Export a combined split mockup, or generate separate iOS and Android ${stillFormatById(exportKind).label}s.`
                : 'Choose a size. We’ll render your scene as a high-resolution still.')
              : `Renders your timeline (${animation.duration.toFixed(1)}s · ${animation.fps} fps) into ${videoFormatById(exportKind).label}.`}</p>

            <div className="modal-field-label">FORMAT</div>
            <div className="export-format-grid export-format-grid-5">
              {STILL_FORMATS.map((item) => (
                <button key={item.id} type="button" className={`export-format ${exportKind === item.id ? 'selected' : ''}`}
                  disabled={exporting} onClick={() => setExportKind(item.id)} title={item.description}>
                  <FileImage size={16} />
                  <strong>{item.label}</strong>
                  <span>{item.description.split('·')[0].trim()}</span>
                </button>
              ))}
              {VIDEO_FORMATS.map((item) => (
                <button key={item.id} type="button" className={`export-format ${exportKind === item.id ? 'selected' : ''}`}
                  disabled={exporting} onClick={() => setExportKind(item.id)} title={item.description}>
                  <Film size={16} />
                  <strong>{item.label}</strong>
                  <span>{item.description.split('·')[0].trim()}</span>
                </button>
              ))}
            </div>

            {isStillExport(exportKind) && project.compositionMode === 'split' && (
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

            <div className="modal-field-label">ASPECT <span>{EXPORT_ASPECTS.find((a) => a.id === exportAspect)?.hint}</span></div>
            <div className="export-aspect-grid">
              {EXPORT_ASPECTS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`export-aspect ${exportAspect === item.id ? 'selected' : ''}`}
                  disabled={exporting}
                  onClick={() => {
                    setExportAspect(item.id);
                    if (item.id === 'appstore') {
                      setExportResolution('native');
                      setCustomExportSize({ width: 1290, height: 2796 });
                    } else if (item.id === 'custom') {
                      setExportResolution('custom');
                    } else if (exportResolution === 'native' || exportResolution === 'custom') {
                      setExportResolution('fhd');
                    }
                  }}
                >
                  <div className={`export-ratio export-ratio-${item.id}`} />
                  <strong>{item.label}</strong>
                  <span>{item.hint}</span>
                </button>
              ))}
            </div>

            <div className="modal-field-label">RESOLUTION <span>{resolveExportSize().label} px</span></div>
            <div className="export-resolution-row" role="group" aria-label="Output resolution">
              {availableResolutions.map((item) => {
                const preview = resolveExportDimensions(
                  exportAspect,
                  item.id,
                  item.id === 'custom' ? customExportSize : undefined,
                );
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`export-resolution ${exportResolution === item.id ? 'selected' : ''}`}
                    disabled={exporting}
                    title={`${preview.width} × ${preview.height}`}
                    onClick={() => {
                      setExportResolution(item.id);
                      if (item.id !== 'custom' && item.id !== 'native') {
                        setCustomExportSize({ width: preview.width, height: preview.height });
                      }
                    }}
                  >
                    <strong>{item.label}</strong>
                    <span>{item.id === 'custom' || item.id === 'native' ? item.detail : `${preview.width}×${preview.height}`}</span>
                  </button>
                );
              })}
            </div>

            {(exportAspect === 'custom' || exportResolution === 'custom') && (
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
            {isVideoExport(exportKind) && !hasAnimation(animation) && (
              <p className="export-warning">Add keyframes on the timeline before exporting video or GIF.</p>
            )}
            {exportProgress && <p className="export-progress">{exportProgress}</p>}
            <div className="export-modal-actions"><button className="button subtle-button" disabled={exporting} onClick={() => setExportOpen(false)}>Cancel</button>
              <button
                className="button primary-button"
                disabled={exporting || (isVideoExport(exportKind) && !hasAnimation(animation))}
                onClick={() => void runExport()}
              >
                <ArrowDownToLine size={16} />
                {exporting
                  ? (exportProgress || 'Rendering…')
                  : isStillExport(exportKind)
                    ? (project.compositionMode === 'split' && exportMode === 'separate'
                      ? `Export both ${stillFormatById(exportKind).label}s`
                      : `Export ${stillFormatById(exportKind).label}`)
                    : `Export ${videoFormatById(exportKind).label}`}
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
      {toast && <div className="toast"><span className="toast-dot" /> {toast}<button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={14} /></button></div>}
    </div>
  );
}
