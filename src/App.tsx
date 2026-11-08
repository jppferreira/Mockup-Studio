import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type DragEvent, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal, flushSync } from 'react-dom';
import {
  Aperture, ArrowDownToLine, ArrowLeftRight, ArrowUpDown, Box, Camera, Check, ChevronDown, Circle, CircleOff, Cuboid,
  Cone, Cylinder, Disc, Disc3, Dna, Film, Frame, Hand, Landmark, MessageSquare, Mountain, MoveHorizontal, MousePointer2, PenTool, Pyramid,
  RectangleHorizontal, Square, Theater, Torus, Triangle, Type, ZoomIn,
  ClipboardPaste, Columns2, Command, Copy, Download, FileImage, FlipHorizontal2, Gauge, Glasses, Headphones,
  ImagePlus, KeyRound, Laptop, Layers3, LayoutGrid, LayoutTemplate, MessageSquarePlus, Minus,
  Menu, Monitor, MonitorSmartphone, MoreHorizontal, Orbit, PanelLeftClose, PanelLeftOpen,
  Plus, Presentation, RefreshCw, RotateCcw, Rotate3D, RotateCw, Save, Settings2, SlidersHorizontal, Smartphone, Sparkles, Sun, Tablet, Trash2, Upload, UserRound, Watch, Waves, Wrench, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import AccentThemePicker from './components/AccentThemePicker';
import AnimationTimeline from './components/AnimationTimeline';
import ViewAxisGizmo from './components/ViewAxisGizmo';
import CloudSyncPanel, { type CloudTarget } from './components/CloudSyncPanel';
import ProjectsDashboard from './components/ProjectsDashboard';
import ChangeLogPanel from './components/ChangeLogPanel';
import CompositionSwitcher from './components/CompositionSwitcher';
import SceneHierarchy, { sameLayerSelection, type SceneLayerSelection } from './components/SceneHierarchy';
import TemplateThumb, { TemplateThumbHost } from './components/TemplateThumb';
import CropFocusOverlay from './components/CropFocusOverlay';
import CustomDevicePanel, { type CustomDevicePanelHandle } from './components/CustomDevicePanel';
import DeviceCanvas, { type CaptureApi, type DeviceSelectPayload, type MaterialPickPayload, type ViewGesture } from './components/DeviceCanvas';
import { type AnnotationMark } from './components/ModelAnnotations';
import DualCanvasLayout from './components/DualCanvasLayout';
import FeedbackModal from './components/FeedbackModal';
import FigmaExploreModal from './components/FigmaExploreModal';
import LicenseModal from './components/LicenseModal';
import UpdateBanner from './components/UpdateBanner';
import SvgExplodeModal from './components/SvgExplodeModal';
import ProgressiveBlurOverlay from './components/ProgressiveBlurOverlay';
import LightDirectionControl from './components/LightDirectionControl';
import ModelingModePanel, { type PickedMaterial, type StudioSetFocus } from './components/ModelingModePanel';
import {
  propExtrusion,
  propFootprintScale,
  withPropExtrusion,
  withPropFootprintScale,
} from './lib/propTransform';
import ReflectionMapPicker from './components/ReflectionMapPicker';
import {
  hydrateCustomDeviceUrls,
  importCustomDevices,
  loadCustomDeviceMeta,
  subscribeCustomDevices,
  updateCustomDeviceMeta,
  type CustomDeviceMeta,
} from './lib/customDevices';
import { tweakFromPreset, type MaterialPresetId } from './lib/materialPresets';
import {
  isDevToolsetAvailable,
  loadWorkspaceToolset,
  saveWorkspaceToolset,
  type WorkspaceToolset,
} from './lib/modelingMode';
import {
  createBlankShippedTemplate,
  deleteShippedTemplate,
  duplicateShippedTemplate,
  prepareShippedFromProject,
  renameShippedTemplate,
  shipCompositionTemplate,
  subscribeRuntimePromoted,
} from './lib/shippedTemplates';
import { collectDroppedFiles, meshDropOffer, type MeshDropOffer } from './lib/meshBundle';
import { isPlaceholderScreenshot, placeholderForDevice } from './lib/demo';
import { TONE_CLAY } from './lib/referenceTones';
import { recordProjectChange, type ChangeLogEntry } from './lib/changeLog';
import { bindScrollMore, pinToContainerTop, releasePinPadding } from './lib/scrollMore';
import {
  defaultCameraPosition, evaluateAnimation, evaluateCamera, hasAnimation, hasCameraAnimation,
  upsertKeyframe,
} from './lib/animation';
import { applyAnimationPreset, getAnimationPreset, shiftDeviceRotation } from './lib/animationPresets';
import { STUDIO_POSES, getStudioPose, studioPoseIdFor } from './lib/studioPoses';
import { resolveStudioPreset, STUDIO_START_POSITION, STUDIO_START_ROTATION } from './lib/studioEnvironment';
import {
  DEVICE_CATEGORY_ICON,
  DEVICE_CATEGORY_TABS,
  DEVICE_MODELS,
  categoryOfDevice,
  filterDevicesByCategory,
  getDevice,
  isCustomDeviceId,
  listAllDevices,
  screenSizeLabel,
  type DeviceCategoryFilter,
  type DeviceCategoryIconKey,
  type DeviceModel,
} from './lib/devices';

const DEVICE_CATEGORY_LUCIDE: Record<DeviceCategoryIconKey, LucideIcon> = {
  'layout-grid': LayoutGrid,
  smartphone: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
  monitor: Monitor,
  watch: Watch,
  headphones: Headphones,
  glasses: Glasses,
};
import { createOverlay, drawOverlays, flatShapeOf, overlayVisibleAt, pathOffsets, type FlatShape, type SceneOverlay } from './lib/overlays';
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
  LICENSING_DISABLED,
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
import {
  canonicalProjectJson, isPathInsideLibrary, projectFromCloudRow, syncButtonLabel,
  type CloudLibraryStatus, type CloudProjectEntry,
} from './lib/cloudLibrary';
import { downloadBlob, safeFilename, validateProject } from './lib/project';
import {
  encodeMockupFile, isProjectFileName, mockupDownloadName, MOCKUP_MIME, readProjectFileContents,
} from './lib/projectFile';
import {
  hydrateRecentScreenshots, loadRecentScreenshots, recentForPlatform, rememberRecentScreenshot,
  type RecentScreenshot,
} from './lib/recentScreenshots';
import {
  applyDeviceToPlatform, applyFinishToPlatform, applyFinishToPublishEnv,
  applyLinkedTransformsAfterAnim, applyScreenToDevice, applyScreenToPublishEnv,
  buildPlatformSplitDevices, copyScreenToOtherPlatform, deviceFinish, deviceScreenMedia,
  getPlatformDevice, getPublishEnvDevice, mirrorLinkedTransforms, platformOfDevice,
  projectForEnvCanvas, refreshSplitPlaceholders, resolvePublishTarget, setPublishTarget,
} from './lib/platformEnv';
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
  hydrateRecentProjects, loadRecentProjects, rememberRecentProject, removeRecentProject,
  type RecentProjectEntry,
} from './lib/recentProjects';
import {
  isDocumentReload, loadSessionWorkspace, sanitizeSessionFrameSize, saveSessionWorkspace,
  type SessionFrameSize,
} from './lib/sessionWorkspace';
import { PROMPT_SUGGESTIONS } from './lib/promptAnimate';
import {
  REFLECTION_STYLES,
  amountForReflectionStyle,
  reflectionStyleForAmount,
  type ReflectionStyle,
} from './lib/reflectionStyle';
import { promptToAnimationSmart } from './lib/promptAnimateLocal';
import { deleteCustomScenePreset, loadCustomScenePresets, saveCustomScenePreset } from './lib/scenePresets';
import {
  canonicalTemplatesJson, copyTemplateToSaved, deleteSavedAngle, deleteSavedComposition, deleteSavedSize,
  duplicateSavedComposition, formatBuiltinCompositionSource,
  loadSavedAngles, loadSavedCompositions, loadSavedSizes,
  mergeSavedCompositions, parseTemplatesLibrary, renameSavedComposition, replaceSavedCompositions,
  saveAngle, saveAssetSize, saveComposition, serializeTemplatesLibrary,
  type SavedAngle, type SavedAssetSize,
} from './lib/userLibrary';
import {
  applyCompositionKeepingDevices, getCompositionTemplate, isDevEditableTemplateId, projectFromTemplate, templatesByCategory,
  type CompositionTemplate, type TemplateCategory,
} from './lib/templates';
import {
  BACKGROUNDS, CAMERA_LENSES, CAMERA_TARGET_ID, DEFAULT_PROJECT, DEVICE_COLORS,
  EXPORT_ASPECTS, EXPORT_ASPECT_GROUPS, EXPORT_FPS_OPTIONS, EXPORT_RESOLUTIONS,
  EXPORT_SIZE_LIMITS, MAX_COMPOSITION_SCENES, MAX_DEVICES, MAX_SCENE_LIGHTS, SHADOW_QUALITIES,
  exportAspectFixedSize, exportAspectHasFixed,
  resolveExportDimensions, addCompositionScene, commitActiveScene, createDefaultAnimation,
  createDeviceInstance, createSceneLight, createSceneProp, duplicateCompositionScene, ensureCompositionScenes, getSelectedDevice,
  patchActiveCompositionScene, removeCompositionScene, renameCompositionScene,
  switchCompositionScene, syncProjectFromActiveScene, syncProjectFromSelected,
  type AnimProperty, type BackgroundPreset, type CameraView, type DeviceColor, type ExportAspectId,
  type ExportResolutionId, type GradientColors, type MaterialTweak, type MockupProject, type PublishTarget,
  type ReflectionMapSetting, type SceneLight, type ScenePreset, type SceneProp, type ScenePropKind,
  type ShadowType, type Vec3,
} from './types';

/** Top-left pinned tabs: scene objects vs Assets library. */
type LeftWorkspaceTab = 'scenes' | 'assets' | 'log';
type Workspace = { tabs: ProjectTab[]; activeId: string | null };
type ExportScale = 0.5 | 1 | 2 | 3 | 4;
type ExportMediaMode = 'static' | 'animated';
type ExportEntry = { id: string; kind: ExportKind; scale: ExportScale };
type CanvasTool = 'composition' | 'animate' | 'type' | 'comments' | 'pen';

const EXPORT_SCALES: ExportScale[] = [0.5, 1, 2, 3, 4];

const FLAT_SHAPES: { id: FlatShape; label: string; icon: LucideIcon }[] = [
  { id: 'rect', label: 'Rectangle', icon: Square },
  { id: 'ellipse', label: 'Ellipse', icon: Circle },
  { id: 'triangle', label: 'Triangle', icon: Triangle },
];

const VIEW_GESTURES: { id: ViewGesture; label: string; icon: LucideIcon }[] = [
  { id: 'pan', label: 'Pan', icon: Hand },
  { id: 'zoom', label: 'Pinch to zoom', icon: ZoomIn },
  { id: 'rotate', label: 'Rotate', icon: RotateCw },
  { id: 'longpress', label: 'Long-press', icon: MousePointer2 },
  { id: 'swipe', label: 'Swipe', icon: MoveHorizontal },
];

const INSERT_SHAPES: { kind: ScenePropKind; label: string; icon: LucideIcon }[] = [
  { kind: 'clay_cube', label: 'Cube', icon: Box },
  { kind: 'clay_sphere', label: 'Sphere', icon: Circle },
  { kind: 'clay_cylinder', label: 'Cylinder', icon: Cylinder },
  { kind: 'clay_torus', label: 'Torus', icon: Torus },
  { kind: 'clay_helix', label: 'Helix', icon: Dna },
  { kind: 'clay_cone', label: 'Cone', icon: Cone },
  { kind: 'clay_pyramid', label: 'Pyramid', icon: Pyramid },
];

/**
 * Stage tool: what sits under the device. One stage at a time — picking another
 * swaps the floor piece. `none` is a bare canvas, `floor` is the built-in soft disc,
 * the rest are scene props placed at floor level.
 */
type StageType = 'none' | 'floor' | 'stage' | 'backdrop' | 'pedestal' | 'plinth' | 'slab' | 'disc' | 'rock';
type StageTypeOption = {
  id: StageType;
  label: string;
  hint: string;
  icon: LucideIcon;
  prop?: Partial<SceneProp> & { kind: ScenePropKind };
};

const STAGE_TYPES: StageTypeOption[] = [
  { id: 'none', label: 'Empty', hint: 'Nothing under the device', icon: CircleOff },
  { id: 'floor', label: 'Floor plate', hint: 'Soft disc under the device', icon: Disc },
  {
    id: 'stage', label: 'Stage', hint: 'Round show stage', icon: Theater,
    prop: { kind: 'stage', position: { x: 0, y: -1.55, z: 0.02 }, scale: 1, color: '#2c2926' },
  },
  {
    id: 'backdrop', label: 'Cyclorama', hint: 'Seamless studio sweep', icon: Frame,
    prop: { kind: 'studio_backdrop', position: { x: 0, y: -1.55, z: 0 }, scale: 1, color: '#ffffff' },
  },
  {
    id: 'pedestal', label: 'Pedestal', hint: 'Tall display column', icon: Landmark,
    prop: { kind: 'pedestal', position: { x: 0, y: -1.45, z: 0 }, rotation: { x: 0, y: 12, z: 0 }, scale: 1 },
  },
  {
    id: 'plinth', label: 'Stone plinth', hint: 'Low stone block', icon: Cuboid,
    prop: { kind: 'stone_plinth', position: { x: 0, y: -1.28, z: 0 }, rotation: { x: 0, y: 16, z: 0 }, scale: 1, color: '#6e6a62' },
  },
  {
    id: 'slab', label: 'Concrete slab', hint: 'Flat concrete floor', icon: RectangleHorizontal,
    prop: { kind: 'concrete_slab', position: { x: 0, y: -1.58, z: 0 }, scale: 0.95 },
  },
  {
    id: 'disc', label: 'Metal disc', hint: 'Brushed metal plate', icon: Disc3,
    prop: { kind: 'metal_disc', position: { x: 0, y: -1.5, z: 0.05 }, scale: { x: 1.15, y: 1, z: 1.15 }, color: '#d5d8de' },
  },
  {
    id: 'rock', label: 'Rock', hint: 'Natural stone base', icon: Mountain,
    prop: { kind: 'rock', position: { x: 0, y: -1.55, z: 0 }, scale: 1.1, color: '#7d776e' },
  },
];
/** Prop kinds the Stage tool owns; switching stage type replaces these and leaves other shapes alone. */
const STAGE_PROP_KINDS = new Set<ScenePropKind>(STAGE_TYPES.flatMap((type) => (type.prop ? [type.prop.kind] : [])));

/** Which stage type a composition is currently showing. */
function stageTypeOf(project: MockupProject): StageType {
  const stageProp = (project.sceneProps ?? []).find((prop) => STAGE_PROP_KINDS.has(prop.kind));
  if (stageProp) return STAGE_TYPES.find((type) => type.prop?.kind === stageProp.kind)?.id ?? 'none';
  return project.showGroundBase !== false ? 'floor' : 'none';
}
const CANVAS_HINT_KEY = 'mockup-studio.canvas-usage-hint-seen';

function canvasHintAlreadySeen() {
  try {
    return localStorage.getItem(CANVAS_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

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

const EMPTY_WORKSPACE: Workspace = { tabs: [], activeId: null };

function commentNumber(overlays: SceneOverlay[] | undefined, id: string) {
  const index = (overlays ?? []).filter((item) => item.kind === 'comment').findIndex((item) => item.id === id);
  return index < 0 ? 1 : index + 1;
}

function SliderField({ label, value, min, max, step = 1, unit = '°', onChange }: {
  label: string; value: number; min: number; max: number; step?: number;
  unit?: string; onChange: (v: number) => void;
}) {
  const span = max - min || 1;
  const fill = Math.min(100, Math.max(0, ((value - min) / span) * 100));
  const digits = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return (
    <label className="slider-field">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--slider-fill' as string]: `${fill}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="slider-number" data-scrub title="Drag left or right to adjust. Shift for finer steps.">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value.toFixed(digits)}
          aria-label={label}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (!Number.isFinite(next)) return;
            onChange(Math.min(max, Math.max(min, next)));
          }}
        />
        {unit ? <span className="slider-number-unit">{unit}</span> : null}
      </span>
    </label>
  );
}

function AxisInputs({ label, axes, onChange }: {
  label: string;
  axes: { key: 'x' | 'y' | 'z'; min: number; max: number; value: number }[];
  onChange: (axis: 'x' | 'y' | 'z', value: number) => void;
}) {
  return (
    <div className="axis-inputs">
      <span className="slider-label">{label}</span>
      <div className="axis-inputs-fields">
        {axes.map((axis) => (
          <label key={axis.key} className="axis-input">
            <span>{axis.key.toUpperCase()}</span>
            <input
              type="number"
              min={axis.min}
              max={axis.max}
              step={0.01}
              value={Number.isFinite(axis.value) ? axis.value.toFixed(2) : '0.00'}
              aria-label={`${label} ${axis.key.toUpperCase()}`}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isFinite(next)) return;
                onChange(axis.key, Math.min(axis.max, Math.max(axis.min, next)));
              }}
            />
          </label>
        ))}
      </div>
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
  id, title, hint, icon: Icon, trailing, open, onToggle, children, last = false,
}: {
  id: string;
  title: string;
  hint?: string;
  icon: typeof Box;
  trailing?: string;
  open: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
  last?: boolean;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    const el = sectionRef.current;
    const becameOpen = open && !wasOpen.current;
    wasOpen.current = open;
    if (!el) return undefined;
    if (!open) {
      releasePinPadding(el);
      return undefined;
    }
    if (!becameOpen) return undefined;
    return pinToContainerTop(el);
  }, [open]);
  return (
    <section ref={sectionRef} className={`settings-section ${last ? 'last-section' : ''} ${open ? 'is-open' : 'is-collapsed'}`}>
      <button
        type="button"
        className="section-heading section-toggle"
        aria-expanded={open}
        aria-controls={`settings-${id}`}
        onClick={(event) => {
          if (!open) {
            const section = event.currentTarget.closest('section');
            if (section instanceof HTMLElement) pinToContainerTop(section);
          }
          onToggle(id);
        }}
      >
        <div className="section-heading-left">
          <Icon size={16} strokeWidth={1.8} aria-hidden />
          <span className="section-heading-copy">
            <span className="section-heading-title">{title}</span>
            {hint ? <span className="section-heading-hint">{hint}</span> : null}
          </span>
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

function DeviceCategoryBar({
  value,
  onChange,
}: {
  value: DeviceCategoryFilter;
  onChange: (id: DeviceCategoryFilter) => void;
}) {
  return (
    <div className="device-category-bar" role="tablist" aria-label="Device categories">
      {DEVICE_CATEGORY_TABS.map((tab) => {
        const active = value === tab.id;
        const Icon = DEVICE_CATEGORY_LUCIDE[DEVICE_CATEGORY_ICON[tab.id]];
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`device-category-tab ${active ? 'is-active' : ''}`}
            title={tab.label}
            onClick={() => onChange(tab.id)}
          >
            <Icon size={14} strokeWidth={1.8} aria-hidden />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function FinishDots({
  ariaLabel,
  color,
  clayMode,
  onPick,
}: {
  ariaLabel: string;
  color: DeviceColor;
  clayMode: boolean;
  onPick: (color: DeviceColor) => void;
}) {
  return (
    <div className="device-finish-grid" role="group" aria-label={ariaLabel}>
      {DEVICE_COLORS.map((swatch) => {
        const selected = color === swatch.id || (swatch.id === 'clay' && clayMode);
        return (
          <button
            key={swatch.id}
            type="button"
            className={`device-finish-swatch ${selected ? 'selected' : ''}`}
            title={swatch.label}
            aria-label={swatch.label}
            aria-pressed={selected}
            onClick={() => onPick(swatch.id)}
          >
            <span style={{ background: swatch.hex }} />
          </button>
        );
      })}
    </div>
  );
}

function DeviceMenuOptions({
  devices,
  grouped,
  isSelected,
  isUnlocked,
  onPick,
}: {
  devices: DeviceModel[];
  grouped: boolean;
  isSelected: (id: string) => boolean;
  isUnlocked: (id: string) => boolean;
  onPick: (device: DeviceModel, unlocked: boolean) => void;
}) {
  const renderOption = (device: DeviceModel) => {
    const unlocked = isUnlocked(device.id);
    const selected = isSelected(device.id);
    return (
      <button
        key={device.id}
        type="button"
        role="option"
        aria-selected={selected}
        className={`device-dropdown-option ${selected ? 'is-selected' : ''} ${unlocked ? '' : 'is-locked'}`}
        title={unlocked
          ? `${device.subtitle} · ${screenSizeLabel(device.screenSize)}`
          : `Pro ${formatGbp(PLAN_PRICES_GBP.pro)} — unlock full device library`}
        onClick={() => onPick(device, unlocked)}
      >
        <span className="device-dropdown-name">{device.label}</span>
        {selected ? <Check size={13} /> : !unlocked ? <span className="device-dropdown-pro">Pro</span> : null}
      </button>
    );
  };

  if (!grouped) return <>{devices.map(renderOption)}</>;

  const buckets = new Map<string, DeviceModel[]>();
  for (const device of devices) {
    const id = categoryOfDevice(device);
    const list = buckets.get(id);
    if (list) list.push(device);
    else buckets.set(id, [device]);
  }
  const groups = DEVICE_CATEGORY_TABS.filter((tab) => tab.id !== 'all' && buckets.has(tab.id));
  if (groups.length <= 1) return <>{devices.map(renderOption)}</>;

  return (
    <>
      {groups.map((tab) => (
        <div key={tab.id} className="device-dropdown-group" role="group" aria-label={tab.label}>
          <div className="device-dropdown-group-label">{tab.label}</div>
          {buckets.get(tab.id)!.map(renderOption)}
        </div>
      ))}
    </>
  );
}

function frameMeta(id: string, sizes: SavedAssetSize[]) {
  const builtin = EXPORT_ASPECTS.find((item) => item.id === id);
  if (builtin) {
    return {
      label: builtin.label,
      shortLabel: builtin.shortLabel,
      hint: builtin.hint,
      ratio: builtin.ratio,
    };
  }
  const saved = sizes.find((item) => item.id === id);
  if (!saved) return null;
  return {
    label: saved.label,
    shortLabel: saved.label,
    hint: `${saved.width}×${saved.height}`,
    ratio: saved.width / Math.max(1, saved.height),
  };
}

function exportRatioThumbStyle(ratio: number, max = 34): CSSProperties {
  if (ratio >= 1) {
    return { width: max, height: Math.max(10, Math.round(max / ratio)) };
  }
  return { width: Math.max(10, Math.round(max * ratio)), height: max };
}

type FloatingMenuBox = {
  top: number | 'auto';
  bottom: number | 'auto';
  left: number;
  width: number;
  maxHeight: number;
};

/** Place a menu beside an anchor so panel overflow cannot clip it. */
function measureFloatingMenu(anchor: HTMLElement): FloatingMenuBox {
  const rect = anchor.getBoundingClientRect();
  const gap = 6;
  const margin = 12;
  const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - margin);
  const spaceAbove = Math.max(0, rect.top - gap - margin);
  const openBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(140, Math.min(440, openBelow ? spaceBelow : spaceAbove));
  if (openBelow) {
    return {
      top: rect.bottom + gap,
      bottom: 'auto',
      left: rect.left,
      width: rect.width,
      maxHeight,
    };
  }
  return {
    top: 'auto',
    bottom: window.innerHeight - rect.top + gap,
    left: rect.left,
    width: rect.width,
    maxHeight,
  };
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE);
  const [customPresets, setCustomPresets] = useState<ScenePreset[]>(() => loadCustomScenePresets());
  const [savedSizes, setSavedSizes] = useState<SavedAssetSize[]>(() => loadSavedSizes());
  const [savedAngles, setSavedAngles] = useState<SavedAngle[]>(() => loadSavedAngles());
  const [savedCompositions, setSavedCompositions] = useState<CompositionTemplate[]>(() => loadSavedCompositions());
  const [sizeName, setSizeName] = useState('');
  const [sizeDraft, setSizeDraft] = useState({ width: 1080, height: 1920 });
  const [angleName, setAngleName] = useState('');
  const [compositionName, setCompositionName] = useState('');
  const [compositionPick, setCompositionPick] = useState<{ tabId: string; templateId: string } | null>(null);
  const [customDevices, setCustomDevices] = useState<CustomDeviceMeta[]>(() => loadCustomDeviceMeta());
  const [devicesTick, setDevicesTick] = useState(0);
  const [presetName, setPresetName] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const [leftWorkspaceTab, setLeftWorkspaceTab] = useState<LeftWorkspaceTab>('scenes');
  const [changeLogVersion, setChangeLogVersion] = useState(0);
  const changeLogsRef = useRef(new Map<string, ChangeLogEntry[]>());
  const liveProjectRef = useRef<MockupProject>(DEFAULT_PROJECT);
  const sessionReadyRef = useRef(false);
  const skipSessionRestoreRef = useRef(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [workspaceToolset, setWorkspaceToolset] = useState<WorkspaceToolset>(() => loadWorkspaceToolset());
  const [modelingPanelOpen, setModelingPanelOpen] = useState(true);
  const [pickedMaterial, setPickedMaterial] = useState<PickedMaterial | null>(null);
  const [studioSetFocus, setStudioSetFocus] = useState<StudioSetFocus>(null);
  const [templatesTick, setTemplatesTick] = useState(0);
  const toolsetSwitchAvailable = isDevToolsetAvailable();
  const isDeveloperToolset = toolsetSwitchAvailable && workspaceToolset === 'developer';

  const setToolset = (next: WorkspaceToolset) => {
    setWorkspaceToolset(next);
    saveWorkspaceToolset(next);
    if (next === 'developer') setModelingPanelOpen(true);
    if (next === 'user') {
      setPickedMaterial(null);
      setModelingPanelOpen(false);
    }
    notify(next === 'developer'
      ? 'Dev view — quick-edit templates, then Update shipped for User'
      : 'User view — templates as customers see them');
  };
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [figmaExploreOpen, setFigmaExploreOpen] = useState(false);
  const [figmaLinkDraft, setFigmaLinkDraft] = useState('');
  const [assetsDropActive, setAssetsDropActive] = useState(false);
  const [studioAiOpen, setStudioAiOpen] = useState(false);
  const [studioAiPrompt, setStudioAiPrompt] = useState('');
  const [studioAiStatus, setStudioAiStatus] = useState<string | null>(null);
  const [studioAiBusy, setStudioAiBusy] = useState(false);
  const studioAiInputRef = useRef<HTMLInputElement>(null);
  const studioAiShellRef = useRef<HTMLDivElement>(null);
  const [svgExplodeModel, setSvgExplodeModel] = useState<SvgDocumentModel | null>(null);
  const [license, setLicense] = useState<LicenseState>(() => loadLicense());
  useEffect(() => {
    if (LICENSING_DISABLED) setLicense(loadLicense());
  }, []);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateCategory, setTemplateCategory] = useState<TemplateCategory>('devices');
  /** Platforms queued for export. A new canvas starts on Custom, not a social preset. */
  const [exportAspectIds, setExportAspectIds] = useState<string[]>(['custom']);
  /** Live canvas crop. `free` is the custom-size canvas, with no platform frame. */
  const [previewFrame, setPreviewFrame] = useState<string>('free');
  const [exportResolution, setExportResolution] = useState<ExportResolutionId>('custom');
  const [customExportSize, setCustomExportSize] = useState({ width: 1080, height: 1920 });
  const frameSizeRef = useRef<SessionFrameSize>({
    exportAspectIds: ['custom'],
    previewFrame: 'free',
    exportResolution: 'custom',
    customExportSize: { width: 1080, height: 1920 },
  });
  frameSizeRef.current = {
    exportAspectIds,
    previewFrame,
    exportResolution,
    customExportSize,
  };
  const [exportMode, setExportMode] = useState<'combined' | 'separate'>('combined');
  const [exportMediaMode, setExportMediaMode] = useState<ExportMediaMode>('static');
  const [staticExportEntries, setStaticExportEntries] = useState<ExportEntry[]>(() => [createExportEntry('png')]);
  const [animatedExportEntries, setAnimatedExportEntries] = useState<ExportEntry[]>(() => [createExportEntry('mp4')]);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [meshOffer, setMeshOffer] = useState<MeshDropOffer | null>(null);
  const [meshExtracting, setMeshExtracting] = useState(false);
  const hoveredDeviceIdRef = useRef<string | null>(null);
  const [canvasHintVisible, setCanvasHintVisible] = useState(() => !canvasHintAlreadySeen());
  const dismissCanvasHint = useCallback(() => {
    setCanvasHintVisible(false);
    try {
      localStorage.setItem(CANVAS_HINT_KEY, '1');
    } catch {
      /* private mode */
    }
  }, []);
  const spacePannedRef = useRef(false);
  const noteSpacePan = useCallback(() => {
    spacePannedRef.current = true;
    dismissCanvasHint();
  }, [dismissCanvasHint]);
  const [toast, setToast] = useState<string | null>(null);
  const [deviceMenu, setDeviceMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [gizmoDragging, setGizmoDragging] = useState(false);
  /** When true, show the key-light translate handle in the 3D viewer. */
  const [lightGizmoActive, setLightGizmoActive] = useState(false);
  /** Dual-canvas shared orbit so both panes keep the same viewing angle (offset from device). */
  const [sharedOrbit, setSharedOrbit] = useState<{ offset: Vec3; lookOffset?: Vec3 } | null>(null);
  /** Bumped on format/device changes so both panes snap to center instantly. */
  const [cameraRecenterToken, setCameraRecenterToken] = useState(0);
  const [openSectionId, setOpenSectionId] = useState<string | null>('device');
  const [deviceDropdownOpen, setDeviceDropdownOpen] = useState(false);
  const deviceDropdownRef = useRef<HTMLDivElement>(null);
  const customDevicePanelRef = useRef<CustomDevicePanelHandle>(null);
  const [deviceCategoryFilter, setDeviceCategoryFilter] = useState<DeviceCategoryFilter>('all');
  /** Which platform's device menu is open in split mode (`null` = closed). */
  const [splitDeviceMenu, setSplitDeviceMenu] = useState<PublishTarget | null>(null);
  const [aspectDropdownOpen, setAspectDropdownOpen] = useState(false);
  const [aspectMenuBox, setAspectMenuBox] = useState<FloatingMenuBox | null>(null);
  const aspectDropdownRef = useRef<HTMLDivElement>(null);
  const aspectMenuRef = useRef<HTMLDivElement>(null);
  const [deviceChosen, setDeviceChosen] = useState(false);
  const [sidePanelsHidden, setSidePanelsHidden] = useState(false);
  const [leftPanelHidden, setLeftPanelHidden] = useState(false);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>(() => loadRecentProjects());
  const [cloud, setCloud] = useState<CloudLibraryStatus | null>(null);
  const [cloudProjects, setCloudProjects] = useState<CloudProjectEntry[]>([]);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [syncMenuOpen, setSyncMenuOpen] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [canvasTool, setCanvasTool] = useState<CanvasTool>('composition');
  const [shapeMenu, setShapeMenu] = useState<'flat' | 'solid' | 'stage' | null>(null);
  const shapeMenuRef = useRef<HTMLDivElement>(null);
  const floatingMenuRef = useRef<HTMLDivElement>(null);
  const flatShapeBtnRef = useRef<HTMLButtonElement>(null);
  const solidShapeBtnRef = useRef<HTMLButtonElement>(null);
  const stageBtnRef = useRef<HTMLButtonElement>(null);
  const [shapeMenuBox, setShapeMenuBox] = useState<{ top: number; left: number } | null>(null);
  const [textMenu, setTextMenu] = useState(false);
  const textToolRef = useRef<HTMLDivElement>(null);
  const textMenuRef = useRef<HTMLDivElement>(null);
  const textBtnRef = useRef<HTMLButtonElement>(null);
  const [textMenuBox, setTextMenuBox] = useState<{ top: number; left: number } | null>(null);
  const [markFill, setMarkFill] = useState('#f4e7c3');
  const [markInk, setMarkInk] = useState('#2a2418');
  const [viewGesture, setViewGesture] = useState<ViewGesture>('rotate');
  const [stageSize, setStageSize] = useState({ w: 1, h: 1 });
  const canvasStageRef = useRef<HTMLDivElement>(null);
  const [recentScreenshots, setRecentScreenshots] = useState<RecentScreenshot[]>(() => loadRecentScreenshots());
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [layerSelection, setLayerSelection] = useState<SceneLayerSelection>({ kind: 'device', id: '' });
  const [layerPin, setLayerPin] = useState<{ kind: 'device' | 'prop' | 'overlay' | 'backdrop'; id: string; token: number } | null>(null);
  const onLayerSelection = useCallback((next: SceneLayerSelection) => {
    setLayerSelection((current) => (sameLayerSelection(current, next) ? current : next));
  }, []);
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
  const iosCaptureRef = useRef<CaptureApi | null>(null);
  const androidCaptureRef = useRef<CaptureApi | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const inspectorScrollRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLElement>(null);
  const svgInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | null>(null);
  const syncMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const cloudRef = useRef(cloud);
  const workspaceRef = useRef(workspace);
  const activeIdRef = useRef(workspace.activeId);
  const baselineRef = useRef(new Map<string, string>());
  const savedJsonRef = useRef(new Map<string, string>());
  const syncPathByTabRef = useRef(new Map<string, string>());
  const notifyRef = useRef<(message: string) => void>(() => {});
  const persistCloudRef = useRef<
    (
      tabId: string,
      snapshot: MockupProject,
      knownPath: string | null,
      options?: { quiet?: boolean; force?: boolean },
    ) => Promise<string | null>
  >(async () => null);
  const pullRemoteRef = useRef<() => Promise<void>>(async () => {});
  const pushTemplatesRef = useRef<(templates?: CompositionTemplate[]) => Promise<void>>(async () => {});
  const pullTemplatesRef = useRef<(opts?: { mergeLocal?: boolean }) => Promise<CompositionTemplate[] | null>>(async () => null);
  const savedTemplatesJsonRef = useRef<string | null>(null);

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
  const filteredDevices = useMemo(
    () => filterDevicesByCategory(allDevices, deviceCategoryFilter),
    [allDevices, deviceCategoryFilter],
  );
  const entitlementsMaxDevices = maxDevicesFor(license.tier);
  const videoAllowed = canExportVideo(license.tier);

  const activeTab = workspace.tabs.find((tab) => tab.id === workspace.activeId) ?? workspace.tabs[0] ?? null;
  const hasOpenProject = activeTab != null;
  const project = activeTab?.project ?? DEFAULT_PROJECT;
  liveProjectRef.current = project;
  const activeChangeLog = useMemo(() => {
    if (!activeTab) return [];
    return changeLogsRef.current.get(activeTab.id) ?? [];
  }, [activeTab, changeLogVersion]);
  const animTime = activeTab?.animTime ?? 0;
  const animPlaying = activeTab?.animPlaying ?? false;
  const timelineOpen = activeTab?.timelineOpen ?? false;
  const timelineOpenRef = useRef(timelineOpen);
  timelineOpenRef.current = timelineOpen;
  const animTimeRef = useRef(animTime);
  animTimeRef.current = animTime;

  useEffect(() => {
    const el = leftScrollRef.current;
    if (!el) return;
    return bindScrollMore(el);
  }, [leftWorkspaceTab]);

  useEffect(() => {
    const panel = rightPanelRef.current;
    const scroll = inspectorScrollRef.current;
    const el = timelineOpen ? panel : scroll;
    const other = timelineOpen ? scroll : panel;
    other?.classList.remove('can-scroll-more');
    if (!el) return;
    return bindScrollMore(el);
  }, [timelineOpen, openSectionId]);

  const deviceMenuWasOpen = useRef(false);
  useEffect(() => {
    const wasOpen = deviceMenuWasOpen.current;
    deviceMenuWasOpen.current = deviceDropdownOpen;
    if (deviceDropdownOpen) {
      const root = deviceDropdownRef.current;
      if (!root) return undefined;
      const menu = root.querySelector('.device-dropdown-menu');
      if (menu instanceof HTMLElement) menu.scrollTop = 0;
      return pinToContainerTop(root);
    }
    if (!wasOpen) return undefined;
    const section = document.querySelector('.inspector-scroll .settings-section.is-open');
    if (section instanceof HTMLElement) return pinToContainerTop(section);
    return undefined;
  }, [deviceDropdownOpen]);

  const splitMenuWasOpen = useRef(false);
  useEffect(() => {
    const wasOpen = splitMenuWasOpen.current;
    splitMenuWasOpen.current = splitDeviceMenu != null;
    if (splitDeviceMenu) {
      const root = document.querySelector('.split-env-device-block .device-dropdown.is-open');
      if (!(root instanceof HTMLElement)) return undefined;
      const menu = root.querySelector('.device-dropdown-menu');
      if (menu instanceof HTMLElement) menu.scrollTop = 0;
      return pinToContainerTop(root);
    }
    if (!wasOpen) return undefined;
    const section = document.querySelector('.inspector-scroll .settings-section.is-open');
    if (section instanceof HTMLElement) return pinToContainerTop(section);
    return undefined;
  }, [splitDeviceMenu]);

  useEffect(() => {
    if (openSectionId !== 'frame') setAspectDropdownOpen(false);
  }, [openSectionId]);

  // Canvas taps on sky / floor / backdrop — keep the colour dock / Look stop in view.
  useEffect(() => {
    if (!studioSetFocus || sidePanelsHidden) return undefined;
    let cancelled = false;
    const pin = () => {
      if (cancelled) return;
      const dock = document.querySelector('.right-panel .surround-colour-dock');
      if (dock instanceof HTMLElement) {
        pinToContainerTop(dock);
        return;
      }
      const highlighted = document.querySelector(
        '.right-panel .gradient-color-field.is-highlighted, .modeling-mode-studio-stops .modeling-mode-color-field.is-highlighted',
      );
      if (highlighted instanceof HTMLElement) {
        pinToContainerTop(highlighted);
        return;
      }
      const section = document.getElementById('settings-look')?.closest('section');
      if (section instanceof HTMLElement) pinToContainerTop(section);
    };
    const frame = requestAnimationFrame(() => {
      pin();
      window.setTimeout(pin, 48);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [studioSetFocus, sidePanelsHidden, openSectionId]);

  useEffect(() => {
    if (!aspectDropdownOpen) return undefined;
    const root = aspectDropdownRef.current;
    if (!root) return undefined;
    const place = () => {
      const trigger = root.querySelector('.aspect-ratio-trigger');
      const anchor = trigger instanceof HTMLElement ? trigger : root;
      setAspectMenuBox(measureFloatingMenu(anchor));
    };
    place();
    const menu = aspectMenuRef.current;
    if (menu) menu.scrollTop = 0;
    const onScroll = () => place();
    const scrollers = [inspectorScrollRef.current, rightPanelRef.current].filter((el): el is HTMLElement => el instanceof HTMLElement);
    scrollers.forEach((el) => el.addEventListener('scroll', onScroll, { passive: true }));
    window.addEventListener('resize', onScroll);
    const observer = new ResizeObserver(onScroll);
    observer.observe(root);
    return () => {
      scrollers.forEach((el) => el.removeEventListener('scroll', onScroll));
      window.removeEventListener('resize', onScroll);
      observer.disconnect();
    };
  }, [aspectDropdownOpen]);

  const trackRecent = useCallback((nextProject: MockupProject) => {
    setRecentProjects(rememberRecentProject(nextProject));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [saved, shots, projects] = await Promise.all([
        loadSessionWorkspace().catch(() => null),
        hydrateRecentScreenshots().catch(() => [] as RecentScreenshot[]),
        hydrateRecentProjects().catch(() => loadRecentProjects()),
      ]);
      if (cancelled) return;
      // A refresh keeps the open file. Opening the site or the app starts on
      // the projects workspace, and that launch clears the saved tabs.
      let resumed = projects;
      if (saved?.tabs.length && !skipSessionRestoreRef.current && !workspaceRef.current.tabs.length) {
        for (const tab of saved.tabs) resumed = rememberRecentProject(tab.project);
        if (isDocumentReload()) {
          const restored = { tabs: saved.tabs, activeId: saved.activeId };
          workspaceRef.current = restored;
          activeIdRef.current = restored.activeId;
          setWorkspace(restored);
        } else {
          await saveSessionWorkspace(
            { tabs: [], activeId: null },
            saved.frameSize ?? frameSizeRef.current,
          );
          if (cancelled) return;
          if (workspaceRef.current.tabs.length) {
            await saveSessionWorkspace(workspaceRef.current, frameSizeRef.current);
          }
        }
      }
      const frame = saved?.frameSize ? sanitizeSessionFrameSize(saved.frameSize) : null;
      if (frame && !skipSessionRestoreRef.current) {
        const knownSizes = new Set(loadSavedSizes().map((item) => item.id));
        const aspects = frame.exportAspectIds.filter((id) => (
          !id.startsWith('size-') || knownSizes.has(id)
        ));
        const exportAspectIdsNext = aspects.length ? aspects : ['custom'];
        let previewNext = frame.previewFrame;
        if (
          previewNext !== 'free'
          && previewNext.startsWith('size-')
          && !knownSizes.has(previewNext)
        ) {
          previewNext = exportAspectIdsNext[0] === 'custom' ? 'free' : (exportAspectIdsNext[0] ?? 'free');
        }
        setExportAspectIds(exportAspectIdsNext);
        setPreviewFrame(previewNext);
        setExportResolution(frame.exportResolution);
        setCustomExportSize(frame.customExportSize);
      }
      setRecentScreenshots((current) => {
        const byId = new Map<string, RecentScreenshot>();
        for (const shot of shots) byId.set(shot.id, shot);
        for (const shot of current) {
          const previous = byId.get(shot.id);
          if (!previous || shot.addedAt >= previous.addedAt) byId.set(shot.id, shot);
        }
        return [...byId.values()].sort((a, b) => b.addedAt - a.addedAt).slice(0, 4);
      });
      setRecentProjects((current) => {
        const byId = new Map(resumed.map((entry) => [entry.id, entry]));
        for (const entry of current) {
          const previous = byId.get(entry.id);
          if (!previous || entry.updatedAt >= previous.updatedAt) byId.set(entry.id, entry);
        }
        return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);
      });
      sessionReadyRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionReadyRef.current) return undefined;
    const timer = window.setTimeout(() => {
      void saveSessionWorkspace(workspaceRef.current, frameSizeRef.current).catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [workspace, exportAspectIds, previewFrame, exportResolution, customExportSize]);

  useEffect(() => {
    const flush = () => {
      if (!sessionReadyRef.current) return;
      void saveSessionWorkspace(workspaceRef.current, frameSizeRef.current).catch(() => undefined);
    };
    window.addEventListener('pagehide', flush);
    import.meta.hot?.dispose(flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  cloudRef.current = cloud;
  workspaceRef.current = workspace;
  activeIdRef.current = workspace.activeId;
  {
    const liveTabIds = new Set(workspace.tabs.map((tab) => tab.id));
    for (const id of [...syncPathByTabRef.current.keys()]) {
      if (!liveTabIds.has(id)) syncPathByTabRef.current.delete(id);
    }
    for (const tab of workspace.tabs) {
      if (tab.syncPath) syncPathByTabRef.current.set(tab.id, tab.syncPath);
    }
  }

  const setProject = useCallback((updater: MockupProject | ((current: MockupProject) => MockupProject)) => {
    if (!sessionReadyRef.current) skipSessionRestoreRef.current = true;
    const tabId = activeIdRef.current;
    if (!tabId) return;
    const current = liveProjectRef.current;
    const nextRaw = typeof updater === 'function' ? updater(current) : updater;
    const next = nextRaw === current ? current : commitActiveScene(nextRaw);
    if (next !== current) {
      liveProjectRef.current = next;
      const existing = changeLogsRef.current.get(tabId) ?? [];
      const recorded = recordProjectChange(existing, current, next);
      if (recorded !== existing) {
        changeLogsRef.current.set(tabId, recorded);
        setChangeLogVersion((version) => version + 1);
      }
    }
    setWorkspace((ws) => ({
      ...ws,
      tabs: ws.tabs.map((tab) => (tab.id === tabId ? { ...tab, project: next } : tab)),
    }));
  }, []);

  const restoreChange = useCallback((entryId: string) => {
    const tabId = activeIdRef.current;
    if (!tabId) return;
    const entries = changeLogsRef.current.get(tabId) ?? [];
    const index = entries.findIndex((entry) => entry.id === entryId);
    if (index < 0) return;
    const entry = entries[index];
    changeLogsRef.current.set(tabId, entries.slice(index + 1));
    liveProjectRef.current = entry.before;
    setWorkspace((ws) => ({
      ...ws,
      tabs: ws.tabs.map((tab) => (tab.id === tabId ? { ...tab, project: entry.before } : tab)),
    }));
    setChangeLogVersion((version) => version + 1);
    notifyRef.current(`Restored to before “${entry.summary}”`);
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
  const selectedSceneProp = layerSelection.kind === 'prop'
    ? (project.sceneProps ?? []).find((prop) => prop.id === layerSelection.id) ?? null
    : null;

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
    if (gizmoDragging || !animActive || !hasAnimation(animation)) {
      if (project.compositionMode === 'split' && project.linkSplitTransform !== false) {
        const source = getPublishEnvDevice(project);
        return { ...project, devices: mirrorLinkedTransforms(project.devices, source) };
      }
      return project;
    }
    const evaluated = evaluateAnimation(project.devices, animation, animTime);
    return {
      ...project,
      animation,
      devices: applyLinkedTransformsAfterAnim(project, evaluated),
    };
  }, [project, animation, animActive, animTime, gizmoDragging]);
  const displaySelected = getSelectedDevice(displayProject);
  const activePublishTarget = resolvePublishTarget(project);
  const activeEnvDevice = getPublishEnvDevice(project);
  const activeEnvScreenshot = deviceScreenMedia(activeEnvDevice, project.screenshot);
  const iosEnvDevice = useMemo(() => getPlatformDevice(project, 'ios'), [project]);
  const androidEnvDevice = useMemo(() => getPlatformDevice(project, 'android'), [project]);
  const iosEnvFinish = useMemo(() => deviceFinish(iosEnvDevice, project), [iosEnvDevice, project]);
  const androidEnvFinish = useMemo(() => deviceFinish(androidEnvDevice, project), [androidEnvDevice, project]);
  const isDualCanvas = project.compositionMode === 'split';
  const iosDisplayProject = useMemo(() => {
    if (!isDualCanvas) return null;
    return projectForEnvCanvas(displayProject, 'ios');
  }, [isDualCanvas, displayProject]);
  const androidDisplayProject = useMemo(() => {
    if (!isDualCanvas) return null;
    return projectForEnvCanvas(displayProject, 'android');
  }, [isDualCanvas, displayProject]);
  const platformRecentScreenshots = useMemo(
    () => recentForPlatform(recentScreenshots, activePublishTarget),
    [recentScreenshots, activePublishTarget],
  );
  const liveStreamDeviceId = useMemo(() => {
    if (!mirrorStream) return null;
    const platform = mirrorSource ?? activePublishTarget;
    return project.devices.find((d) => getDevice(d.deviceId).platform === platform)?.id
      ?? activeEnvDevice.id;
  }, [mirrorStream, mirrorSource, activePublishTarget, project.devices, activeEnvDevice.id]);
  // Dual canvases each use solo framing — never the old wide “two phones in one scene” camera.
  const animatedCamera = useMemo(() => {
    if (!animActive || !hasCameraAnimation(animation)) return null;
    return evaluateCamera(
      animation,
      animTime,
      project.cameraView,
      false,
    );
  }, [animActive, animation, animTime, project.cameraView]);

  const liveCameraPose = useMemo(() => {
    const focus = displaySelected.position ?? { x: 0, y: 0, z: 0 };
    if (animatedCamera) return animatedCamera;
    if (sharedOrbit) {
      return {
        x: focus.x + sharedOrbit.offset.x,
        y: focus.y + sharedOrbit.offset.y,
        z: focus.z + sharedOrbit.offset.z,
      };
    }
    const base = defaultCameraPosition(project.cameraView, false);
    return {
      x: focus.x + base.x,
      y: focus.y + base.y,
      z: focus.z + base.z,
    };
  }, [
    animatedCamera,
    sharedOrbit,
    displaySelected.position?.x,
    displaySelected.position?.y,
    displaySelected.position?.z,
    project.cameraView,
  ]);

  // Format / camera-preset / composition changes: snap both panes to center.
  // Per-pane device model/finish swaps must NOT clear sharedOrbit — linked angle stays.
  useEffect(() => {
    setSharedOrbit(null);
    setCameraRecenterToken((n) => n + 1);
  }, [
    project.cameraView,
    project.cameraLens,
    project.compositionMode,
    previewFrame,
  ]);

  // Keep split size-guide plates on the black dimension style for both panes.
  useEffect(() => {
    if (project.compositionMode !== 'split') return;
    setProject((current) => refreshSplitPlaceholders(current));
  }, [project.compositionMode, iosEnvDevice.deviceId, androidEnvDevice.deviceId]);

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
      const next = !open;
      setCanvasTool((tool) => (next ? 'animate' : tool === 'animate' ? 'composition' : tool));
      if (open) {
        setAnimPlaying(false);
        bakeAnimationPose();
        if (hasCameraAnimation(animation)) {
          const pose = evaluateCamera(animation, animTime, project.cameraView, false);
          const focus = getSelectedDevice(project).position ?? { x: 0, y: 0, z: 0 };
          setSharedOrbit({
            offset: {
              x: Number((pose.x - focus.x).toFixed(4)),
              y: Number((pose.y - focus.y).toFixed(4)),
              z: Number((pose.z - focus.z).toFixed(4)),
            },
          });
        }
      } else {
        setAspectDropdownOpen(false);
      }
      return !open;
    });
  };

  const updateProject = useCallback((patch: Partial<MockupProject>) => {
    setProject((current) => {
      const merged = { ...current, ...patch };
      if (patch.background != null || patch.gradientColors != null) {
        return patchActiveCompositionScene(merged, {
          background: patch.background ?? merged.background,
          gradientColors: patch.gradientColors ?? merged.gradientColors,
        });
      }
      if (patch.scenes || patch.activeSceneId) {
        return syncProjectFromActiveScene(merged);
      }
      return merged;
    });
  }, [setProject]);

  const openShapeMenu = (kind: 'flat' | 'solid' | 'stage', button: HTMLButtonElement | null) => {
    if (shapeMenu === kind) {
      setShapeMenu(null);
      return;
    }
    if (button) {
      const rect = button.getBoundingClientRect();
      if (kind === 'stage') {
        // Labelled list, left-anchored like the text menu so it stays on screen.
        const width = 200;
        const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
        setShapeMenuBox({ top: rect.top - 8, left });
      } else {
        setShapeMenuBox({ top: rect.top - 8, left: rect.left + rect.width / 2 });
      }
    }
    setTextMenu(false);
    setShapeMenu(kind);
  };

  const openTextMenu = () => {
    const button = textBtnRef.current;
    if (button) {
      const rect = button.getBoundingClientRect();
      const width = 220;
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      setTextMenuBox({ top: rect.top - 8, left });
    }
    setShapeMenu(null);
    setTextMenu(true);
  };

  const toggleTextMenu = () => {
    if (textMenu) {
      setTextMenu(false);
      return;
    }
    openTextMenu();
  };

  const pinLayer = (kind: 'device' | 'prop' | 'overlay' | 'backdrop', id: string) => {
    if (kind === 'backdrop') {
      setLayerSelection({ kind: 'backdrop' });
    } else {
      setLayerSelection({ kind, id });
    }
    setLayerPin({ kind, id, token: Date.now() });
    setSelectedOverlayId(kind === 'overlay' ? id : null);
  };

  const addInsertShape = (kind: ScenePropKind) => {
    const existing = project.sceneProps ?? [];
    if (existing.length >= 24) {
      notify('This composition already has the maximum number of shapes');
      return;
    }
    const slot = existing.length;
    const prop = createSceneProp({
      kind,
      position: { x: 1.15 + (slot % 3) * 0.15, y: 0.15, z: (slot % 2) * 0.2 },
      color: TONE_CLAY,
    });
    updateProject({ sceneProps: [...existing, prop] });
    pinLayer('prop', prop.id);
    setShapeMenu(null);
  };

  const currentStageType = stageTypeOf(project);

  /** Swap what sits under the device. Replaces the current stage piece, keeps other shapes. */
  const setStageType = (id: StageType) => {
    const type = STAGE_TYPES.find((item) => item.id === id);
    if (!type) return;
    setShapeMenu(null);
    if (id === currentStageType) return;
    const existing = project.sceneProps ?? [];
    const kept = existing.filter((prop) => !STAGE_PROP_KINDS.has(prop.kind));
    const removedSelected = layerSelection.kind === 'prop' && !kept.some((prop) => prop.id === layerSelection.id);
    if (!type.prop) {
      updateProject({ sceneProps: kept, showGroundBase: id === 'floor' });
      if (removedSelected) onLayerSelection({ kind: 'device', id: project.selectedDeviceId });
      notify(id === 'floor' ? 'Stage: floor plate' : 'Stage cleared');
      return;
    }
    const prop = createSceneProp({
      ...type.prop,
      position: { ...type.prop.position! },
      rotation: type.prop.rotation ? { ...type.prop.rotation } : undefined,
      scale: typeof type.prop.scale === 'object' ? { ...type.prop.scale } : type.prop.scale,
    });
    updateProject({ sceneProps: [...kept, prop] });
    pinLayer('prop', prop.id);
    notify(`Stage: ${type.label}`);
  };

  const addFlatShape = (shape: FlatShape) => {
    const next = createOverlay({
      kind: 'shape',
      text: shape,
      x: 0.5,
      y: 0.42,
      color: '#d7dde4',
      endTime: animation.duration,
    });
    updateProject({ overlays: [...(project.overlays ?? []), next] });
    pinLayer('overlay', next.id);
    setOpenSectionId('overlays');
    setShapeMenu(null);
  };

  const commitAnnotation = (mark: AnnotationMark) => {
    if ((project.overlays ?? []).length >= 24) {
      notify('This composition already has the maximum number of notes');
      return;
    }
    if (mark.kind === 'path') {
      const next = createOverlay({
        kind: 'path',
        color: markInk,
        x: mark.x,
        y: mark.y,
        anchor: { deviceId: mark.deviceId, points: mark.points },
        endTime: animation.duration,
      });
      updateProject({ overlays: [...(project.overlays ?? []), next] });
      pinLayer('overlay', next.id);
      openTextMenu();
      return;
    }
    const next = createOverlay({
      kind: 'comment',
      text: 'Comment',
      color: markInk,
      fill: markFill,
      x: mark.x,
      y: mark.y,
      fontSize: 0.032,
      anchor: { deviceId: mark.deviceId, points: mark.points },
      endTime: animation.duration,
    });
    updateProject({ overlays: [...(project.overlays ?? []), next] });
    pinLayer('overlay', next.id);
    setCanvasTool('comments');
    openTextMenu();
  };

  const selectCanvasOverlay = (id: string) => {
    pinLayer('overlay', id);
    const overlay = (project.overlays ?? []).find((item) => item.id === id);
    if (!overlay) return;
    if (overlay.kind === 'comment') {
      if (overlay.fill) setMarkFill(overlay.fill);
      if (overlay.color) setMarkInk(overlay.color);
      openTextMenu();
      return;
    }
    if (overlay.kind === 'path') {
      if (overlay.color) setMarkInk(overlay.color);
      openTextMenu();
    }
  };

  const showComposition = () => {
    setCanvasTool('composition');
    if (timelineOpen) toggleTimeline();
  };

  const showAnimate = () => {
    setCanvasTool('animate');
    if (!timelineOpen) toggleTimeline();
  };

  const chooseMarkup = (tool: 'comments' | 'pen') => {
    setCanvasTool((current) => (current === tool ? 'composition' : tool));
    if (timelineOpen) toggleTimeline();
    openTextMenu();
  };

  const onViewSwipe = (direction: 'left' | 'right') => {
    const order: CameraView[] = ['front', 'right', 'top', 'left'];
    const index = Math.max(0, order.indexOf(project.cameraView));
    const next = direction === 'right'
      ? order[(index + 1) % order.length]
      : order[(index + order.length - 1) % order.length];
    setSharedOrbit(null);
    updateProject({ cameraView: next });
  };

  const onViewLongPress = (point: { clientX: number; clientY: number }) => {
    const selected = getSelectedDevice(project);
    setDeviceMenu({ id: selected.id, x: point.clientX, y: point.clientY });
  };

  const addInsertText = () => {
    const next = createOverlay({
      kind: 'text',
      endTime: animation.duration,
    });
    updateProject({ overlays: [...(project.overlays ?? []), next] });
    pinLayer('overlay', next.id);
    setOpenSectionId('overlays');
  };

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

  const applyMarkColor = (which: 'fill' | 'ink', hex: string) => {
    const color = normalizeOverlayColor(hex);
    if (!color) return;
    if (which === 'fill') setMarkFill(color);
    else setMarkInk(color);
    const overlay = (project.overlays ?? []).find((item) => item.id === selectedOverlayId);
    if (!overlay) return;
    if (overlay.kind === 'comment') {
      patchOverlay(overlay.id, which === 'fill' ? { fill: color } : { color });
    } else if (overlay.kind === 'path' && which === 'ink') {
      patchOverlay(overlay.id, { color });
    }
  };

  const removeSelectedMark = () => {
    const overlay = (project.overlays ?? []).find((item) => item.id === selectedOverlayId);
    if (!overlay || (overlay.kind !== 'comment' && overlay.kind !== 'path')) return;
    updateProject({
      overlays: (project.overlays ?? []).filter((item) => item.id !== overlay.id),
    });
    setSelectedOverlayId(null);
  };

  const onOverlayPointerDown = (e: ReactPointerEvent<HTMLDivElement>, overlayId: string) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    overlayDragRef.current = { id: overlayId, pointerId: e.pointerId };
    pinLayer('overlay', overlayId);
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
    changeLogsRef.current.delete(id);
    setChangeLogVersion((version) => version + 1);
  };

  const goToRecentProjects = () => {
    for (const tab of workspaceRef.current.tabs) trackRecent(tab.project);
    changeLogsRef.current.clear();
    setChangeLogVersion((version) => version + 1);
    setWorkspace({ tabs: [], activeId: null });
    setDeviceMenu(null);
    setRenamingTabId(null);
    setExportOpen(false);
    setAnimPlaying(false);
    setFileMenuOpen(false);
    setLeftWorkspaceTab('scenes');
  };

  const openProjectInTab = (nextProject: MockupProject, notice?: string, syncPath?: string | null) => {
    trackRecent(nextProject);
    const canonical = canonicalProjectJson(nextProject);
    const ws = workspaceRef.current;
    let openedId = '';
    let nextWs: Workspace;
    if (!ws.tabs.length) {
      const tab = createProjectTab(nextProject);
      tab.syncPath = syncPath ?? null;
      openedId = tab.id;
      nextWs = { tabs: [tab], activeId: tab.id };
    } else if (ws.tabs.length >= MAX_PROJECT_TABS) {
      const activeId = ws.activeId ?? ws.tabs[0].id;
      openedId = activeId;
      changeLogsRef.current.delete(activeId);
      nextWs = {
        tabs: ws.tabs.map((item) => (
          item.id === activeId
            ? { ...item, project: nextProject, animTime: 0, animPlaying: false, syncPath: syncPath ?? null }
            : item
        )),
        activeId,
      };
    } else {
      const tab = createProjectTab(nextProject);
      tab.syncPath = syncPath ?? null;
      openedId = tab.id;
      nextWs = { tabs: [...ws.tabs, tab], activeId: tab.id };
    }
    baselineRef.current.set(openedId, canonical);
    if (syncPath) {
      savedJsonRef.current.set(syncPath, canonical);
      syncPathByTabRef.current.set(openedId, syncPath);
    } else {
      syncPathByTabRef.current.delete(openedId);
    }
    workspaceRef.current = nextWs;
    setWorkspace(nextWs);
    setDeviceMenu(null);
    if (notice) notify(notice);
    if (cloudRef.current?.configured && !syncPath) {
      void persistCloudRef.current(openedId, nextProject, null, { quiet: true, force: true });
    }
    return openedId;
  };

  const openRecentProject = (entry: RecentProjectEntry) => {
    const match = cloudRef.current?.configured
      ? cloudProjects.find((item) => item.name.trim().toLowerCase() === entry.name.trim().toLowerCase())
      : undefined;
    if (match) {
      void openCloudProject(match.path);
      return;
    }
    openProjectInTab(
      { ...entry.project, name: uniqueProjectName(entry.project.name || entry.name) },
      `Opened “${entry.name}”`,
    );
  };

  const applyCustomFrame = () => {
    setExportAspectIds(['custom']);
    setPreviewFrame('free');
    setExportResolution('custom');
  };

  const startWithDevice = (deviceId: string) => {
    if (!isDeviceUnlocked(license.tier, deviceId)) {
      notify(upgradeCopy('The full device library'));
      setLicenseOpen(true);
      return;
    }
    const model = getDevice(deviceId);
    const shot = placeholderForDevice(deviceId);
    const instance = createDeviceInstance({
      deviceId,
      screenshot: shot,
      deviceColor: DEFAULT_PROJECT.deviceColor,
      clayMode: DEFAULT_PROJECT.clayMode,
      rotation: { ...STUDIO_START_ROTATION },
      position: { ...STUDIO_START_POSITION },
    });
    const name = uniqueProjectName(model.label);
    applyCustomFrame();
    openProjectInTab({
      ...DEFAULT_PROJECT,
      name,
      deviceId,
      screenshot: shot,
      publishTarget: model.platform,
      cameraView: 'front',
      devices: [instance],
      selectedDeviceId: instance.id,
      animation: createDefaultAnimation(instance.id),
    }, `Started “${name}”`);
  };

  /** Fresh untitled studio file — front device, soft lighting, no template motion. */
  const startBlankFile = () => {
    if (workspaceRef.current.tabs.length >= MAX_PROJECT_TABS) {
      notify(`Tab limit reached (${MAX_PROJECT_TABS})`);
      return;
    }
    const deviceId = DEFAULT_PROJECT.deviceId;
    const model = getDevice(deviceId);
    const shot = placeholderForDevice(deviceId);
    const instance = createDeviceInstance({
      deviceId,
      screenshot: shot,
      deviceColor: DEFAULT_PROJECT.deviceColor,
      clayMode: DEFAULT_PROJECT.clayMode,
      rotation: { ...STUDIO_START_ROTATION },
      position: { ...STUDIO_START_POSITION },
    });
    const name = uniqueProjectName('Untitled composition');
    applyCustomFrame();
    setTemplatePickerOpen(false);
    setFileMenuOpen(false);
    openProjectInTab({
      ...DEFAULT_PROJECT,
      name,
      deviceId,
      screenshot: shot,
      publishTarget: model.platform,
      cameraView: 'front',
      devices: [instance],
      selectedDeviceId: instance.id,
      animation: createDefaultAnimation(instance.id),
      sceneProps: [],
      sceneLights: [],
      // Blank means blank: no stage under the device until one is picked from the Stage tool.
      showGroundBase: false,
    }, `Opened blank file “${name}”`);
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
    applyCustomFrame();
    const finalName = uniqueProjectName(template.label);
    const nextProject = projectFromTemplate(template, { name: finalName });
    const motion = template.motion ? getAnimationPreset(template.motion) : undefined;
    const playMotion = Boolean(motion && motion.loop && motion.id !== 'clear');
    const canAddTab = workspace.tabs.length < MAX_PROJECT_TABS;
    const editingShipped = isDeveloperToolset && isDevEditableTemplateId(template.id);
    setDeviceMenu(null);
    setTemplatePickerOpen(false);
    trackRecent(nextProject);

    const canonical = canonicalProjectJson(nextProject);
    if (canAddTab) {
      const tab = createProjectTab(nextProject);
      tab.syncPath = null;
      baselineRef.current.set(tab.id, canonical);
      syncPathByTabRef.current.delete(tab.id);
      tab.animPlaying = playMotion;
      const nextWs = { tabs: [...workspaceRef.current.tabs, tab], activeId: tab.id };
      workspaceRef.current = nextWs;
      setWorkspace(nextWs);
      if (editingShipped || isDevEditableTemplateId(template.id)) {
        setCompositionPick({ tabId: tab.id, templateId: template.id });
      }
      if (cloudRef.current?.configured) {
        void persistCloudRef.current(tab.id, nextProject, null, { quiet: true, force: true });
      }
      notify(
        editingShipped
          ? `Editing “${finalName}” in Dev · Update shipped when ready`
          : `Opened “${finalName}” in a new tab`,
      );
      return;
    }

    const activeId = workspaceRef.current.activeId;
    if (activeId) {
      changeLogsRef.current.delete(activeId);
      baselineRef.current.set(activeId, canonical);
      syncPathByTabRef.current.delete(activeId);
      const nextWs = {
        ...workspaceRef.current,
        tabs: workspaceRef.current.tabs.map((tab) => (
          tab.id === activeId
            ? { ...tab, project: nextProject, animTime: 0, animPlaying: playMotion, timelineOpen: false, syncPath: null }
            : tab
        )),
      };
      workspaceRef.current = nextWs;
      setWorkspace(nextWs);
      if (editingShipped || isDevEditableTemplateId(template.id)) {
        setCompositionPick({ tabId: activeId, templateId: template.id });
      }
      if (cloudRef.current?.configured) {
        void persistCloudRef.current(activeId, nextProject, null, { quiet: true, force: true });
      }
    }
    notify(
      editingShipped
        ? `Editing “${finalName}” in Dev · Update shipped when ready`
        : `Started “${finalName}”`,
    );
  };

  const patchSelectedDevice = useCallback((patch: Partial<ReturnType<typeof getSelectedDevice>>) => {
    setProject((current) => {
      const selected = getSelectedDevice(current);
      // Switching the GLB always snaps back to a front-facing studio seat so
      // every model opens the same way: screen to camera, soft floor shadow.
      const switchingModel = Boolean(patch.deviceId && patch.deviceId !== selected.deviceId);
      const studioRotation = switchingModel && !patch.rotation
        ? { ...STUDIO_START_ROTATION }
        : (patch.rotation ? { ...patch.rotation } : { ...selected.rotation });
      const studioPosition = switchingModel && !patch.position
        ? { ...STUDIO_START_POSITION }
        : (patch.position ? { ...patch.position } : { ...selected.position });
      const nextSelected = {
        ...selected,
        ...patch,
        rotation: studioRotation,
        position: studioPosition,
      };
      const linkTransform = current.linkSplitTransform !== false;
      const devices = current.devices.map((device) => {
        if (device.id !== selected.id) {
          // Optional link: rotation/scale stay mirrored; position stays free
          if (current.compositionMode === 'split' && linkTransform && (patch.rotation || patch.scale != null || switchingModel)) {
            return {
              ...device,
              rotation: switchingModel ? { ...studioRotation } : (patch.rotation ? { ...patch.rotation } : device.rotation),
              scale: patch.scale ?? device.scale,
            };
          }
          return device;
        }
        return nextSelected;
      });
      const next = syncProjectFromSelected({ ...current, devices }, nextSelected);
      // Solo mode: follow the new model's platform. Split mode keeps publishTarget —
      // per-pane model changes go through applyDeviceToPlatform instead.
      if (patch.deviceId && current.compositionMode !== 'split') {
        return {
          ...next,
          publishTarget: getDevice(patch.deviceId).platform,
          cameraView: switchingModel ? 'front' : next.cameraView,
        };
      }
      if (switchingModel) {
        return { ...next, cameraView: 'front' };
      }
      return next;
    });
    if (patch.deviceId) setCameraRecenterToken((n) => n + 1);
  }, []);

  const keyPropertyAtPlayhead = (property: AnimProperty, value: number) => {
    setProject((current) => {
      const target = getSelectedDevice(current);
      const linkTransform = current.compositionMode === 'split' && current.linkSplitTransform !== false;
      const targetIds = linkTransform
        ? current.devices.map((d) => d.id)
        : [target.id];
      let tracks = current.animation.tracks;
      for (const targetId of targetIds) {
        const existing = tracks.find((t) => t.targetId === targetId && t.property === property);
        const base = existing ?? { id: `track-${targetId}-${property}`, targetId, property, keyframes: [] };
        const updated = upsertKeyframe(base, animTime, value);
        tracks = existing
          ? tracks.map((t) => (t.id === existing.id ? updated : t))
          : [...tracks, updated];
      }
      return { ...current, animation: { ...current.animation, tracks } };
    });
  };

  const updateRotation = (axis: 'x' | 'y' | 'z', value: number) => {
    setProject((current) => {
      const selectedDevice = getSelectedDevice(current);
      const rotation = { ...selectedDevice.rotation, [axis]: value };
      const linkTransform = current.linkSplitTransform !== false;
      return syncProjectFromSelected({
        ...current,
        devices: current.devices.map((device) => (
          (current.compositionMode === 'split' && linkTransform) || device.id === selectedDevice.id
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
  notifyRef.current = notify;

  persistCloudRef.current = async (tabId, snapshot, knownPath, options) => {
    const api = window.mockupDesktop;
    if (!api?.cloudWrite || !cloudRef.current?.configured) return null;
    const canonical = canonicalProjectJson(snapshot);
    const path = knownPath || syncPathByTabRef.current.get(tabId) || null;
    if (!options?.force && path && savedJsonRef.current.get(path) === canonical) return path;
    if (!options?.force && !path && baselineRef.current.get(tabId) === canonical) return null;
    try {
      const result = await api.cloudWrite({
        filePath: path,
        contents: JSON.stringify(snapshot, null, 2),
        name: snapshot.name,
      });
      if (path && path !== result.path) savedJsonRef.current.delete(path);
      savedJsonRef.current.set(result.path, canonical);
      syncPathByTabRef.current.set(tabId, result.path);
      setWorkspace((ws) => ({
        ...ws,
        tabs: ws.tabs.map((tab) => (
          tab.id === tabId && tab.syncPath !== result.path ? { ...tab, syncPath: result.path } : tab
        )),
      }));
      if (!options?.quiet) {
        const where = cloudRef.current?.label || 'your drive';
        notifyRef.current(result.unchanged ? `Already saved to ${where}` : `Saved to ${where}`);
      }
      return result.path;
    } catch (error) {
      notifyRef.current(error instanceof Error ? error.message : 'Could not sync this project');
      return null;
    }
  };

  pushTemplatesRef.current = async (templates) => {
    const api = window.mockupDesktop;
    if (!api?.cloudTemplatesWrite || !cloudRef.current?.configured || cloudRef.current.missing) return;
    const list = templates ?? loadSavedCompositions();
    const canonical = canonicalTemplatesJson(list);
    if (savedTemplatesJsonRef.current === canonical) return;
    try {
      const contents = serializeTemplatesLibrary(list);
      const result = await api.cloudTemplatesWrite(contents);
      savedTemplatesJsonRef.current = canonical;
      if (!result.unchanged) {
        /* Quiet — templates sync in the background with the project folder. */
      }
    } catch (error) {
      notifyRef.current(error instanceof Error ? error.message : 'Could not sync templates');
    }
  };

  pullTemplatesRef.current = async (opts) => {
    const api = window.mockupDesktop;
    if (!api?.cloudTemplatesRead || !cloudRef.current?.configured || cloudRef.current.missing) return null;
    try {
      const file = await api.cloudTemplatesRead();
      const local = loadSavedCompositions();
      if (file.missing || !file.contents) {
        if (local.length) await pushTemplatesRef.current(local);
        return local;
      }
      const remote = parseTemplatesLibrary(file.contents);
      const remoteCanonical = canonicalTemplatesJson(remote);
      if (savedTemplatesJsonRef.current === remoteCanonical) return local;
      const next = opts?.mergeLocal
        ? mergeSavedCompositions(local, remote)
        : remote;
      const stored = replaceSavedCompositions(next);
      setSavedCompositions(stored);
      savedTemplatesJsonRef.current = canonicalTemplatesJson(stored);
      if (opts?.mergeLocal || canonicalTemplatesJson(remote) !== canonicalTemplatesJson(stored)) {
        await pushTemplatesRef.current(stored);
      }
      return stored;
    } catch {
      return null;
    }
  };

  const refreshCloudProjects = useCallback(async () => {
    const api = window.mockupDesktop;
    if (!api?.cloudList) return;
    try {
      const rows = await api.cloudList();
      setCloudProjects(rows.map(projectFromCloudRow));
    } catch (error) {
      notifyRef.current(error instanceof Error ? error.message : 'Could not read the sync folder');
    }
  }, []);

  pullRemoteRef.current = async () => {
    const api = window.mockupDesktop;
    if (!api?.cloudRead || !cloudRef.current?.configured) return;
    for (const tab of workspaceRef.current.tabs) {
      const filePath = tab.syncPath || syncPathByTabRef.current.get(tab.id);
      if (!filePath) continue;
      try {
        const file = await api.cloudRead(filePath);
        const parsed = validateProject(JSON.parse(file.contents) as unknown);
        const diskJson = canonicalProjectJson(parsed);
        const localJson = canonicalProjectJson(tab.project);
        if (diskJson === localJson) {
          savedJsonRef.current.set(file.path, diskJson);
          continue;
        }
        const saved = savedJsonRef.current.get(file.path) || savedJsonRef.current.get(filePath);
        if (saved && localJson !== saved) continue;
        savedJsonRef.current.set(file.path, diskJson);
        baselineRef.current.set(tab.id, diskJson);
        syncPathByTabRef.current.set(tab.id, file.path);
        setWorkspace((ws) => ({
          ...ws,
          tabs: ws.tabs.map((item) => (
            item.id === tab.id ? { ...item, project: parsed, syncPath: file.path } : item
          )),
        }));
        notifyRef.current(`Updated “${parsed.name}” from ${cloudRef.current?.label || 'sync'}`);
      } catch {
        /* The file may be mid-save or still downloading. */
      }
    }
    await pullTemplatesRef.current();
    if (!workspaceRef.current.activeId) await refreshCloudProjects();
  };

  const openCloudProject = async (filePath: string) => {
    const existing = workspaceRef.current.tabs.find((tab) => tab.syncPath === filePath);
    if (existing) {
      switchTab(existing.id);
      return;
    }
    try {
      const file = await window.mockupDesktop?.cloudRead?.(filePath);
      if (!file) return;
      const parsed = validateProject(JSON.parse(file.contents) as unknown);
      openProjectInTab(parsed, `Opened “${parsed.name}”`, file.path);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not open that project');
    }
  };

  const publishExistingWork = async () => {
    const api = window.mockupDesktop;
    if (!api?.cloudList || !api.cloudWrite) return;
    const rows = await api.cloudList();
    const names = new Set(rows.map((row) => row.name.trim().toLowerCase()));
    for (const entry of loadRecentProjects()) {
      const key = (entry.name || entry.project.name || '').trim().toLowerCase();
      if (!key || names.has(key)) continue;
      try {
        await api.cloudWrite({
          contents: JSON.stringify(entry.project, null, 2),
          name: entry.project.name || entry.name,
        });
        names.add(key);
      } catch {
        /* Keep going so one large project does not block the rest. */
      }
    }
    const listed = await api.cloudList();
    for (const tab of workspaceRef.current.tabs) {
      const key = tab.project.name.trim().toLowerCase();
      const match = listed.find((row) => row.name.trim().toLowerCase() === key);
      await persistCloudRef.current(
        tab.id,
        tab.project,
        tab.syncPath ?? match?.path ?? null,
        { quiet: true, force: true },
      );
    }
  };

  const enableCloud = async (target: CloudTarget) => {
    const api = window.mockupDesktop;
    if (!api?.cloudUse || !api.cloudPick) {
      notify('Sync to iCloud or Google Drive is available in the Mac app.');
      return;
    }
    setCloudBusy(true);
    try {
      const result = target === 'pick' ? await api.cloudPick() : await api.cloudUse(target);
      setCloud(result.status);
      if (!result.canceled && result.status.configured) {
        await publishExistingWork();
        await pullTemplatesRef.current({ mergeLocal: true });
        await refreshCloudProjects();
        const where = result.status.label || 'your drive';
        notify(`Projects and templates now save to ${where} and sync from there.`);
        setSyncMenuOpen(false);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not set up sync');
    } finally {
      setCloudBusy(false);
    }
  };

  const stopCloud = async () => {
    try {
      const status = await window.mockupDesktop?.cloudClear?.();
      if (status) setCloud(status);
      setCloudProjects([]);
      setSyncMenuOpen(false);
      notify('Stopped syncing. Your files stay in the folder you chose.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not stop syncing');
    }
  };

  const removeCloudProject = async (filePath: string) => {
    const entry = cloudProjects.find((item) => item.path === filePath);
    const name = entry?.name || 'this project';
    const where = cloud?.label || 'the sync folder';
    if (!window.confirm(`Remove “${name}” from ${where}? This deletes the file from the sync folder.`)) return;
    try {
      await window.mockupDesktop?.cloudRemove?.(filePath);
      setCloudProjects((current) => current.filter((item) => item.path !== filePath));
      const recent = recentProjects.find((item) => item.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (recent) setRecentProjects(removeRecentProject(recent.id));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not remove that project');
    }
  };

  const refreshCloudStatus = useCallback(() => {
    const api = window.mockupDesktop;
    if (!api?.cloudStatus) return;
    void api.cloudStatus().then((status) => {
      setCloud(status);
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Could not check iCloud or Google Drive';
      notifyRef.current(
        message.includes('No handler')
          ? 'Restart Mockup Studio, then tap Sync again.'
          : message,
      );
    });
  }, []);

  useEffect(() => {
    const api = window.mockupDesktop;
    if (!api?.cloudStatus) return undefined;
    refreshCloudStatus();
    const stop = api.onCloudChanged?.(() => {
      void pullRemoteRef.current();
    });
    return () => {
      stop?.();
    };
  }, [refreshCloudStatus]);

  useEffect(() => {
    if (!cloud?.configured || cloud.missing) return;
    void pullTemplatesRef.current({ mergeLocal: true });
  }, [cloud?.configured, cloud?.path, cloud?.missing]);

  useEffect(() => {
    if (!syncMenuOpen) return;
    refreshCloudStatus();
  }, [syncMenuOpen, refreshCloudStatus]);

  useEffect(() => {
    if (!activeTab) return;
    if (baselineRef.current.has(activeTab.id)) return;
    baselineRef.current.set(activeTab.id, canonicalProjectJson(activeTab.project));
  }, [activeTab?.id]);

  useEffect(() => {
    if (!activeTab || !cloud?.configured) return undefined;
    const tabId = activeTab.id;
    const snapshot = project;
    const knownPath = activeTab.syncPath ?? syncPathByTabRef.current.get(tabId) ?? null;
    const timer = window.setTimeout(() => {
      void persistCloudRef.current(tabId, snapshot, knownPath, { quiet: true });
    }, 1400);
    return () => {
      window.clearTimeout(timer);
      if (activeIdRef.current !== tabId) {
        void persistCloudRef.current(tabId, snapshot, knownPath, { quiet: true });
      }
    };
  }, [project, activeTab?.id, activeTab?.syncPath, cloud?.configured, cloud?.path]);

  useEffect(() => {
    if (hasOpenProject || !cloud?.configured || cloud.missing) return;
    void refreshCloudProjects();
  }, [hasOpenProject, cloud?.configured, cloud?.missing, cloud?.path, refreshCloudProjects]);

  useEffect(() => {
    if (!syncMenuOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!syncMenuRef.current?.contains(event.target as Node)) setSyncMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSyncMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [syncMenuOpen]);

  useEffect(() => {
    if (!shapeMenu) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!shapeMenuRef.current?.contains(target) && !floatingMenuRef.current?.contains(target)) setShapeMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShapeMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [shapeMenu]);

  useEffect(() => {
    if (!textMenu) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (textToolRef.current?.contains(target) || textMenuRef.current?.contains(target)) return;
      if (canvasStageRef.current?.contains(target)) return;
      setTextMenu(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTextMenu(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [textMenu]);

  useEffect(() => {
    if (!fileMenuOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!fileMenuRef.current?.contains(event.target as Node)) setFileMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFileMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [fileMenuOpen]);

  useEffect(() => {
    const el = canvasStageRef.current;
    if (!el) return undefined;
    const update = () => setStageSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasOpenProject]);

  useEffect(() => () => {
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
  }, []);

  const applyScreenImage = (
    dataUrl: string,
    name: string,
    message = 'Screenshot added to your device',
    deviceId?: string | null,
  ) => {
    setProject((current) => {
      const targetId = deviceId && current.devices.some((device) => device.id === deviceId)
        ? deviceId
        : (hoveredDeviceIdRef.current && current.devices.some((device) => device.id === hoveredDeviceIdRef.current)
          ? hoveredDeviceIdRef.current
          : getSelectedDevice(current).id);
      const next = applyScreenToDevice(current, targetId, dataUrl);
      if (!isPlaceholderScreenshot(dataUrl)) {
        const platform = resolvePublishTarget(next);
        setRecentScreenshots((recent) => rememberRecentScreenshot(recent, dataUrl, name, platform));
      }
      return next;
    });
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
      applyScreenImage(url, file.name, 'Screen recording added to your device');
      return;
    }
    applyScreenImage(url, file.name);
  };

  const pasteScreenFromClipboard = async (event?: ClipboardEvent, deviceId?: string | null) => {
    try {
      const svgText = event ? readSvgTextFromPasteEvent(event) : null;
      if (svgText) {
        openSvgExplode(svgText, 'pasted.svg');
        return;
      }
      const fromEvent = event ? await readImageFromPasteEvent(event) : null;
      const image = fromEvent ?? await readImageFromClipboard();
      const targetId = deviceId ?? hoveredDeviceIdRef.current;
      applyScreenImage(image.dataUrl, image.name, 'Pasted onto the device screen', targetId);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Nothing to paste — copy an image first');
    }
  };

  const applyRecentScreenshot = (shot: RecentScreenshot) => {
    applyScreenImage(shot.dataUrl, shot.name, 'Screenshot applied');
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

    const preferredPlatform = resolvePublishTarget(project);
    let target: 'ios' | 'android' | null = null;
    if (iosReady && !androidReady) target = 'ios';
    else if (androidReady && !iosReady) target = 'android';
    else if (iosReady && androidReady) target = preferredPlatform;
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
        else if (iosList.length && androidList.length) target = preferredPlatform;
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
      applyScreenImage(dataUrl, name, 'Snapshot applied to the active platform screen');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Snapshot failed');
    } finally {
      setMirrorBusy(false);
    }
  };

  const keyCameraPosition = useCallback((position: Vec3, time: number) => {
    const rounded = {
      x: Number(position.x.toFixed(4)),
      y: Number(position.y.toFixed(4)),
      z: Number(position.z.toFixed(4)),
    };
    setProject((current) => {
      let tracks = current.animation.tracks;
      (['camera.x', 'camera.y', 'camera.z'] as const).forEach((property) => {
        const value = property === 'camera.x' ? rounded.x : property === 'camera.y' ? rounded.y : rounded.z;
        const existing = tracks.find((t) => t.targetId === CAMERA_TARGET_ID && t.property === property);
        const base = existing ?? {
          id: `track-camera-${property}`,
          targetId: CAMERA_TARGET_ID,
          property,
          keyframes: [],
        };
        const updated = upsertKeyframe(base, time, value);
        tracks = existing
          ? tracks.map((t) => (t.id === existing.id ? updated : t))
          : [...tracks, updated];
      });
      return { ...current, animation: { ...current.animation, tracks } };
    });
  }, [setProject]);

  const onCameraCommit = useCallback((position: Vec3) => {
    if (!timelineOpenRef.current) return;
    keyCameraPosition(position, animTimeRef.current);
  }, [keyCameraPosition]);

  const onOrbitStart = useCallback(() => {
    setAnimPlaying(false);
  }, [setAnimPlaying]);

  const keyCameraAtPlayhead = () => {
    setTimelineOpen(true);
    keyCameraPosition(liveCameraPose, animTime);
    notify('Camera keyframed');
  };

  const applyStudioPose = (poseId: string) => {
    const pose = getStudioPose(poseId, savedAngles);
    if (!pose) return;
    setProject((current) => {
      const selected = getSelectedDevice(current);
      const delta = {
        x: pose.rotation.x - selected.rotation.x,
        y: pose.rotation.y - selected.rotation.y,
        z: pose.rotation.z - selected.rotation.z,
      };
      const link = current.compositionMode === 'split' && current.linkSplitTransform !== false;
      const devices = current.devices.map((device) => (
        device.id === selected.id || link
          ? { ...device, rotation: { ...pose.rotation } }
          : device
      ));
      let animation = current.animation;
      for (const device of current.devices) {
        if (device.id === selected.id || link) {
          animation = shiftDeviceRotation(animation, device.id, delta);
        }
      }
      return syncProjectFromSelected(
        { ...current, devices, animation },
        { ...selected, rotation: { ...pose.rotation } },
      );
    });
    setAnimPlaying(false);
    notify(`${pose.label} angle`);
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

  const openStudioAi = () => {
    setStudioAiOpen(true);
    setStudioAiStatus(null);
  };

  const closeStudioAi = useCallback(() => {
    setStudioAiOpen(false);
    setStudioAiStatus(null);
  }, []);

  const runStudioAiPrompt = useCallback((raw: string) => {
    const text = raw.trim();
    if (!text || studioAiBusy) return;
    setStudioAiBusy(true);
    const selected = getSelectedDevice(project);
    void promptToAnimationSmart(text, animation, selected, project.devices, (status) => {
      setStudioAiStatus(status);
    }).then((result) => {
      updateProject({ animation: result.clip });
      setAnimTime(0);
      setAnimPlaying(result.label !== 'Clear');
      setTimelineOpen(true);
      setStudioAiStatus(result.summary);
      setStudioAiPrompt('');
      notify(result.summary);
    }).catch(() => {
      setStudioAiStatus('Could not build that motion');
    }).finally(() => {
      window.setTimeout(() => setStudioAiBusy(false), 140);
    });
  }, [animation, project, studioAiBusy, updateProject, setAnimTime, setAnimPlaying, setTimelineOpen]);

  useEffect(() => {
    if (!studioAiOpen) return;
    const focusId = window.requestAnimationFrame(() => {
      studioAiInputRef.current?.focus();
    });
    const onPointerDown = (event: PointerEvent) => {
      if (!studioAiShellRef.current?.contains(event.target as Node)) {
        closeStudioAi();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeStudioAi();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusId);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [studioAiOpen, closeStudioAi]);

  useEffect(() => {
    if (!deviceDropdownOpen && !splitDeviceMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (deviceDropdownRef.current && !deviceDropdownRef.current.contains(target)) {
        setDeviceDropdownOpen(false);
      }
      if (splitDeviceMenu && !(target instanceof Element && target.closest('.device-dropdown'))) {
        setSplitDeviceMenu(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setDeviceDropdownOpen(false);
      setSplitDeviceMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [deviceDropdownOpen, splitDeviceMenu]);

  useEffect(() => {
    if (!aspectDropdownOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const inAnchor = aspectDropdownRef.current?.contains(target);
      const inMenu = target instanceof Element && target.closest('.aspect-ratio-menu');
      if (!inAnchor && !inMenu) setAspectDropdownOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setAspectDropdownOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [aspectDropdownOpen]);

  useEffect(() => {
    if (!deviceMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.device-action-menu')) return;
      setDeviceMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setDeviceMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [deviceMenu]);

  const onImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    void importScreenMedia(event.currentTarget.files?.[0]).catch((e: Error) => notify(e.message));
    event.currentTarget.value = '';
  };

  const takeDroppedFiles = async (dataTransfer: DataTransfer) => {
    const files = await collectDroppedFiles(dataTransfer);
    const projectFile = files.find((file) => isProjectFileName(file.name));
    if (projectFile) {
      try {
        if (projectFile.size > 45_000_000) throw new Error('This project file is too large.');
        applyProject(await readProjectFileContents(projectFile));
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Invalid project');
      }
      return;
    }
    const offer = meshDropOffer(files);
    if (offer) {
      setMeshOffer(offer);
      return;
    }
    const screen = files.find((file) => isImageFile(file) || isVideoFile(file) || /\.svg$/i.test(file.name));
    void importScreenMedia(screen ?? files[0]).catch((error: Error) => notify(error.message));
  };

  const placeImportedCustomDevices = (imported: CustomDeviceMeta[]) => {
    if (!imported.length) return;
    setCustomDevices(loadCustomDeviceMeta());
    setDevicesTick((n) => n + 1);
    const [first, ...rest] = imported;
    setProject((current) => {
      const selected = getSelectedDevice(current);
      let devices = current.devices.map((device) => (
        device.id === selected.id ? { ...device, deviceId: first.id } : device
      ));
      if (current.compositionMode !== 'split' && rest.length) {
        const base = devices.find((d) => d.id === selected.id) ?? devices[0];
        let added = 0;
        for (const meta of rest) {
          if (devices.length >= Math.min(MAX_DEVICES, entitlementsMaxDevices)) break;
          added += 1;
          devices = [...devices, createDeviceInstance({
            deviceId: meta.id,
            rotation: { ...base.rotation, y: base.rotation.y + (added % 2 === 0 ? 18 : -18) },
            scale: base.scale,
            position: {
              x: base.position.x + 1.15 * added,
              y: base.position.y,
              z: base.position.z - added * 0.08,
            },
            glassReflection: base.glassReflection,
            reflectionStyle: base.reflectionStyle,
            screenshot: null,
            deviceColor: base.deviceColor ?? current.deviceColor,
            clayMode: base.clayMode ?? current.clayMode,
          })];
        }
      }
      const nextSelected = devices.find((d) => d.id === selected.id) ?? devices[0];
      return syncProjectFromSelected({ ...current, devices }, nextSelected);
    });
    if (isPlaceholderScreenshot(activeEnvScreenshot)) {
      applyScreenImage(placeholderForDevice(first.id), first.label || 'Custom', 'Size guide updated');
    }
  };

  const confirmMeshExtract = async () => {
    if (!meshOffer || meshOffer.error || meshExtracting) return;
    setMeshExtracting(true);
    try {
      const { imported, skipped } = await importCustomDevices({ files: meshOffer.files });
      placeImportedCustomDevices(imported);
      const skipNote = skipped ? ` · ${skipped} skipped (library full)` : '';
      notify(
        imported.length === 1
          ? `Extracted “${imported[0].label}”${skipNote}`
          : `Extracted ${imported.length} models${skipNote}`,
      );
      setMeshOffer(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not extract that model');
    } finally {
      setMeshExtracting(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    void takeDroppedFiles(event.dataTransfer);
  };

  useEffect(() => {
    if (!meshOffer) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || meshExtracting) return;
      event.preventDefault();
      setMeshOffer(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [meshOffer, meshExtracting]);

  const writeProjectFile = async (snapshot: MockupProject, opts?: { forceDialog?: boolean }) => {
    const contents = JSON.stringify(snapshot, null, 2);
    const fileName = safeFilename(snapshot.name);
    if (!opts?.forceDialog && window.mockupDesktop?.cloudWrite && cloudRef.current?.configured) {
      const tabId = activeTab?.id;
      if (!tabId) return false;
      const savedPath = await persistCloudRef.current(
        tabId,
        snapshot,
        activeTab?.syncPath ?? null,
        { quiet: false, force: true },
      );
      if (savedPath) trackRecent(snapshot);
      return Boolean(savedPath);
    }
    if (window.mockupDesktop) {
      const result = await window.mockupDesktop.saveProject(contents, fileName);
      if (result.canceled) return false;
      trackRecent(snapshot);
      if (result.path && cloudRef.current?.path && isPathInsideLibrary(result.path, cloudRef.current.path) && activeTab) {
        savedJsonRef.current.set(result.path, canonicalProjectJson(snapshot));
        syncPathByTabRef.current.set(activeTab.id, result.path);
        setWorkspace((ws) => ({
          ...ws,
          tabs: ws.tabs.map((tab) => (
            tab.id === activeTab.id ? { ...tab, syncPath: result.path } : tab
          )),
        }));
      }
      notify(opts?.forceDialog ? 'Project saved as new file' : 'Project saved successfully');
      return true;
    }
    const bytes = await encodeMockupFile(contents);
    downloadBlob(new Blob([bytes as BlobPart], { type: MOCKUP_MIME }), mockupDownloadName(fileName));
    trackRecent(snapshot);
    notify(opts?.forceDialog ? 'Project downloaded as new file' : 'Project downloaded');
    return true;
  };

  const onSave = async () => {
    if (!hasOpenProject || !activeTab) return;
    try {
      await writeProjectFile(project);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to save project');
    }
  };

  const onSaveAs = async () => {
    if (!hasOpenProject || !activeTab) return;
    try {
      await writeProjectFile(project, { forceDialog: true });
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to save project');
    }
  };

  const onDuplicateProject = () => {
    if (!hasOpenProject) return;
    try {
      const clone = validateProject(JSON.parse(JSON.stringify(project)) as unknown);
      const named = {
        ...clone,
        name: uniqueProjectName(`${clone.name || 'Untitled'} copy`),
      };
      openProjectInTab(named, `Duplicated “${project.name}”`, null);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to duplicate project');
    }
  };

  const applyProject = (data: string, filePath?: string) => {
    const parsed = validateProject(JSON.parse(data) as unknown);
    const named = { ...parsed, name: uniqueProjectName(parsed.name || 'Opened project') };
    const libraryPath = cloudRef.current?.path;
    const inside = Boolean(filePath && libraryPath && isPathInsideLibrary(filePath, libraryPath));
    if (inside && filePath) {
      const existing = workspaceRef.current.tabs.find((tab) => tab.syncPath === filePath);
      if (existing) {
        switchTab(existing.id);
        notify(`Opened “${existing.project.name}”`);
        return;
      }
    }
    openProjectInTab(named, `Opened “${named.name}”`, inside ? filePath : null);
  };

  const onOpen = async () => {
    try {
      if (window.mockupDesktop) {
        const result = await window.mockupDesktop.openProject();
        if (!result.canceled && result.contents) applyProject(result.contents, result.path);
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
      applyProject(await readProjectFileContents(file));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Invalid project');
    }
  };

  const primaryExportAspect = (
    previewFrame !== 'free' && exportAspectIds.includes(previewFrame)
      ? previewFrame
      : exportAspectIds[0]
  ) ?? 'custom';

  const aspectHasLockedPixels = useCallback((id: string) => (
    savedSizes.some((item) => item.id === id) || exportAspectHasFixed(id as ExportAspectId)
  ), [savedSizes]);

  const resolveExportSize = (aspectId: string = primaryExportAspect) => {
    const saved = savedSizes.find((item) => item.id === aspectId);
    if (saved) return { width: saved.width, height: saved.height, label: `${saved.width} × ${saved.height}` };
    const resolutionId = exportAspectHasFixed(aspectId as ExportAspectId)
      ? 'native'
      : aspectId === 'custom'
        ? 'custom'
        : exportResolution === 'native'
          ? 'fhd'
          : exportResolution;
    return resolveExportDimensions(aspectId as ExportAspectId, resolutionId, customExportSize);
  };

  const availableResolutions = useMemo(() => {
    const flexible = exportAspectIds.some((id) => !aspectHasLockedPixels(id) && id !== 'custom');
    const onlyCustom = exportAspectIds.length > 0 && exportAspectIds.every((id) => id === 'custom');
    const onlyFixed = exportAspectIds.length > 0 && exportAspectIds.every((id) => aspectHasLockedPixels(id));
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
  }, [aspectHasLockedPixels, exportAspectIds]);

  const previewAspect = previewFrame === 'free' ? null : frameMeta(previewFrame, savedSizes);

  const canvasFormatOptions = useMemo(() => {
    const saved = savedSizes.map((item) => ({
      id: item.id,
      label: item.label,
      hint: `${item.width}×${item.height}`,
      group: 'Your sizes',
    }));
    const builtins = EXPORT_ASPECT_GROUPS.flatMap((group) => (
      EXPORT_ASPECTS
        .filter((item) => item.group === group.id && item.id !== 'custom')
        .map((item) => ({
          id: item.id,
          label: item.shortLabel,
          hint: item.hint,
          group: group.label,
        }))
    ));
    return [...saved, ...builtins];
  }, [savedSizes]);

  const aspectSlug = (aspectId: string) => {
    const meta = frameMeta(aspectId, savedSizes);
    return (meta?.shortLabel ?? aspectId).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  };

  const focusPlatformAspect = useCallback((id: string) => {
    const saved = savedSizes.find((item) => item.id === id);
    if (saved) {
      setPreviewFrame(saved.id);
      setExportResolution('native');
      // Keep the user's custom px — platform/native sizes must not overwrite it.
      return;
    }
    const fixed = exportAspectFixedSize(id as ExportAspectId);
    if (fixed) {
      setPreviewFrame(id);
      setExportResolution('native');
      return;
    }
    if (id === 'custom') {
      setPreviewFrame('free');
      setExportResolution('custom');
      return;
    }
    setPreviewFrame(id);
    setExportResolution((current) => (current === 'native' || current === 'custom' ? 'fhd' : current));
  }, [savedSizes]);

  const applyPlatformFrame = useCallback((id: string) => {
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

  const toggleExportAspect = useCallback((id: string) => {
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

  const captureStillFromApi = async (
    api: CaptureApi | null,
    width: number,
    height: number,
    time: number,
    withOverlays = true,
  ) => {
    if (!api) throw new Error('The 3D preview is not ready yet');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create export canvas');
    api.drawFrame(width, height, ctx);
    if (withOverlays) await drawOverlays(ctx, project.overlays, width, height, time);
    return canvas;
  };

  const captureStillCanvas = async (width: number, height: number, time: number) => (
    captureStillFromApi(captureRef.current, width, height, time, true)
  );

  /** Stitch the two dual-canvas panes into one side-by-side still. */
  const captureDualCombinedStill = async (width: number, height: number, time: number) => {
    if (!iosCaptureRef.current || !androidCaptureRef.current) {
      throw new Error('Both platform canvases need to be ready to export');
    }
    const leftW = Math.floor(width / 2);
    const rightW = width - leftW;
    const even = (n: number) => (n % 2 === 0 ? n : n - 1);
    const iosW = Math.max(2, even(leftW));
    const androidW = Math.max(2, even(rightW));
    const canvas = document.createElement('canvas');
    canvas.width = iosW + androidW;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create export canvas');
    const iosPane = await captureStillFromApi(iosCaptureRef.current, iosW, height, time, false);
    const androidPane = await captureStillFromApi(androidCaptureRef.current, androidW, height, time, false);
    ctx.drawImage(iosPane, 0, 0);
    ctx.drawImage(androidPane, iosW, 0);
    await drawOverlays(ctx, project.overlays, canvas.width, height, time);
    return canvas;
  };

  const exportStillsAtSize = async (
    formats: StillFormatId[],
    width: number,
    height: number,
    scaleLabel: string,
    platformTag = '',
  ) => {
    if (!formats.length) return;
    const scaleSuffix = scaleLabel === '1x' ? '' : `@${scaleLabel}`;
    const platformSuffix = platformTag ? `${platformTag}-` : '';
    const baseName = `${safeFilename(project.name)}-${platformSuffix}${width}x${height}${scaleSuffix}`;
    const labels = formats.map((format) => stillFormatById(format).label).join(' + ');

    if (project.compositionMode === 'split' && exportMode === 'separate') {
      if (!iosCaptureRef.current || !androidCaptureRef.current) {
        throw new Error('Both platform canvases need to be ready to export');
      }
      setExportProgress(`Rendering iOS ${labels}…`);
      const iosCanvas = await captureStillFromApi(iosCaptureRef.current, width, height, animTime, true);
      for (const format of formats) {
        await saveCapture(stillDataUrlFromCanvas(iosCanvas, format), `${baseName}-ios`, format);
      }

      setExportProgress(`Rendering Android ${labels}…`);
      const androidCanvas = await captureStillFromApi(androidCaptureRef.current, width, height, animTime, true);
      for (const format of formats) {
        await saveCapture(stillDataUrlFromCanvas(androidCanvas, format), `${baseName}-android`, format);
      }
      return;
    }

    if (project.compositionMode === 'split') {
      setExportProgress(`Rendering dual canvas ${labels}${scaleLabel !== '1x' ? ` · ${scaleLabel}` : ''}…`);
      const canvas = await captureDualCombinedStill(width, height, animTime);
      for (const format of formats) {
        await saveCapture(stillDataUrlFromCanvas(canvas, format), `${baseName}-ios-android`, format);
      }
      return;
    }

    if (!captureRef.current) throw new Error('The 3D preview is not ready yet');
    setExportProgress(`Rendering ${platformTag ? `${platformTag} · ` : ''}${labels}${scaleLabel !== '1x' ? ` · ${scaleLabel}` : ''}…`);
    const canvas = await captureStillCanvas(width, height, animTime);
    for (const format of formats) {
      await saveCapture(stillDataUrlFromCanvas(canvas, format), baseName, format);
    }
  };

  const exportVideoAtSize = async (
    format: VideoFormatId,
    width: number,
    height: number,
    scaleLabel: string,
    platformTag = '',
  ) => {
    const dual = project.compositionMode === 'split';
    if (dual) {
      if (!iosCaptureRef.current || !androidCaptureRef.current) {
        throw new Error('Both platform canvases need to be ready to export');
      }
    } else if (!captureRef.current) {
      throw new Error('The 3D preview is not ready yet');
    }
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
        if (dual) {
          const leftW = Math.max(2, Math.floor(frameWidth / 2) & ~1);
          const rightW = Math.max(2, (frameWidth - leftW) & ~1);
          const left = document.createElement('canvas');
          left.width = leftW;
          left.height = frameHeight;
          const right = document.createElement('canvas');
          right.width = rightW;
          right.height = frameHeight;
          const leftCtx = left.getContext('2d');
          const rightCtx = right.getContext('2d');
          if (!leftCtx || !rightCtx) throw new Error('Could not create dual export buffers');
          iosCaptureRef.current?.drawFrame(leftW, frameHeight, leftCtx);
          androidCaptureRef.current?.drawFrame(rightW, frameHeight, rightCtx);
          ctx.clearRect(0, 0, frameWidth, frameHeight);
          ctx.drawImage(left, 0, 0);
          ctx.drawImage(right, leftW, 0);
        } else {
          captureRef.current?.drawFrame(frameWidth, frameHeight, ctx);
        }
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
      const seeded = {
        ...selected,
        screenshot: deviceScreenMedia(selected, current.screenshot),
        deviceColor: selected.deviceColor ?? current.deviceColor,
        clayMode: selected.clayMode ?? current.clayMode,
      };
      const devices = buildPlatformSplitDevices(seeded, current);
      const target = platformOfDevice(selected);
      return setPublishTarget({
        ...current,
        compositionMode: 'split',
        devices,
        cameraView: 'front',
        linkSplitTransform: current.linkSplitTransform !== false,
      }, target);
    });
    setDeviceMenu(null);
    notify('Split iOS + Android ready — each platform keeps its own screen');
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
        reflectionStyle: selected.reflectionStyle,
        screenshot: deviceScreenMedia(selected, current.screenshot),
        deviceColor: selected.deviceColor ?? current.deviceColor,
        clayMode: selected.clayMode ?? current.clayMode,
      });
      return setPublishTarget({
        ...current,
        compositionMode: 'single',
        devices: [single],
      }, platformOfDevice(single));
    });
    setDeviceMenu(null);
    notify('Single device composition');
  };

  const switchPublishTarget = (target: PublishTarget, opts?: { quiet?: boolean }) => {
    setProject((current) => setPublishTarget(current, target));
    setDeviceChosen(true);
    if (!opts?.quiet) {
      notify(target === 'ios' ? 'Editing iOS environment' : 'Editing Android environment');
    }
  };

  const copyActiveScreenToOtherPlatform = () => {
    setProject((current) => {
      if (current.compositionMode !== 'split') return current;
      return copyScreenToOtherPlatform(current);
    });
    notify('Copied active screen to the other platform');
  };

  const onSelectDevice = (payload: DeviceSelectPayload) => {
    pinLayer('device', payload.id);
    setLightGizmoActive(false);
    setStudioSetFocus(null);
    setDeviceChosen(true);
    setProject((current) => {
      const selected = current.devices.find((d) => d.id === payload.id);
      if (!selected) return current;
      // Bind the gimbal to the device that was tapped. setPublishTarget would
      // jump back to the first device of that platform.
      return syncProjectFromSelected({
        ...current,
        publishTarget: platformOfDevice(selected),
      }, selected);
    });
    if (payload.openMenu === false) {
      setDeviceMenu(null);
      return;
    }
    setDeviceMenu({ id: payload.id, x: payload.clientX, y: payload.clientY });
  };

  const focusKeyLight = useCallback(() => {
    setLayerSelection({ kind: 'key-light' });
    setLightGizmoActive(true);
    setOpenSectionId('light');
  }, []);

  const focusSceneLight = useCallback((lightId: string) => {
    setLayerSelection({ kind: 'scene-light', id: lightId });
    setLightGizmoActive(false);
    setOpenSectionId('light');
  }, []);

  const patchSceneLightPosition = useCallback((id: string, position: Vec3) => {
    setProject((current) => ({
      ...current,
      sceneLights: (current.sceneLights ?? []).map((light) => (
        light.id === id ? { ...light, position: { ...position } } : light
      )),
    }));
  }, []);

  const onRotateDevice = (id: string, rotation: Vec3, opts?: { recordKeys?: boolean }) => {
    const recordKeys = opts?.recordKeys !== false;
    const nextRotation = {
      x: Math.max(-180, Math.min(180, rotation.x)),
      y: Math.max(-180, Math.min(180, rotation.y)),
      z: Math.max(-180, Math.min(180, rotation.z)),
    };
    setProject((current) => {
      const selectedDevice = current.devices.find((d) => d.id === id) ?? getSelectedDevice(current);
      const linkTransform = current.linkSplitTransform !== false;
      const devices = current.devices.map((device) => (
        (current.compositionMode === 'split' && linkTransform) || device.id === id
          ? { ...device, rotation: { ...nextRotation } }
          : device
      ));
      const nextSelected = devices.find((d) => d.id === selectedDevice.id) ?? devices[0];
      let next = syncProjectFromSelected({ ...current, devices }, nextSelected);
      if (timelineOpen && recordKeys) {
        const targetIds = (current.compositionMode === 'split' && linkTransform)
          ? current.devices.map((d) => d.id)
          : [id];
        let tracks = next.animation.tracks;
        for (const targetId of targetIds) {
          (['rotation.x', 'rotation.y', 'rotation.z'] as const).forEach((property) => {
            const axis = property.split('.')[1] as 'x' | 'y' | 'z';
            const existing = tracks.find((t) => t.targetId === targetId && t.property === property);
            const base = existing ?? { id: `track-${targetId}-${property}`, targetId, property, keyframes: [] };
            const updated = upsertKeyframe(base, animTime, nextRotation[axis]);
            tracks = existing
              ? tracks.map((t) => (t.id === existing.id ? updated : t))
              : [...tracks, updated];
          });
        }
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

  const onMoveProp = (id: string, position: Vec3) => {
    const nextPosition = {
      x: Math.max(-10, Math.min(10, position.x)),
      y: Math.max(-6, Math.min(6, position.y)),
      z: Math.max(-8, Math.min(8, position.z)),
    };
    setProject((current) => ({
      ...current,
      sceneProps: (current.sceneProps ?? []).map((prop) => (
        prop.id === id ? { ...prop, position: { ...nextPosition } } : prop
      )),
    }));
  };

  const onRotateProp = (id: string, rotation: Vec3) => {
    const nextRotation = {
      x: Math.max(-180, Math.min(180, rotation.x)),
      y: Math.max(-180, Math.min(180, rotation.y)),
      z: Math.max(-180, Math.min(180, rotation.z)),
    };
    setProject((current) => ({
      ...current,
      sceneProps: (current.sceneProps ?? []).map((prop) => (
        prop.id === id ? { ...prop, rotation: { ...nextRotation } } : prop
      )),
    }));
  };

  const selectSceneProp = (id: string) => {
    pinLayer('prop', id);
    setLightGizmoActive(false);
    setSidePanelsHidden(false);
    setOpenSectionId('look');
    setDeviceMenu(null);
    setPickedMaterial(null);
    const prop = (project.sceneProps ?? []).find((entry) => entry.id === id);
    setStudioSetFocus(prop?.kind === 'studio_backdrop' ? 'backdrop' : null);
  };

  const focusStudioColour = (stop: Exclude<StudioSetFocus, null>) => {
    // Transparent looks still open the dock so the user can restore colours.
    const deviceId = project.selectedDeviceId || project.devices[0]?.id || 'backdrop';
    // Pin the studio set so the Backdrop looks panel can expand with the dock.
    pinLayer('backdrop', deviceId);
    setLightGizmoActive(false);
    setSidePanelsHidden(false);
    setModelingPanelOpen(true);
    // Keep Look collapsed — the colour dock / Backdrop looks open only from this tap.
    setDeviceMenu(null);
    setPickedMaterial(null);
    setStudioSetFocus(stop);
  };

  const selectBackdrop = () => {
    focusStudioColour('backdrop');
  };

  /** Empty surround sky (not device / stage / backdrop wall) → Look panel Sky colour. */
  const selectSky = () => {
    focusStudioColour('sky');
  };

  /** Empty floor / ground plane → Look panel Floor colour. */
  const selectFloor = () => {
    focusStudioColour('floor');
  };

  const selectEmptyCanvas = (target: 'sky' | 'floor' | 'backdrop') => {
    focusStudioColour(target);
  };

  const onPickMaterial = useCallback((payload: MaterialPickPayload) => {
    setPickedMaterial({
      deviceInstanceId: payload.deviceInstanceId,
      materialName: payload.materialName,
      colorHex: payload.colorHex,
    });
    setStudioSetFocus(null);
    pinLayer('device', payload.deviceInstanceId);
  }, []);

  const persistCustomMaterialTweaks = useCallback((deviceId: string, tweaks: Record<string, MaterialTweak> | undefined) => {
    if (!isCustomDeviceId(deviceId)) return;
    void updateCustomDeviceMeta(deviceId, { tweaks: tweaks ?? undefined }).then(() => {
      setCustomDevices(loadCustomDeviceMeta());
      setDevicesTick((n) => n + 1);
    });
  }, []);

  const patchPickedMaterial = useCallback((patch: MaterialTweak) => {
    setPickedMaterial((current: PickedMaterial | null) => {
      if (!current) return current;
      const { deviceInstanceId, materialName } = current;
      setProject((project) => {
        const devices = project.devices.map((device) => {
          if (device.id !== deviceInstanceId) return device;
          const nextTweaks = {
            ...(device.materialTweaks ?? {}),
            [materialName]: {
              ...(device.materialTweaks?.[materialName] ?? {}),
              ...patch,
            },
          };
          persistCustomMaterialTweaks(device.deviceId, nextTweaks);
          return { ...device, materialTweaks: nextTweaks };
        });
        return { ...project, devices };
      });
      return current;
    });
  }, [persistCustomMaterialTweaks]);

  const clearPickedMaterialOverrides = useCallback(() => {
    setPickedMaterial((current: PickedMaterial | null) => {
      if (!current) return current;
      const { deviceInstanceId, materialName } = current;
      setProject((project) => {
        const devices = project.devices.map((device) => {
          if (device.id !== deviceInstanceId) return device;
          if (!device.materialTweaks?.[materialName]) return device;
          const nextTweaks = { ...device.materialTweaks };
          delete nextTweaks[materialName];
          const cleaned = Object.keys(nextTweaks).length ? nextTweaks : undefined;
          persistCustomMaterialTweaks(device.deviceId, cleaned);
          return { ...device, materialTweaks: cleaned };
        });
        return { ...project, devices };
      });
      return current;
    });
  }, [persistCustomMaterialTweaks]);

  const applyMaterialPresetToPicked = useCallback((presetId: MaterialPresetId) => {
    patchPickedMaterial(tweakFromPreset(presetId));
  }, [patchPickedMaterial]);

  const setPickedMaterialMap = useCallback((
    slot: 'mapDataUrl' | 'normalMapDataUrl',
    dataUrl: string | null,
  ) => {
    patchPickedMaterial({ [slot]: dataUrl });
  }, [patchPickedMaterial]);

  const patchSceneProp = useCallback((propId: string, patch: Partial<SceneProp>) => {
    setProject((current) => {
      const nextProps = (current.sceneProps ?? []).map((prop) => (
        prop.id === propId ? { ...prop, ...patch } : prop
      ));
      const edited = nextProps.find((prop) => prop.id === propId);
      // Backdrop prop only drives the Backdrop wall stop — Sky and Floor stay independent.
      if (edited?.kind === 'studio_backdrop' && typeof patch.color === 'string') {
        const hex = patch.color.toLowerCase();
        if (/^#[0-9a-fA-F]{6}$/.test(hex) && hex !== current.gradientColors.center) {
          const gradientColors = { ...current.gradientColors, center: hex };
          return patchActiveCompositionScene({
            ...current,
            sceneProps: nextProps,
            gradientColors,
            background: current.background === 'transparent' ? current.background : 'custom',
          }, { gradientColors, background: current.background === 'transparent' ? current.background : 'custom' });
        }
      }
      return { ...current, sceneProps: nextProps };
    });
  }, []);

  const addDeviceToScene = (opts?: { quiet?: boolean }) => {
    let message = 'Device added';
    let added = false;
    setProject((current) => {
      if (current.compositionMode === 'split') {
        message = 'Switch off iOS + Android to add more devices in one canvas';
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
      const slot = current.devices.length;
      const copy = createDeviceInstance({
        deviceId: selected.deviceId,
        rotation: { ...selected.rotation, y: selected.rotation.y + (slot % 2 === 0 ? 18 : -18) },
        scale: selected.scale,
        position: {
          x: selected.position.x + 1.15,
          y: selected.position.y,
          z: selected.position.z - slot * 0.08,
        },
        glassReflection: selected.glassReflection,
        reflectionStyle: selected.reflectionStyle,
        screenshot: deviceScreenMedia(selected, current.screenshot),
        deviceColor: selected.deviceColor ?? current.deviceColor,
        clayMode: selected.clayMode ?? current.clayMode,
        lidOpen: selected.lidOpen,
      });
      added = true;
      message = `${current.devices.length + 1} devices in this composition`;
      return syncProjectFromSelected({ ...current, devices: [...current.devices, copy] }, copy);
    });
    setDeviceMenu(null);
    if (message.includes('Pro')) setLicenseOpen(true);
    if (!opts?.quiet || added) notify(message);
    return added;
  };

  const duplicateSelectedDevice = () => {
    addDeviceToScene();
  };

  /** Delete the studio backdrop: look goes transparent, any cyclorama prop goes too. */
  const removeBackdrop = () => {
    const props = project.sceneProps ?? [];
    const kept = props.filter((prop) => prop.kind !== 'studio_backdrop');
    const hadProp = kept.length !== props.length;
    const alreadyOff = project.background === 'transparent' && !hadProp;
    if (alreadyOff) return;
    if (layerSelection.kind === 'prop' && props.some((prop) => prop.id === layerSelection.id && prop.kind === 'studio_backdrop')) {
      onLayerSelection({ kind: 'device', id: project.selectedDeviceId });
    }
    updateProject({
      background: 'transparent',
      sceneProps: hadProp ? kept : props,
    });
    setStudioSetFocus(null);
    notify('Backdrop removed · pick a look under Backdrop to bring it back');
  };

  const removeSceneProp = (id: string) => {
    const prop = (project.sceneProps ?? []).find((item) => item.id === id);
    // Treating cyclorama as the backdrop: ✕ should clear the studio set, not leave Soft Studio behind.
    if (prop?.kind === 'studio_backdrop') {
      removeBackdrop();
      return;
    }
    updateProject({
      sceneProps: (project.sceneProps ?? []).filter((item) => item.id !== id),
    });
    if (layerSelection.kind === 'prop' && layerSelection.id === id) {
      onLayerSelection({ kind: 'device', id: project.selectedDeviceId });
    }
    notify('Shape removed');
  };

  const rotateSelectedDevice = () => {
    setProject((current) => {
      const selected = getSelectedDevice(current);
      const rotation = { ...selected.rotation, y: ((selected.rotation.y + 45 + 180) % 360) - 180 };
      const linkTransform = current.linkSplitTransform !== false;
      const devices = current.devices.map((device) => (
        (current.compositionMode === 'split' && linkTransform) || device.id === selected.id
          ? { ...device, rotation: { ...rotation } }
          : device
      ));
      return syncProjectFromSelected({ ...current, devices }, { ...selected, rotation });
    });
    notify('Rotated 45°');
  };

  const deleteDeviceById = (id: string) => {
    let removed = false;
    setProject((current) => {
      if (current.devices.length <= 1) {
        notify('Keep at least one device in the scene');
        return current;
      }
      if (!current.devices.some((device) => device.id === id)) return current;
      const remaining = current.devices.filter((device) => device.id !== id);
      const nextSelected = remaining.find((device) => device.id === current.selectedDeviceId) ?? remaining[0];
      let next = syncProjectFromSelected({ ...current, devices: remaining }, nextSelected);
      // Split needs two envs — dropping one collapses back to a single canvas.
      if (next.compositionMode === 'split' && remaining.length < 2) {
        next = { ...next, compositionMode: 'single' };
      }
      removed = true;
      return next;
    });
    setDeviceMenu(null);
    if (removed) notify('Device removed');
  };

  const deleteSelectedDevice = () => {
    deleteDeviceById(project.selectedDeviceId);
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (event.code === 'Space' || event.key === ' ') {
        if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
        // Hold Space to pan. A tap (no drag) still plays and pauses.
        event.preventDefault();
        if (event.repeat) return;
        spacePannedRef.current = false;
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

      if ((event.key === 'Backspace' || event.key === 'Delete') && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (typing || !hasOpenProject || event.defaultPrevented || event.repeat) return;
        if (layerSelection.kind === 'backdrop') {
          event.preventDefault();
          removeBackdrop();
          return;
        }
        if (layerSelection.kind === 'prop' && layerSelection.id) {
          event.preventDefault();
          const prop = (project.sceneProps ?? []).find((item) => item.id === layerSelection.id);
          // Cyclorama prop = the backdrop; clear the whole studio set, not just the mesh.
          if (prop?.kind === 'studio_backdrop') {
            removeBackdrop();
            return;
          }
          removeSceneProp(layerSelection.id);
          return;
        }
        if (layerSelection.kind === 'overlay' && layerSelection.id) {
          event.preventDefault();
          const id = layerSelection.id;
          updateProject({
            overlays: (project.overlays ?? []).filter((item) => item.id !== id),
          });
          if (selectedOverlayId === id) setSelectedOverlayId(null);
          return;
        }
        // Device row or nested Screen — remove that device.
        if (layerSelection.kind === 'device') {
          event.preventDefault();
          deleteDeviceById(layerSelection.id || project.selectedDeviceId);
          return;
        }
        if (layerSelection.kind === 'screen') {
          event.preventDefault();
          deleteDeviceById(layerSelection.deviceId);
        }
        return;
      }

      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        if (typing) return;
        const tabId = activeIdRef.current;
        const latest = tabId ? changeLogsRef.current.get(tabId)?.[0] : undefined;
        if (!latest) return;
        event.preventDefault();
        restoreChange(latest.id);
        return;
      }
      if (key === 'd' && !event.shiftKey && !event.altKey) {
        if (typing || !hasOpenProject) return;
        event.preventDefault();
        duplicateSelectedDevice();
        return;
      }
      if (key === 's') {
        event.preventDefault();
        if (event.shiftKey) {
          if (!hasOpenProject) return;
          onSaveComposition({ openLibrary: true });
        } else {
          void onSave();
        }
      }
      if (key === 'o') { event.preventDefault(); void onOpen(); }
      if (key === 'e') { event.preventDefault(); setExportOpen(true); }
      if (key === 't') {
        event.preventDefault();
        if (workspace.tabs.length < MAX_PROJECT_TABS) setTemplatePickerOpen(true);
      }
      if (key === 'n' && !event.shiftKey) {
        event.preventDefault();
        startBlankFile();
      }
      if (key === 'w' && workspace.activeId) {
        event.preventDefault();
        closeTab(workspace.activeId);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ') return;
      const upTarget = event.target as HTMLElement | null;
      const upTyping = upTarget
        && (upTarget.tagName === 'INPUT' || upTarget.tagName === 'TEXTAREA' || upTarget.isContentEditable);
      if (upTyping || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      if (spacePannedRef.current) {
        spacePannedRef.current = false;
        return;
      }
      setTimelineOpen(true);
      setAnimPlaying((playing) => {
        if (playing) return false;
        setAnimTime((time) => (time >= animation.duration - 0.001 ? 0 : time));
        return true;
      });
    };
    window.addEventListener('keydown', handler);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keyup', onKeyUp);
    };
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
          || item.kind === 'file'
        ))
        : Boolean(event.clipboardData?.files?.length);
      // Mac screenshots often never show up on the paste event. Still try the
      // system pasteboard, and only take over the shortcut when an image is there
      // or the pointer is on a device.
      if (!svgText && !hasImage && !hoveredDeviceIdRef.current && !window.mockupDesktop?.readClipboardImage) return;
      event.preventDefault();
      void pasteScreenFromClipboard(event, hoveredDeviceIdRef.current);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const compositionScenes = useMemo(
    () => ensureCompositionScenes(project),
    [project.scenes, project.activeSceneId, project.background, project.gradientColors],
  );
  const activeCompositionSceneId = compositionScenes.some((scene) => scene.id === project.activeSceneId)
    ? project.activeSceneId
    : compositionScenes[0]?.id;

  const chooseScene = (scene: ScenePreset) => {
    updateProject({
      background: scene.id as BackgroundPreset,
      gradientColors: scene.gradient ? { ...scene.gradient } : { ...project.gradientColors },
    });
  };

  const onSwitchCompositionScene = (sceneId: string) => {
    if (sceneId === activeCompositionSceneId) return;
    setProject((current) => switchCompositionScene(current, sceneId));
  };

  const onCreateCompositionScene = (mode: 'duplicate' | 'blank', sceneId?: string) => {
    if (compositionScenes.length >= MAX_COMPOSITION_SCENES) {
      notify(`Up to ${MAX_COMPOSITION_SCENES} scenes per composition`);
      return;
    }
    setProject((current) => (
      mode === 'duplicate'
        ? duplicateCompositionScene(current, sceneId)
        : addCompositionScene(current, 'blank')
    ));
    notify(mode === 'duplicate' ? 'Scene duplicated' : 'New scene');
  };

  const onRemoveCompositionScene = (sceneId: string) => {
    if (compositionScenes.length <= 1) {
      notify('Keep at least one scene');
      return;
    }
    setProject((current) => removeCompositionScene(current, sceneId));
    notify('Scene deleted');
  };

  const onDuplicateLibraryTemplate = (template: CompositionTemplate) => {
    if (template.category === 'saved' || template.id.startsWith('comp-')) {
      const copy = duplicateSavedComposition(template.id) ?? copyTemplateToSaved(template);
      const next = loadSavedCompositions();
      setSavedCompositions(next);
      void pushTemplatesRef.current(next);
      notify(`Duplicated “${copy.label}”`);
      return;
    }
    if (isDeveloperToolset) {
      void (async () => {
        const result = await duplicateShippedTemplate(template);
        if (!result.ok) {
          notify(result.reason || 'Could not duplicate shipped template');
          return;
        }
        setTemplatesTick((n) => n + 1);
        notify(`Duplicated shipped “${result.template.label}”`);
        startFromTemplate(result.template);
      })();
      return;
    }
    const copy = copyTemplateToSaved(template);
    const next = loadSavedCompositions();
    setSavedCompositions(next);
    void pushTemplatesRef.current(next);
    notify(`Copied “${copy.label}” into Your templates`);
  };

  const onRenameLibraryTemplate = (template: CompositionTemplate) => {
    const nextLabel = window.prompt('Rename template', template.label)?.trim().slice(0, 40);
    if (!nextLabel || nextLabel === template.label) return;
    if (template.category === 'saved' || template.id.startsWith('comp-')) {
      const next = renameSavedComposition(template.id, nextLabel);
      setSavedCompositions(next);
      void pushTemplatesRef.current(next);
      notify(`Renamed “${nextLabel}”`);
      return;
    }
    void (async () => {
      const result = await renameShippedTemplate(template, nextLabel);
      if (!result.ok) {
        notify(result.reason || 'Could not rename shipped template');
        return;
      }
      setTemplatesTick((n) => n + 1);
      notify(`Renamed “${result.template.label}”`);
    })();
  };

  const onAddShippedLibraryTemplate = (category: 'devices' | 'scenes') => {
    // Electron has no window.prompt — mint a blank library entry and open it as a new file.
    if (!isDeveloperToolset) setToolset('developer');
    const fallback = category === 'scenes' ? 'New composition' : 'New layout';
    void (async () => {
      const blank = createBlankShippedTemplate(fallback, category);
      const result = await shipCompositionTemplate(blank);
      setTemplatesTick((n) => n + 1);
      // Always open the blank file. Pack write can fail outside Electron DEV; runtime
      // already holds the template so Dev editing still works for this session.
      if (!result.ok) {
        notify(result.reason
          ? `Opened “${result.template.label}” · ${result.reason}`
          : `Opened “${result.template.label}”`);
      } else {
        notify(`Created “${result.template.label}” · editing in Dev`);
      }
      startFromTemplate(result.template);
    })();
  };

  const onDeleteShippedLibraryTemplate = async (template: CompositionTemplate) => {
    if (!window.confirm(`Delete shipped “${template.label}”? User view will no longer show it.`)) return;
    const result = await deleteShippedTemplate(template.id);
    if (!result.ok) {
      notify(result.reason || 'Could not delete shipped template');
      return;
    }
    setTemplatesTick((n) => n + 1);
    setCompositionPick((current) => (
      current?.templateId === template.id ? null : current
    ));
    notify(`Deleted shipped “${template.label}”`);
  };

  const onRenameCompositionScene = (sceneId: string, name: string) => {
    setProject((current) => renameCompositionScene(current, sceneId, name));
  };

  const updateGradient = (key: keyof GradientColors, value: string) => {
    const trimmed = value.trim();
    const candidate = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(candidate)) return;
    const hex = candidate.toLowerCase();
    if (hex === project.gradientColors[key] && project.background !== 'transparent') return;
    const next = { ...project.gradientColors, [key]: hex };
    const keepsBuiltin = BACKGROUNDS.some((item) => item.id === project.background && item.gradient
      && item.gradient.center === next.center && item.gradient.mid === next.mid && item.gradient.edge === next.edge);
    const keepsCustom = customPresets.some((item) => item.id === project.background && item.gradient
      && item.gradient.center === next.center && item.gradient.mid === next.mid && item.gradient.edge === next.edge);
    const props = project.sceneProps ?? [];
    // Backdrop wall colour stays in sync with any cyclorama prop so User + Dev both drive the set.
    const nextProps = key === 'center' && props.some((prop) => prop.kind === 'studio_backdrop')
      ? props.map((prop) => (prop.kind === 'studio_backdrop' ? { ...prop, color: hex } : prop))
      : null;
    const allWhite = [next.center, next.mid, next.edge].every((stop) => stop === '#ffffff');
    // Editing a stop while transparent must leave the clear look so the colour shows.
    const background = project.background === 'transparent'
      ? (allWhite ? 'studio' : 'custom')
      : allWhite
        ? 'studio'
        : keepsBuiltin || keepsCustom
          ? project.background
          : 'custom';
    updateProject({
      gradientColors: next,
      background,
      ...(nextProps ? { sceneProps: nextProps } : {}),
    });
    if (project.background === 'transparent') {
      setStudioSetFocus(key === 'center' ? 'backdrop' : key === 'mid' ? 'sky' : 'floor');
    }
  };

  const restoreColouredBackground = () => {
    const studio = BACKGROUNDS.find((item) => item.id === 'studio');
    updateProject({
      background: 'studio',
      gradientColors: studio?.gradient ? { ...studio.gradient } : { ...project.gradientColors },
    });
    setStudioSetFocus('sky');
    setSidePanelsHidden(false);
    notify('Coloured background restored');
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

  const onSaveAssetSize = (width: number, height: number, name = sizeName) => {
    const saved = saveAssetSize(name, width, height);
    setSavedSizes(loadSavedSizes());
    setSizeName('');
    setSizeDraft({ width: saved.width, height: saved.height });
    setExportAspectIds((current) => [...current.filter((item) => item !== 'custom' && item !== saved.id), saved.id]);
    setPreviewFrame(saved.id);
    setExportResolution('native');
    setCustomExportSize({ width: saved.width, height: saved.height });
    notify(`Saved “${saved.label}” · ${saved.width}×${saved.height}`);
  };

  const onDeleteSize = (id: string) => {
    setSavedSizes(deleteSavedSize(id));
    setExportAspectIds((current) => {
      const next = current.filter((item) => item !== id);
      return next.length ? next : ['custom'];
    });
    if (previewFrame === id) {
      setPreviewFrame('free');
      setExportResolution('custom');
    }
    notify('Custom size removed');
  };

  const onSaveAngle = () => {
    const saved = saveAngle(angleName, getSelectedDevice(project).rotation);
    setSavedAngles(loadSavedAngles());
    setAngleName('');
    notify(`Saved “${saved.label}” angle`);
  };

  const onDeleteAngle = (id: string) => {
    setSavedAngles(deleteSavedAngle(id));
    notify('Angle removed');
  };

  useEffect(() => subscribeRuntimePromoted(() => {
    setTemplatesTick((n) => n + 1);
  }), []);

  const sceneCompositions = useMemo(
    () => templatesByCategory('scenes'),
    [templatesTick],
  );
  const activeCompositionId = compositionPick?.tabId === workspace.activeId
    ? compositionPick.templateId
    : null;

  const onApplyComposition = (template: CompositionTemplate) => {
    const tabId = workspace.activeId;
    if (!tabId) return;
    setProject((current) => applyCompositionKeepingDevices(current, template));
    setCompositionPick({ tabId, templateId: template.id });
    setAnimTime(0);
    const motion = template.motion ? getAnimationPreset(template.motion) : undefined;
    setAnimPlaying(Boolean(motion && motion.loop && motion.id !== 'clear'));
    notify(
      isDeveloperToolset
        ? `Quick-editing “${template.label}” — Update shipped when ready`
        : `Applied “${template.label}”`,
    );
  };

  const quickUpdateShippedTemplate = async () => {
    if (!activeCompositionId || !isDevEditableTemplateId(activeCompositionId)) {
      notify('Pick a Devices or Scenes template first');
      setTemplatePickerOpen(true);
      return;
    }
    const existing = getCompositionTemplate(activeCompositionId);
    const category = existing?.category === 'scenes' ? 'scenes' as const : 'devices' as const;
    const label = compositionName || project.name || existing?.label || 'Untitled composition';
    try {
      const next = prepareShippedFromProject(label, project, category, { id: activeCompositionId });
      const result = await shipCompositionTemplate(next);
      if (!result.ok) {
        notify(result.reason || 'Could not update shipped template');
        return;
      }
      setTemplatesTick((n) => n + 1);
      setCompositionPick((current) => (
        current?.tabId === workspace.activeId
          ? { tabId: current.tabId, templateId: result.template.id }
          : current
      ));
      notify(`Updated shipped “${result.template.label}” · User view sees it now`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update shipped template');
    }
  };

  const onSaveComposition = (opts?: { openLibrary?: boolean }) => {
    const saved = saveComposition(compositionName, project);
    const next = loadSavedCompositions();
    setSavedCompositions(next);
    setCompositionName('');
    setTemplateCategory('saved');
    if (opts?.openLibrary) setTemplatePickerOpen(true);
    void pushTemplatesRef.current(next);
    const where = cloud?.configured && !cloud.missing ? ` · synced to ${cloud.label || 'your drive'}` : '';
    notify(`Saved “${saved.label}” as template · ${project.devices.length} device${project.devices.length === 1 ? '' : 's'}${where}`);
  };

  const onCopyBuiltinComposition = async (category: 'devices' | 'scenes' = 'devices') => {
    const source = formatBuiltinCompositionSource(compositionName || project.name, project, { category });
    try {
      await navigator.clipboard.writeText(source);
      notify(`Copied built-in ${category} template · paste into src/lib/templates.ts`);
    } catch {
      notify('Could not copy — select and copy from the console instead');
      console.info('[mockup-studio] Built-in composition for templates.ts:\n', source);
    }
  };

  const onDeleteComposition = (id: string) => {
    const next = deleteSavedComposition(id);
    setSavedCompositions(next);
    void pushTemplatesRef.current(next);
    notify('Template removed');
  };

  const resetDevice = () => {
    setProject((current) => {
      const selected = getSelectedDevice(current);
      const rotation = { ...STUDIO_START_ROTATION };
      const linkTransform = current.linkSplitTransform !== false;
      const devices = current.devices.map((device) => (
        (current.compositionMode === 'split' && linkTransform) || device.id === selected.id
          ? {
            ...device,
            rotation: { ...rotation },
            scale: 1,
            // Position stays free in split — only reset the selected phone’s seat
            position: device.id === selected.id
              ? (current.compositionMode === 'split' ? device.position : { ...STUDIO_START_POSITION })
              : device.position,
          }
          : device
      ));
      const nextSelected = devices.find((d) => d.id === selected.id) ?? devices[0];
      return syncProjectFromSelected({ ...current, devices, cameraView: 'front' }, nextSelected);
    });
    setCameraRecenterToken((n) => n + 1);
    applyCustomFrame();
    notify('Reset to the custom canvas');
  };

  const selectedMark = (project.overlays ?? []).find((item) => (
    item.id === selectedOverlayId && (item.kind === 'comment' || item.kind === 'path')
  )) ?? null;
  const selectedComment = selectedMark?.kind === 'comment' ? selectedMark : null;

  return (
    <div className={`app-shell ${hasOpenProject ? 'has-project' : 'is-dashboard'}`}>
      <UpdateBanner />
      {hasOpenProject && (
      <header className="topbar">
        <button
          type="button"
          className="brand-area"
          title="Mockup Studio 3D"
          aria-label="Mockup Studio 3D"
          onClick={goToRecentProjects}
        >
          <img className="brand-mark" src="./splash/logo.png" alt="" width={22} height={22} />
        </button>
        <div className="document-area">
          <div className="file-menu-wrap" ref={fileMenuRef}>
            <button
              type="button"
              className={`file-menu-button ${fileMenuOpen || leftWorkspaceTab === 'log' ? 'is-open' : ''}`}
              aria-label="File menu"
              aria-haspopup="menu"
              aria-expanded={fileMenuOpen}
              title="File menu"
              onClick={() => setFileMenuOpen((open) => !open)}
            >
              <Menu size={16} />
            </button>
            {fileMenuOpen && (
              <div className="file-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={workspace.tabs.length >= MAX_PROJECT_TABS}
                  onClick={() => {
                    setFileMenuOpen(false);
                    startBlankFile();
                  }}
                >
                  Blank File
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={workspace.tabs.length >= MAX_PROJECT_TABS}
                  onClick={() => {
                    setFileMenuOpen(false);
                    setTemplatePickerOpen(true);
                  }}
                >
                  New from Template…
                </button>
                <div className="file-menu-sep" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setFileMenuOpen(false);
                    void onSave();
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setFileMenuOpen(false);
                    void onSaveAs();
                  }}
                >
                  Save as…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setFileMenuOpen(false);
                    onDuplicateProject();
                  }}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setFileMenuOpen(false);
                    setExportOpen(true);
                  }}
                >
                  Export as…
                </button>
                <div className="file-menu-sep" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  disabled={compositionScenes.length >= MAX_COMPOSITION_SCENES}
                  onClick={() => {
                    setLeftWorkspaceTab('scenes');
                    setFileMenuOpen(false);
                    onCreateCompositionScene('duplicate');
                  }}
                >
                  Duplicate Scene
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={compositionScenes.length >= MAX_COMPOSITION_SCENES}
                  onClick={() => {
                    setLeftWorkspaceTab('scenes');
                    setFileMenuOpen(false);
                    onCreateCompositionScene('blank');
                  }}
                >
                  New Scene
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setFileMenuOpen(false);
                    onSaveComposition({ openLibrary: true });
                  }}
                >
                  Save as Template
                </button>
                <div className="file-menu-sep" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setLeftWorkspaceTab('log');
                    setFileMenuOpen(false);
                  }}
                >
                  Version History
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={goToRecentProjects}
                >
                  Recent Projects
                </button>
              </div>
            )}
          </div>
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
              title="Blank file"
              aria-label="Open blank file"
              disabled={workspace.tabs.length >= MAX_PROJECT_TABS}
              onClick={startBlankFile}
            >
              <Plus size={14} strokeWidth={2.2} />
            </button>
          </div>
        </div>
        <div className="sync-menu-wrap" ref={syncMenuRef}>
          <button
            type="button"
            className={`sync-status ${cloud?.configured && !cloud.missing ? 'is-on' : ''}`}
            aria-expanded={syncMenuOpen}
            aria-haspopup="dialog"
            title={cloud?.configured
              ? `Saving to ${cloud.folderLabel || cloud.label}`
              : 'Save to iCloud Drive or Google Drive'}
            onClick={() => setSyncMenuOpen((open) => !open)}
          >
            {syncButtonLabel(cloud)}
          </button>
          {syncMenuOpen && (
            <CloudSyncPanel
              cloud={cloud}
              busy={cloudBusy}
              variant="menu"
              onUse={(target) => { void enableCloud(target); }}
              onStop={() => { void stopCloud(); }}
            />
          )}
        </div>
      </header>
      )}

      {!hasOpenProject ? (
        <ProjectsDashboard
          recentProjects={recentProjects}
          recentScreenshots={recentScreenshots}
          devices={allDevices}
          license={license}
          licensingDisabled={LICENSING_DISABLED}
          cloud={cloud}
          cloudBusy={cloudBusy}
          cloudProjects={cloudProjects}
          onCloudUse={(target) => { void enableCloud(target); }}
          onCloudStop={() => { void stopCloud(); }}
          onOpenCloudProject={(filePath) => { void openCloudProject(filePath); }}
          onRemoveCloudProject={(filePath) => { void removeCloudProject(filePath); }}
          onOpenProject={openRecentProject}
          onRemoveProject={(id) => setRecentProjects(removeRecentProject(id))}
          onNewProject={() => setTemplatePickerOpen(true)}
          onBlankFile={startBlankFile}
          onOpenFile={() => void onOpen()}
          onStartTemplate={startFromTemplate}
          onStartDevice={startWithDevice}
          savedCompositions={savedCompositions}
          onDeleteSavedTemplate={onDeleteComposition}
          onDeleteShippedTemplate={(template) => { void onDeleteShippedLibraryTemplate(template); }}
          onDuplicateTemplate={onDuplicateLibraryTemplate}
          onRenameTemplate={onRenameLibraryTemplate}
          onAddShippedTemplate={onAddShippedLibraryTemplate}
          toolsetSwitchAvailable={toolsetSwitchAvailable}
          isDeveloperToolset={isDeveloperToolset}
          onSetToolset={setToolset}
          onExplorePro={() => {
            if (LICENSING_DISABLED) {
              notify('Pro features are unlocked in this build');
              return;
            }
            setLicenseOpen(true);
          }}
          onFeedback={() => setFeedbackOpen(true)}
          deviceUnlocked={(deviceId) => isDeviceUnlocked(license.tier, deviceId)}
        />
      ) : (
      <div className={`workspace ${sidePanelsHidden ? 'panels-hidden' : ''} ${leftPanelHidden && !sidePanelsHidden ? 'left-panel-hidden' : ''} ${timelineOpen && !sidePanelsHidden ? 'timeline-open' : ''}`}>
        <aside className="left-panel" aria-hidden={sidePanelsHidden || leftPanelHidden}>
          <div className="left-workspace-head">
            <div className="left-workspace-stack">
              <div className="left-workspace-tabs" role="tablist" aria-label="Workspace tools">
                <button
                  type="button"
                  role="tab"
                  aria-selected={leftWorkspaceTab === 'scenes'}
                  className={leftWorkspaceTab === 'scenes' ? 'panel-tab selected' : 'panel-tab'}
                  onClick={() => setLeftWorkspaceTab('scenes')}
                >
                  Objects
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={leftWorkspaceTab === 'assets'}
                  className={leftWorkspaceTab === 'assets' ? 'panel-tab selected' : 'panel-tab'}
                  onClick={() => setLeftWorkspaceTab('assets')}
                >
                  Assets
                </button>
              </div>
            </div>
            <button
              type="button"
              className="left-panel-nav-toggle"
              title="Collapse sidebar"
              aria-label="Collapse left sidebar"
              aria-pressed
              onClick={() => setLeftPanelHidden(true)}
            >
              <PanelLeftClose size={16} strokeWidth={1.9} />
            </button>
          </div>

          <div className="left-panel-main">
            {leftWorkspaceTab === 'scenes' ? (
              <section className="left-scenes-content" aria-label="Scenes">
                <SceneHierarchy
                  project={project}
                  scenes={compositionScenes}
                  activeSceneId={activeCompositionSceneId ?? compositionScenes[0]?.id ?? 'scene-main'}
                  looks={allScenes}
                  onSwitchScene={onSwitchCompositionScene}
                  onRenameScene={onRenameCompositionScene}
                  onRemoveScene={onRemoveCompositionScene}
                  onSelectDevice={(device) => {
                    pinLayer('device', device.id);
                    setLightGizmoActive(false);
                    setDeviceChosen(true);
                    setProject((current) => {
                      const selected = current.devices.find((item) => item.id === device.id);
                      if (!selected) return current;
                      return syncProjectFromSelected({
                        ...current,
                        publishTarget: platformOfDevice(selected),
                      }, selected);
                    });
                  }}
                  onRemoveDevice={deleteDeviceById}
                  onChooseLook={chooseScene}
                  onDeleteLook={onDeletePreset}
                  onUpdateGradient={updateGradient}
                  onOpenSection={(sectionId) => setOpenSectionId(sectionId)}
                  onOpenAssets={() => setLeftWorkspaceTab('assets')}
                  onSelectOverlay={selectCanvasOverlay}
                  onSelectProp={(propId) => {
                    pinLayer('prop', propId);
                    setLightGizmoActive(false);
                    setOpenSectionId('look');
                  }}
                  onRemoveProp={removeSceneProp}
                  onRemoveBackdrop={removeBackdrop}
                  backdropLooksOpen={studioSetFocus != null}
                  onSelectBackdrop={selectBackdrop}
                  onFocusKeyLight={focusKeyLight}
                  onFocusSceneLight={focusSceneLight}
                  onSelectionChange={onLayerSelection}
                  layerPin={layerPin}
                  onAddScene={() => onCreateCompositionScene('blank')}
                  onDuplicateScene={(sceneId) => onCreateCompositionScene('duplicate', sceneId)}
                  canAddScene={compositionScenes.length < MAX_COMPOSITION_SCENES}
                />
              </section>
            ) : leftWorkspaceTab === 'log' ? (
              <ChangeLogPanel entries={activeChangeLog} onRestore={restoreChange} />
            ) : (
              <div className="left-scroll" ref={leftScrollRef}>
                <div className="assets-stack">
                  <section className="assets-block" aria-label="Import">
                    <div className="field-caption section-label assets-section-label">
                      Import
                      <span>
                        {activePublishTarget === 'ios' ? 'iOS' : 'Android'}
                        {' · '}
                        {screenSizeLabel(getDevice(activeEnvDevice.deviceId).screenSize)}
                      </span>
                    </div>
                    {project.compositionMode === 'split' && (
                      <div className="publish-target-switch" role="group" aria-label="Publish target">
                        <button
                          type="button"
                          className={activePublishTarget === 'ios' ? 'is-active' : ''}
                          onClick={() => switchPublishTarget('ios')}
                        >
                          iOS
                        </button>
                        <button
                          type="button"
                          className={activePublishTarget === 'android' ? 'is-active' : ''}
                          onClick={() => switchPublishTarget('android')}
                        >
                          Android
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      className={`upload-zone upload-zone-unified ${assetsDropActive ? 'is-drop-active' : ''}`}
                      onClick={() => imageInputRef.current?.click()}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        setAssetsDropActive(true);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setAssetsDropActive(true);
                      }}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                          setAssetsDropActive(false);
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setAssetsDropActive(false);
                        void takeDroppedFiles(event.dataTransfer);
                      }}
                      title={`Drop, paste, or browse a screenshot for ${getDevice(activeEnvDevice.deviceId).label}`}
                    >
                      <ImagePlus size={20} strokeWidth={1.6} />
                      <div className="upload-zone-copy">
                        <strong>Drop or paste screenshot</strong>
                        <span>
                          {activePublishTarget === 'ios' ? 'Writes to iOS only' : 'Writes to Android only'}
                          {' · '}
                          Browse · ⌘V
                        </span>
                      </div>
                    </button>
                    <div className="assets-figma-row">
                      <input
                        type="url"
                        className="assets-figma-input"
                        value={figmaLinkDraft}
                        placeholder="Paste a Figma link"
                        aria-label="Figma file link"
                        onChange={(event) => setFigmaLinkDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return;
                          event.preventDefault();
                          setFigmaExploreOpen(true);
                        }}
                      />
                      <button
                        type="button"
                        className="assets-figma-open"
                        title="Open Figma file"
                        onClick={() => setFigmaExploreOpen(true)}
                      >
                        Open
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

                  {activeEnvScreenshot && (
                    <section className="assets-block" aria-label="Current screen">
                      <div className="asset-card asset-card-compact">
                        <div className="asset-preview"><img src={activeEnvScreenshot} alt="Uploaded screen" /></div>
                        <div>
                          <strong>
                            {isPlaceholderScreenshot(activeEnvScreenshot) ? 'Size guide' : 'Current screen'}
                            {project.compositionMode === 'split' ? ` · ${activePublishTarget === 'ios' ? 'iOS' : 'Android'}` : ''}
                          </strong>
                          <span>{screenSizeLabel(getDevice(activeEnvDevice.deviceId).screenSize)} px</span>
                        </div>
                        <button title="Replace screenshot" aria-label="Replace screenshot" onClick={() => imageInputRef.current?.click()}><ArrowLeftRight size={15} /></button>
                      </div>
                      {project.compositionMode === 'split' && !isPlaceholderScreenshot(activeEnvScreenshot) && (
                        <button
                          type="button"
                          className="button full-outline compact"
                          style={{ marginTop: 8 }}
                          onClick={copyActiveScreenToOtherPlatform}
                          title="Copy this screen onto the other platform"
                        >
                          <Copy size={13} /> Copy screen to other platform
                        </button>
                      )}
                    </section>
                  )}

                  {platformRecentScreenshots.length > 0 && (
                    <section className="assets-block" aria-label="Recent screenshots">
                      <div className="field-caption section-label assets-section-label">
                        Recent
                        <span>
                          {activePublishTarget === 'ios' ? 'iOS' : 'Android'}
                          {' · '}
                          {platformRecentScreenshots.length}
                        </span>
                      </div>
                      <div className="recent-shot-row" role="list">
                        {platformRecentScreenshots.map((shot) => (
                          <button
                            key={shot.id}
                            type="button"
                            role="listitem"
                            className={`recent-shot ${activeEnvScreenshot === shot.dataUrl ? 'is-active' : ''}`}
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
              </div>
            )}
          </div>

          <div className="left-panel-bottom">

            <div className="left-panel-footer">
              {!LICENSING_DISABLED && (
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
              )}
              <button
                type="button"
                className="left-panel-settings"
                data-hide-with-timeline
                title="Send feedback"
                aria-label="Send feedback"
                onClick={() => setFeedbackOpen(true)}
              >
                <MessageSquarePlus size={15} strokeWidth={1.9} />
                <span>Feedback</span>
              </button>
              <button
                type="button"
                className="left-panel-settings"
                data-hide-with-timeline
                title="Settings & shortcuts"
                aria-label="Settings & shortcuts"
                onClick={() => setHelpOpen(true)}
              >
                <Settings2 size={15} strokeWidth={1.9} />
                <span>Settings</span>
              </button>
              {toolsetSwitchAvailable && (
                <div
                  className="workspace-toolset-switch"
                  data-hide-with-timeline
                  role="group"
                  aria-label="Workspace toolset"
                >
                  <button
                    type="button"
                    className={isDeveloperToolset ? 'is-active' : ''}
                    aria-pressed={isDeveloperToolset}
                    title="Developer toolset — author & ship templates"
                    onClick={() => setToolset('developer')}
                  >
                    <Wrench size={13} strokeWidth={1.9} />
                    Dev
                  </button>
                  <button
                    type="button"
                    className={!isDeveloperToolset ? 'is-active' : ''}
                    aria-pressed={!isDeveloperToolset}
                    title="User toolset — preview as customers see the app"
                    onClick={() => setToolset('user')}
                  >
                    <UserRound size={13} strokeWidth={1.9} />
                    User
                  </button>
                </div>
              )}
            </div>
          </div>

        </aside>

        {!sidePanelsHidden && leftPanelHidden && (
          <button
            type="button"
            className="left-panel-edge-toggle is-floating"
            title="Expand sidebar"
            aria-label="Expand left sidebar"
            aria-pressed={false}
            onClick={() => setLeftPanelHidden(false)}
          >
            <PanelLeftOpen size={15} strokeWidth={1.9} />
          </button>
        )}

        <main
          className="canvas-panel"
          onDragOver={(e) => {
            if (!Array.from(e.dataTransfer.types).includes('Files')) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
          onDrop={onDrop}
        >
          <div
            className={`canvas-stage ${sidePanelsHidden ? 'chrome-hidden' : timelineOpen ? 'with-timeline' : ''}`}
            ref={canvasStageRef}
          >
            <div className="canvas-top-right">
              {toolsetSwitchAvailable && (
                <div
                  className={`workspace-view-toggle${isDeveloperToolset ? ' is-dev' : ' is-user'}`}
                  role="group"
                  aria-label="Workspace view"
                >
                  <button
                    type="button"
                    className={isDeveloperToolset ? 'is-active' : ''}
                    aria-pressed={isDeveloperToolset}
                    title="Dev view — quick-edit templates and ship updates to User"
                    onClick={() => setToolset('developer')}
                  >
                    <Wrench size={12} strokeWidth={2.2} aria-hidden />
                    Dev
                  </button>
                  <button
                    type="button"
                    className={!isDeveloperToolset ? 'is-active' : ''}
                    aria-pressed={!isDeveloperToolset}
                    title="User view — preview the templates customers get"
                    onClick={() => setToolset('user')}
                  >
                    <UserRound size={12} strokeWidth={2.2} aria-hidden />
                    User view
                  </button>
                </div>
              )}
              <div className="view-buttons canvas-gesture-bar" role="toolbar" aria-label="Gestures">
                {VIEW_GESTURES.map((gesture) => {
                  const Icon = gesture.icon;
                  const active = viewGesture === gesture.id;
                  return (
                    <button
                      key={gesture.id}
                      type="button"
                      className={`view-mirror-btn ${active ? 'active' : ''}`}
                      title={gesture.label}
                      aria-label={gesture.label}
                      aria-pressed={active}
                      onClick={() => setViewGesture(gesture.id)}
                    >
                      <Icon size={14} />
                    </button>
                  );
                })}
                <span className="view-buttons-divider" />
                <button
                  type="button"
                  className="view-reset-btn"
                  title="Reset camera position"
                  aria-label="Reset camera position"
                  onClick={resetDevice}
                >
                  <RotateCcw size={14} />
                </button>
              </div>
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
              ) : canvasHintVisible ? (
                <p className="canvas-usage-hint" role="status">
                  Drag beside the model to orbit the camera · Drag the model to spin it · <kbd>Shift</kbd>+drag to move · <kbd>Space</kbd>+drag to pan
                  <button
                    type="button"
                    className="canvas-usage-hint-close"
                    aria-label="Close hint"
                    onClick={dismissCanvasHint}
                  >
                    <X size={11} />
                  </button>
                </p>
              ) : null}
            </div>
            <div className={`canvas-render ${project.background === 'transparent' ? 'transparent-grid' : ''} ${isDualCanvas ? 'is-dual' : ''}`}>
              {isDualCanvas && iosDisplayProject && androidDisplayProject ? (
                <DualCanvasLayout
                  ratio={previewAspect?.ratio ?? null}
                  label={previewAspect?.label}
                  hint={previewAspect?.hint}
                  activeFormatId={previewFrame}
                  formats={canvasFormatOptions}
                  onSelectFormat={applyPlatformFrame}
                  ios={{
                    active: activePublishTarget === 'ios',
                    editing: activePublishTarget === 'ios',
                    platformLabel: 'iOS',
                    onActivate: () => {
                      if (activePublishTarget !== 'ios') switchPublishTarget('ios', { quiet: true });
                    },
                    children: (
                      <DeviceCanvas
                        canvasId="env-ios"
                        project={iosDisplayProject}
                        captureRef={iosCaptureRef}
                        shadowExportBoost={exporting}
                        mediaPlaying={animPlaying}
                        liveStream={mirrorSource === 'ios' || (!mirrorSource && activePublishTarget === 'ios') ? mirrorStream : null}
                        liveStreamDeviceId={liveStreamDeviceId}
                        cameraPosition={animatedCamera}
                        gizmoActive={activePublishTarget === 'ios'}
                        sharedOrbit={sharedOrbit}
                        onSharedOrbitChange={setSharedOrbit}
                        onCameraCommit={onCameraCommit}
                        onOrbitStart={onOrbitStart}
                        recenterToken={cameraRecenterToken}
                        lightGizmoActive={lightGizmoActive && activePublishTarget === 'ios'}
                        onLightPositionChange={(position) => updateProject({ lightPosition: position })}
                        selectedSceneLightId={
                          activePublishTarget === 'ios' && layerSelection.kind === 'scene-light'
                            ? layerSelection.id
                            : null
                        }
                        onSceneLightPositionChange={patchSceneLightPosition}
                        onSelectSceneLight={focusSceneLight}
                        onSelectKeyLight={focusKeyLight}
                        onSelectDevice={onSelectDevice}
                        overlayTime={animTime}
                        selectedPropId={layerSelection.kind === 'prop' ? layerSelection.id : null}
                        onSelectProp={selectSceneProp}
                        backdropSelected={layerSelection.kind === 'backdrop'}
                        onSelectBackdrop={selectBackdrop}
                        onSelectSky={selectSky}
                        onSelectFloor={selectFloor}
                        onMoveProp={onMoveProp}
                        onRotateProp={onRotateProp}
                        onSelectEmpty={selectEmptyCanvas}
                        onSelectOverlay={selectCanvasOverlay}
                        onClearSelection={() => { setDeviceMenu(null); setPickedMaterial(null); }}
                        onRotateDevice={onRotateDevice}
                        onMoveDevice={onMoveDevice}
                        onGizmoDraggingChange={setGizmoDragging}
                        gizmoDragging={gizmoDragging}
                        screenDropDeviceId={dragOver ? getPublishEnvDevice(project).id : null}
                        onSpacePanDrag={noteSpacePan}
                        viewGesture={viewGesture}
                        onSwipe={onViewSwipe}
                        onLongPress={onViewLongPress}
                        annotate={canvasTool === 'pen' ? 'pen' : canvasTool === 'comments' ? 'comment' : null}
                        annotateInk={markInk}
                        onAnnotation={commitAnnotation}
                        selectedOverlayId={selectedOverlayId}
                        materialEditEnabled={isDeveloperToolset}
                        selectedMaterialName={pickedMaterial?.materialName ?? null}
                        selectedMaterialDeviceId={pickedMaterial?.deviceInstanceId ?? null}
                        onPickMaterial={onPickMaterial}
                      />
                    ),
                  }}
                  android={{
                    active: activePublishTarget === 'android',
                    editing: activePublishTarget === 'android',
                    platformLabel: 'Android',
                    onActivate: () => {
                      if (activePublishTarget !== 'android') switchPublishTarget('android', { quiet: true });
                    },
                    children: (
                      <DeviceCanvas
                        canvasId="env-android"
                        project={androidDisplayProject}
                        captureRef={androidCaptureRef}
                        shadowExportBoost={exporting}
                        mediaPlaying={animPlaying}
                        liveStream={mirrorSource === 'android' || (!mirrorSource && activePublishTarget === 'android') ? mirrorStream : null}
                        liveStreamDeviceId={liveStreamDeviceId}
                        cameraPosition={animatedCamera}
                        gizmoActive={activePublishTarget === 'android'}
                        sharedOrbit={sharedOrbit}
                        onSharedOrbitChange={setSharedOrbit}
                        onCameraCommit={onCameraCommit}
                        onOrbitStart={onOrbitStart}
                        recenterToken={cameraRecenterToken}
                        lightGizmoActive={lightGizmoActive && activePublishTarget === 'android'}
                        onLightPositionChange={(position) => updateProject({ lightPosition: position })}
                        selectedSceneLightId={
                          activePublishTarget === 'android' && layerSelection.kind === 'scene-light'
                            ? layerSelection.id
                            : null
                        }
                        onSceneLightPositionChange={patchSceneLightPosition}
                        onSelectSceneLight={focusSceneLight}
                        onSelectKeyLight={focusKeyLight}
                        onSelectDevice={onSelectDevice}
                        overlayTime={animTime}
                        selectedPropId={layerSelection.kind === 'prop' ? layerSelection.id : null}
                        onSelectProp={selectSceneProp}
                        backdropSelected={layerSelection.kind === 'backdrop'}
                        onSelectBackdrop={selectBackdrop}
                        onSelectSky={selectSky}
                        onSelectFloor={selectFloor}
                        onMoveProp={onMoveProp}
                        onRotateProp={onRotateProp}
                        onSelectEmpty={selectEmptyCanvas}
                        onSelectOverlay={selectCanvasOverlay}
                        onClearSelection={() => { setDeviceMenu(null); setPickedMaterial(null); }}
                        onRotateDevice={onRotateDevice}
                        onMoveDevice={onMoveDevice}
                        onGizmoDraggingChange={setGizmoDragging}
                        gizmoDragging={gizmoDragging}
                        screenDropDeviceId={dragOver ? getPublishEnvDevice(project).id : null}
                        onSpacePanDrag={noteSpacePan}
                        viewGesture={viewGesture}
                        onSwipe={onViewSwipe}
                        onLongPress={onViewLongPress}
                        annotate={canvasTool === 'pen' ? 'pen' : canvasTool === 'comments' ? 'comment' : null}
                        annotateInk={markInk}
                        onAnnotation={commitAnnotation}
                        selectedOverlayId={selectedOverlayId}
                        materialEditEnabled={isDeveloperToolset}
                        selectedMaterialName={pickedMaterial?.materialName ?? null}
                        selectedMaterialDeviceId={pickedMaterial?.deviceInstanceId ?? null}
                        onPickMaterial={onPickMaterial}
                      />
                    ),
                  }}
                />
              ) : (
                <DeviceCanvas
                  project={displayProject}
                  captureRef={captureRef}
                  shadowExportBoost={exporting}
                  mediaPlaying={animPlaying}
                  liveStream={mirrorStream}
                  liveStreamDeviceId={liveStreamDeviceId}
                  cameraPosition={animatedCamera}
                  sharedOrbit={sharedOrbit}
                  onSharedOrbitChange={setSharedOrbit}
                  onCameraCommit={onCameraCommit}
                  onOrbitStart={onOrbitStart}
                  recenterToken={cameraRecenterToken}
                  lightGizmoActive={lightGizmoActive}
                  onLightPositionChange={(position) => updateProject({ lightPosition: position })}
                  selectedSceneLightId={layerSelection.kind === 'scene-light' ? layerSelection.id : null}
                  onSceneLightPositionChange={patchSceneLightPosition}
                  onSelectSceneLight={focusSceneLight}
                  onSelectKeyLight={focusKeyLight}
                  onSelectDevice={onSelectDevice}
                  overlayTime={animTime}
                  selectedPropId={layerSelection.kind === 'prop' ? layerSelection.id : null}
                  onSelectProp={selectSceneProp}
                  backdropSelected={layerSelection.kind === 'backdrop'}
                  onSelectBackdrop={selectBackdrop}
                  onSelectSky={selectSky}
                  onSelectFloor={selectFloor}
                  onMoveProp={onMoveProp}
                  onRotateProp={onRotateProp}
                  onSelectEmpty={selectEmptyCanvas}
                  onSelectOverlay={selectCanvasOverlay}
                  onClearSelection={() => { setDeviceMenu(null); setPickedMaterial(null); }}
                  onRotateDevice={onRotateDevice}
                  onMoveDevice={onMoveDevice}
                  onGizmoDraggingChange={setGizmoDragging}
                  gizmoDragging={gizmoDragging}
                  screenDropDeviceId={dragOver ? getPublishEnvDevice(project).id : null}
                  onSpacePanDrag={noteSpacePan}
                  viewGesture={viewGesture}
                  onSwipe={onViewSwipe}
                  onLongPress={onViewLongPress}
                  annotate={canvasTool === 'pen' ? 'pen' : canvasTool === 'comments' ? 'comment' : null}
                  annotateInk={markInk}
                  onAnnotation={commitAnnotation}
                  selectedOverlayId={selectedOverlayId}
                  materialEditEnabled={isDeveloperToolset}
                  selectedMaterialName={pickedMaterial?.materialName ?? null}
                  selectedMaterialDeviceId={pickedMaterial?.deviceInstanceId ?? null}
                  onPickMaterial={onPickMaterial}
                />
              )}
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
              {(project.overlays ?? []).map((overlay) => {
                if (overlay.anchor?.points.length && (overlay.kind === 'path' || overlay.kind === 'comment')) return null;
                return overlayVisibleAt(overlay, animTime) ? (
                  <div
                    key={overlay.id}
                    className={`canvas-overlay-layer ${selectedOverlayId === overlay.id ? 'is-selected' : ''} ${overlay.kind === 'text' ? 'is-text' : ''} ${((overlay.kind === 'text' || overlay.kind === 'shape') && (overlay.extrusion ?? 0) > 0.001) ? 'is-extruded' : ''} ${overlay.kind === 'comment' ? 'is-comment' : ''} ${overlay.kind === 'shape' ? `is-shape is-${flatShapeOf(overlay)}` : ''} ${overlay.kind === 'path' ? 'is-path' : ''}`}
                    style={{
                      left: `${overlay.x * 100}%`,
                      top: `${overlay.y * 100}%`,
                      opacity: overlay.opacity,
                      transform: `translate(-50%, -50%) scale(${overlay.scale})`,
                      color: overlay.kind === 'comment'
                        ? (overlay.color || '#2a2418')
                        : ((overlay.kind === 'text' || overlay.kind === 'shape') && (overlay.extrusion ?? 0) > 0.001)
                          ? 'transparent'
                          : (overlay.color || '#fff'),
                      background: overlay.kind === 'comment' ? (overlay.fill || '#f4e7c3') : undefined,
                      fontSize: `${Math.max(14, (overlay.fontSize ?? 0.055) * 420)}px`,
                    }}
                    onPointerDown={(e) => onOverlayPointerDown(e, overlay.id)}
                    onPointerMove={onOverlayPointerMove}
                    onPointerUp={onOverlayPointerUp}
                    onPointerCancel={onOverlayPointerUp}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (overlay.kind === 'comment' || overlay.kind === 'path') {
                        selectCanvasOverlay(overlay.id);
                        return;
                      }
                      pinLayer('overlay', overlay.id);
                      setOpenSectionId('overlays');
                    }}
                  >
                    {overlay.kind === 'comment' ? (
                      <>
                        <span
                          className="canvas-comment-pin"
                          style={{ background: overlay.color || '#2a2418', color: overlay.fill || '#f4e7c3' }}
                        >
                          {commentNumber(project.overlays, overlay.id)}
                        </span>
                        <span className="canvas-comment-text">{overlay.text}</span>
                      </>
                    ) : overlay.kind === 'text' ? overlay.text : null}
                    {overlay.kind === 'path' ? (
                      <svg width={stageSize.w} height={stageSize.h} aria-hidden>
                        <polyline
                          fill="none"
                          stroke={overlay.color || '#d7dde4'}
                          strokeWidth={Math.max(2, 2 * overlay.scale)}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={pathOffsets(overlay.text).map((point) => (
                            `${stageSize.w / 2 + point.x * stageSize.w},${stageSize.h / 2 + point.y * stageSize.h}`
                          )).join(' ')}
                        />
                      </svg>
                    ) : null}
                    {overlay.kind === 'image' && overlay.imageData ? (
                      <img src={overlay.imageData} alt="" draggable={false} />
                    ) : null}
                  </div>
                ) : null;
              })}
            </div>
            {deviceMenu && (
              <div className="device-action-menu" style={{ left: Math.min(deviceMenu.x, window.innerWidth - 240), top: Math.min(deviceMenu.y, window.innerHeight - 200) }}>
                <div className="device-action-hint">
                  Drag to move · tap another object to select it · hold for this menu
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDeviceMenu(null);
                    setLeftWorkspaceTab('assets');
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
                    setLeftWorkspaceTab('assets');
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
                <button type="button" title="Add another device (⌘D)" onClick={duplicateSelectedDevice}><Copy size={14} /> Add device</button>
                <button type="button" onClick={rotateSelectedDevice}><Rotate3D size={14} /> Snap +45°</button>
                <button type="button" className="danger" onClick={deleteSelectedDevice} disabled={project.devices.length <= 1}><Trash2 size={14} /> Remove</button>
                <div className="device-action-meta">Ideal size {screenSizeLabel(getDevice(project.deviceId).screenSize)}</div>
              </div>
            )}
            {dragOver && (
              <div className="drag-overlay">
                <Upload size={16} />
                <b>Drop a screenshot or a 3D model</b>
                <span>FBX, DAE, OBJ, glTF, Blend, and C4D ask before they are extracted</span>
              </div>
            )}
            <ViewAxisGizmo
              view={project.cameraView}
              deviceRotation={displaySelected.rotation}
              orbitOffset={animatedCamera ? {
                x: animatedCamera.x - (displaySelected.position?.x ?? 0),
                y: animatedCamera.y - (displaySelected.position?.y ?? 0),
                z: animatedCamera.z - (displaySelected.position?.z ?? 0),
              } : sharedOrbit?.offset ?? null}
              onSelectView={(cameraView) => {
                setSharedOrbit(null);
                updateProject({ cameraView });
              }}
            />
          </div>
          {previewAspect && !isDualCanvas && (
            <CropFocusOverlay
              ratio={previewAspect.ratio}
              label={previewAspect.label}
              hint={previewAspect.hint}
              activeId={previewFrame}
              formats={canvasFormatOptions}
              onSelectFormat={applyPlatformFrame}
            />
          )}
          <div className={`workspace-bottom-chrome ${timelineOpen && !sidePanelsHidden ? 'is-raised' : ''}`}>
            {!sidePanelsHidden && (
              <div
                ref={studioAiShellRef}
                className={`studio-ai ${studioAiOpen ? 'is-open' : 'is-compact'}`}
              >
                {!studioAiOpen ? (
                  <button
                    type="button"
                    className="studio-ai-trigger"
                    onClick={openStudioAi}
                    aria-expanded={false}
                    aria-controls="studio-ai-panel"
                    title="AI assistant"
                  >
                    <span className="studio-ai-glow" aria-hidden />
                    <Sparkles size={15} aria-hidden />
                    <span>AI</span>
                  </button>
                ) : (
                  <form
                    id="studio-ai-panel"
                    className="studio-ai-panel"
                    onSubmit={(event: FormEvent) => {
                      event.preventDefault();
                      runStudioAiPrompt(studioAiPrompt);
                    }}
                  >
                    <span className="studio-ai-glow studio-ai-glow-panel" aria-hidden />
                    <div className="studio-ai-field">
                      <Sparkles size={14} className="studio-ai-icon" aria-hidden />
                      <input
                        ref={studioAiInputRef}
                        type="text"
                        value={studioAiPrompt}
                        onChange={(e) => {
                          setStudioAiPrompt(e.target.value);
                          if (studioAiStatus) setStudioAiStatus(null);
                        }}
                        placeholder={studioAiBusy ? 'Building motion…' : 'Ask AI to animate…'}
                        aria-label="AI assistant prompt"
                        disabled={studioAiBusy}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        type="submit"
                        className="studio-ai-go"
                        disabled={studioAiBusy || !studioAiPrompt.trim()}
                        title="Generate"
                      >
                        Go
                      </button>
                    </div>
                    <div className="studio-ai-meta">
                      {studioAiStatus ? (
                        <span className="studio-ai-status">{studioAiStatus}</span>
                      ) : (
                        <div className="studio-ai-chips" role="list">
                          {PROMPT_SUGGESTIONS.slice(0, 6).map((chip) => (
                            <button
                              key={chip}
                              type="button"
                              role="listitem"
                              className="studio-ai-chip"
                              onClick={() => runStudioAiPrompt(chip)}
                              title={`Animate: ${chip}`}
                            >
                              {chip}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </form>
                )}
              </div>
            )}
              <div className="workspace-mode-cluster">
                <div className="canvas-tool-bar-row" role="toolbar" aria-label="Canvas tools">
                  <div className="canvas-tool-pops" ref={shapeMenuRef}>
                    <div className="canvas-tool-pop">
                      <button
                        ref={flatShapeBtnRef}
                        type="button"
                        title="2D shapes"
                        aria-label="2D shapes"
                        aria-expanded={shapeMenu === 'flat'}
                        aria-haspopup="menu"
                        className={shapeMenu === 'flat' ? 'is-active has-caret' : 'has-caret'}
                        onClick={() => openShapeMenu('flat', flatShapeBtnRef.current)}
                      >
                        <Square size={15} />
                        <ChevronDown className="canvas-tool-caret" aria-hidden />
                      </button>
                    </div>
                    <div className="canvas-tool-pop">
                      <button
                        ref={solidShapeBtnRef}
                        type="button"
                        title="3D shapes"
                        aria-label="3D shapes"
                        aria-expanded={shapeMenu === 'solid'}
                        aria-haspopup="menu"
                        className={shapeMenu === 'solid' ? 'is-active has-caret' : 'has-caret'}
                        onClick={() => openShapeMenu('solid', solidShapeBtnRef.current)}
                      >
                        <Box size={15} />
                        <ChevronDown className="canvas-tool-caret" aria-hidden />
                      </button>
                    </div>
                    <div className="canvas-tool-pop">
                      <button
                        ref={stageBtnRef}
                        type="button"
                        title="Stage — what sits under the device"
                        aria-label="Stage type"
                        aria-expanded={shapeMenu === 'stage'}
                        aria-haspopup="menu"
                        className={shapeMenu === 'stage' ? 'is-active has-caret' : 'has-caret'}
                        onClick={() => openShapeMenu('stage', stageBtnRef.current)}
                      >
                        <Theater size={15} />
                        <ChevronDown className="canvas-tool-caret" aria-hidden />
                      </button>
                    </div>
                  </div>
                  {shapeMenu === 'stage' && shapeMenuBox && createPortal(
                    <div
                      ref={floatingMenuRef}
                      className="canvas-tool-menu is-text-menu is-stage-menu is-above"
                      role="menu"
                      aria-label="Stage type"
                      style={{ top: shapeMenuBox.top, left: shapeMenuBox.left }}
                    >
                      {STAGE_TYPES.map((type) => {
                        const Icon = type.icon;
                        const active = type.id === currentStageType;
                        return (
                          <button
                            key={type.id}
                            type="button"
                            role="menuitemradio"
                            aria-checked={active}
                            title={type.hint}
                            className={active ? 'is-active' : ''}
                            onClick={() => setStageType(type.id)}
                          >
                            <Icon size={15} />
                            <span className="canvas-tool-menu-label">{type.label}</span>
                            {active && <Check size={13} className="canvas-tool-menu-check" aria-hidden />}
                          </button>
                        );
                      })}
                    </div>,
                    document.body,
                  )}
                  {shapeMenu && shapeMenu !== 'stage' && shapeMenuBox && createPortal(
                    <div
                      ref={floatingMenuRef}
                      className="canvas-tool-menu is-above"
                      role="menu"
                      aria-label={shapeMenu === 'flat' ? '2D shapes' : '3D shapes'}
                      style={{ top: shapeMenuBox.top, left: shapeMenuBox.left }}
                    >
                      {shapeMenu === 'flat'
                        ? FLAT_SHAPES.map((shape) => {
                          const Icon = shape.icon;
                          return (
                            <button
                              key={shape.id}
                              type="button"
                              role="menuitem"
                              title={shape.label}
                              aria-label={`Add ${shape.label}`}
                              onClick={() => {
                                addFlatShape(shape.id);
                                setShapeMenu(null);
                              }}
                            >
                              <Icon size={15} />
                            </button>
                          );
                        })
                        : INSERT_SHAPES.map((shape) => {
                          const Icon = shape.icon;
                          return (
                            <button
                              key={shape.kind}
                              type="button"
                              role="menuitem"
                              title={shape.label}
                              aria-label={`Add ${shape.label}`}
                              onClick={() => {
                                addInsertShape(shape.kind);
                                setShapeMenu(null);
                              }}
                            >
                              <Icon size={15} />
                            </button>
                          );
                        })}
                    </div>,
                    document.body,
                  )}
                  <div className="canvas-tool-pop" ref={textToolRef}>
                    <button
                      ref={textBtnRef}
                      type="button"
                      title="Text, comments, and annotations"
                      aria-label="Text, comments, and annotations"
                      aria-expanded={textMenu}
                      aria-haspopup="menu"
                      className={textMenu || canvasTool === 'comments' || canvasTool === 'pen' ? 'is-active has-caret' : 'has-caret'}
                      onClick={toggleTextMenu}
                    >
                      <Type size={15} />
                      <ChevronDown className="canvas-tool-caret" aria-hidden />
                    </button>
                  </div>
                  {textMenu && textMenuBox && createPortal(
                    <div
                      ref={textMenuRef}
                      className="canvas-tool-menu is-text-menu is-above"
                      role="menu"
                      aria-label="Text tools"
                      style={{ top: textMenuBox.top, left: textMenuBox.left }}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          addInsertText();
                          setCanvasTool('composition');
                          setTextMenu(false);
                        }}
                      >
                        <Type size={15} /> Text
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className={canvasTool === 'comments' ? 'is-active' : ''}
                        onClick={() => chooseMarkup('comments')}
                      >
                        <MessageSquare size={15} /> Comment
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className={canvasTool === 'pen' ? 'is-active' : ''}
                        onClick={() => chooseMarkup('pen')}
                      >
                        <PenTool size={15} /> Annotation
                      </button>
                      <span className="canvas-tool-divider" />
                      <label className="canvas-tool-color-row">
                        Background
                        <input
                          type="color"
                          value={markFill}
                          aria-label="Annotation background colour"
                          onChange={(event) => applyMarkColor('fill', event.target.value)}
                        />
                      </label>
                      <label className="canvas-tool-color-row">
                        Text
                        <input
                          type="color"
                          value={markInk}
                          aria-label="Annotation text colour"
                          onChange={(event) => applyMarkColor('ink', event.target.value)}
                        />
                      </label>
                      {selectedComment && (
                        <textarea
                          className="canvas-tool-note"
                          value={selectedComment.text ?? ''}
                          placeholder="Write a comment…"
                          rows={2}
                          aria-label="Comment text"
                          onChange={(event) => patchOverlay(selectedComment.id, { text: event.target.value })}
                        />
                      )}
                      {selectedMark && (
                        <button type="button" className="is-danger" onClick={removeSelectedMark}>
                          <Trash2 size={14} /> Remove
                        </button>
                      )}
                      {canvasTool === 'comments' && !selectedComment && (
                        <p className="canvas-tool-hint">Click the model to pin a comment. It stays on the device.</p>
                      )}
                      {canvasTool === 'pen' && !selectedMark && (
                        <p className="canvas-tool-hint">Draw on the model. Text colour is the stroke.</p>
                      )}
                    </div>,
                    document.body,
                  )}
                  <span className="canvas-tool-divider" />
                  <div className="canvas-tool-nest" role="tablist" aria-label="Workspace mode">
                    <button
                      type="button"
                      role="tab"
                      title="Composition"
                      aria-label="Composition"
                      aria-selected={!timelineOpen}
                      className={!timelineOpen ? 'is-active' : ''}
                      onClick={showComposition}
                    >
                      <Layers3 size={15} />
                    </button>
                    <button
                      type="button"
                      role="tab"
                      title="Animate"
                      aria-label="Animate"
                      aria-selected={timelineOpen}
                      className={timelineOpen ? 'is-active' : ''}
                      onClick={showAnimate}
                    >
                      <Film size={15} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
        </main>

        <aside className="right-panel" aria-hidden={sidePanelsHidden} ref={rightPanelRef}>
          <CompositionSwitcher
            templates={sceneCompositions}
            activeId={activeCompositionId}
            onApply={onApplyComposition}
            mode={isDeveloperToolset ? 'developer' : 'user'}
            onDuplicate={onDuplicateLibraryTemplate}
          />
          {isDeveloperToolset && (
            <div className="template-quick-edit" aria-label="Quick edit shipped template">
              <div className="template-quick-edit-copy">
                <strong>Quick edit</strong>
                <span>
                  {activeCompositionId && isDevEditableTemplateId(activeCompositionId)
                    ? (getCompositionTemplate(activeCompositionId)?.label ?? activeCompositionId)
                    : 'Pick a template to edit'}
                </span>
              </div>
              <div className="template-quick-edit-actions">
                <button
                  type="button"
                  className="text-button"
                  title="Browse Devices & Scenes templates"
                  onClick={() => {
                    setTemplateCategory('scenes');
                    setTemplatePickerOpen(true);
                  }}
                >
                  <LayoutTemplate size={13} /> Browse
                </button>
                <button
                  type="button"
                  className="button primary-button"
                  disabled={!activeCompositionId || !isDevEditableTemplateId(activeCompositionId) || project.devices.length === 0}
                  title="Write current shot into shippedTemplates.json for User view"
                  onClick={() => void quickUpdateShippedTemplate()}
                >
                  <RefreshCw size={13} /> Update shipped
                </button>
              </div>
            </div>
          )}
          <div className="inspector-scroll" ref={inspectorScrollRef}>
            {studioSetFocus && (
              <div className="surround-colour-dock is-active" data-stop={studioSetFocus}>
                <div className="surround-colour-dock-head">
                  <strong>
                    {studioSetFocus === 'sky'
                      ? 'Surround colour'
                      : studioSetFocus === 'floor'
                        ? 'Floor colour'
                        : 'Backdrop colour'}
                  </strong>
                  <span>
                    {isTransparent
                      ? 'Transparent look is on — restore colours to edit'
                      : 'Opened from background tap · drag canvas still orbits'}
                  </span>
                </div>
                {isTransparent ? (
                  <button
                    type="button"
                    className="button primary-button surround-colour-restore"
                    onClick={restoreColouredBackground}
                  >
                    Restore coloured background
                  </button>
                ) : (
                  <div className="gradient-color-grid is-separate-stops">
                    {([
                      ['mid', 'Sky · surround', 'sky'],
                      ['edge', 'Floor', 'floor'],
                      ['center', 'Backdrop', 'backdrop'],
                    ] as const).map(([key, label, stop]) => (
                      <label
                        key={key}
                        className={`gradient-color-field${studioSetFocus === stop ? ' is-highlighted' : ''}`}
                        onPointerDown={() => setStudioSetFocus(stop)}
                      >
                        <span className="gradient-color-label">{label}</span>
                        <span className="gradient-color-input">
                          <input
                            type="color"
                            value={project.gradientColors[key]}
                            aria-label={`${label} colour`}
                            onFocus={() => setStudioSetFocus(stop)}
                            onChange={(e) => updateGradient(key, e.target.value)}
                          />
                          <input
                            type="text"
                            defaultValue={project.gradientColors[key]}
                            key={`dock-${key}-${project.gradientColors[key]}`}
                            maxLength={7}
                            aria-label={`${label} hex`}
                            onFocus={() => setStudioSetFocus(stop)}
                            onBlur={(e) => updateGradient(key, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                          />
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
            <SettingsSection id="camera" title="Camera" hint="Control the camera view, lens, and focus" icon={Settings2} open={openSectionId === 'camera'} onToggle={toggleSection}>
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
                {CAMERA_LENSES.find((l) => l.id === (project.cameraLens ?? 'standard'))?.hint ?? '~50 mm'} · changes perspective FOV
              </p>
              <div className="option-toggle-row" style={{ marginTop: 14 }}>
                <span>Depth of field</span>
                <SwitchControl
                  checked={project.depthOfField ?? false}
                  label="Depth of field"
                  onChange={(on) => updateProject({ depthOfField: on })}
                />
              </div>
              {(project.depthOfField ?? false) && (
                <SliderField
                  label="Blur"
                  min={5}
                  max={100}
                  step={1}
                  unit="%"
                  value={Math.round((project.depthOfFieldAmount ?? DEFAULT_PROJECT.depthOfFieldAmount) * 100)}
                  onChange={(v) => updateProject({ depthOfFieldAmount: v / 100 })}
                />
              )}
              <p className="field-caption" style={{ marginTop: 0 }}>
                Keeps the selected device sharp and softens the rest of the scene.
              </p>
              <button type="button" className="button full-outline compact" style={{ marginTop: 10 }} onClick={keyCameraAtPlayhead}>
                <Aperture size={14} /> Key camera at playhead
              </button>
              <p className="field-caption" style={{ marginTop: 8 }}>
                With the timeline open, orbit or dolly the view to key Camera X, Y, and Z. Scrub, then orbit again for the next pose.
              </p>
            </SettingsSection>
            <SettingsSection id="frame" title="Frame size" hint="Canvas aspect ratio and crop" icon={Columns2} open={openSectionId === 'frame'} onToggle={toggleSection}>
            <section
              className="frame-size-block"
              aria-label="Aspect ratio"
              onPointerDown={(event) => {
                const pill = (event.target as HTMLElement).closest('.aspect-format-pill, .aspect-ratio-trigger');
                if (!(pill instanceof HTMLElement)) return;
                pill.classList.add('is-tapped');
                window.setTimeout(() => pill.classList.remove('is-tapped'), 420);
              }}
            >
              <div className="field-caption section-label aspect-sidebar-label">
                Aspect ratio
                <span>
                  {exportAspectIds.filter((id) => id !== 'custom').length > 1
                    ? `${exportAspectIds.filter((id) => id !== 'custom').length} formats`
                    : previewFrame === 'free'
                      ? (exportAspectIds.length === 1 && exportAspectIds[0] === 'custom' ? 'Custom' : 'Free')
                      : (previewAspect?.hint ?? EXPORT_ASPECTS.find((item) => item.id === exportAspectIds[0])?.hint ?? 'Custom')}
                </span>
              </div>
              <p className="aspect-sidebar-hint">Multi-select formats, then tap a pill to preview that crop.</p>
              <div
                className={`aspect-ratio-picker ${aspectDropdownOpen ? 'is-open' : ''}`}
                ref={aspectDropdownRef}
              >
                <div className="aspect-format-pills" role="list" aria-label="Selected formats">
                  <button
                    type="button"
                    role="listitem"
                    className={`aspect-format-pill ${previewFrame === 'free' ? 'is-active' : ''}`}
                    title="Free · no crop"
                    aria-pressed={previewFrame === 'free'}
                    onClick={() => applyPlatformFrame('free')}
                  >
                    Free
                  </button>
                  {exportAspectIds
                    .filter((id) => id !== 'custom')
                    .map((id) => {
                      const item = frameMeta(id, savedSizes);
                      if (!item) return null;
                      const active = previewFrame === id;
                      const canDismiss = exportAspectIds.filter((aspectId) => aspectId !== 'custom').length > 1;
                      return (
                        <div
                          key={id}
                          role="listitem"
                          className={`aspect-format-pill ${active ? 'is-active' : ''}`}
                        >
                          <button
                            type="button"
                            className="aspect-format-pill-select"
                            title={`${item.label} · ${item.hint}`}
                            aria-pressed={active}
                            onClick={() => focusPlatformAspect(id)}
                          >
                            {item.shortLabel}
                            <span className="aspect-format-pill-hint">{item.hint}</span>
                          </button>
                          {canDismiss && (
                            <button
                              type="button"
                              className="aspect-format-pill-dismiss"
                              title={`Remove ${item.shortLabel}`}
                              aria-label={`Remove ${item.shortLabel}`}
                              onClick={() => toggleExportAspect(id)}
                            >
                              <X size={11} strokeWidth={2.6} aria-hidden />
                            </button>
                          )}
                        </div>
                      );
                    })}
                </div>
                <button
                  type="button"
                  className="aspect-ratio-trigger"
                  aria-expanded={aspectDropdownOpen}
                  aria-haspopup="listbox"
                  title="Add or remove formats"
                  onClick={(event) => {
                    const willOpen = !aspectDropdownOpen;
                    if (!willOpen) {
                      setAspectDropdownOpen(false);
                      return;
                    }
                    const anchor = event.currentTarget;
                    setAspectMenuBox(measureFloatingMenu(anchor));
                    setAspectDropdownOpen(true);
                  }}
                >
                  <Columns2 size={14} aria-hidden />
                  <span>Formats</span>
                  <ChevronDown size={13} className="aspect-ratio-trigger-chevron" aria-hidden />
                </button>
                {aspectDropdownOpen && aspectMenuBox && createPortal(
                  <div
                    ref={aspectMenuRef}
                    className="aspect-ratio-menu is-floating"
                    role="listbox"
                    aria-multiselectable
                    aria-label="Aspect ratio formats"
                    style={{
                      top: aspectMenuBox.top,
                      bottom: aspectMenuBox.bottom,
                      left: aspectMenuBox.left,
                      width: aspectMenuBox.width,
                      maxHeight: aspectMenuBox.maxHeight,
                    }}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={previewFrame === 'free'}
                      className={`aspect-ratio-option ${previewFrame === 'free' ? 'is-selected' : ''}`}
                      onClick={() => applyPlatformFrame('free')}
                    >
                      <span className="aspect-ratio-option-copy">
                        <strong>Free</strong>
                        <span>No crop</span>
                      </span>
                      {previewFrame === 'free' ? <Check size={13} /> : null}
                    </button>
                    <form
                      className="aspect-size-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        onSaveAssetSize(sizeDraft.width, sizeDraft.height);
                      }}
                    >
                      <input
                        className="preset-name-input"
                        value={sizeName}
                        maxLength={40}
                        placeholder="Custom size name"
                        aria-label="Custom size name"
                        onChange={(event) => setSizeName(event.target.value)}
                      />
                      <div className="aspect-size-form-dims">
                        <input
                          type="number"
                          min={EXPORT_SIZE_LIMITS.min}
                          max={EXPORT_SIZE_LIMITS.max}
                          step={2}
                          value={sizeDraft.width}
                          aria-label="Width"
                          onChange={(event) => setSizeDraft((current) => ({
                            ...current,
                            width: Number(event.target.value) || current.width,
                          }))}
                        />
                        <input
                          type="number"
                          min={EXPORT_SIZE_LIMITS.min}
                          max={EXPORT_SIZE_LIMITS.max}
                          step={2}
                          value={sizeDraft.height}
                          aria-label="Height"
                          onChange={(event) => setSizeDraft((current) => ({
                            ...current,
                            height: Number(event.target.value) || current.height,
                          }))}
                        />
                        <button type="submit">Add</button>
                      </div>
                    </form>
                    {savedSizes.length > 0 && (
                      <div className="aspect-ratio-menu-group" role="group" aria-label="Your sizes">
                        <div className="aspect-ratio-menu-label">Your sizes</div>
                        {savedSizes.map((item) => {
                          const selected = exportAspectIds.includes(item.id);
                          return (
                            <div key={item.id} className="aspect-saved-row">
                              <button
                                type="button"
                                role="option"
                                aria-selected={selected}
                                className={`aspect-ratio-option ${selected ? 'is-selected' : ''}`}
                                title={`${item.label} · ${item.width}×${item.height}`}
                                onClick={() => toggleExportAspect(item.id)}
                              >
                                <span className="aspect-ratio-option-copy">
                                  <strong>{item.label}</strong>
                                  <span>{item.width}×{item.height}</span>
                                </span>
                                {selected ? <Check size={13} /> : null}
                              </button>
                              <button
                                type="button"
                                className="aspect-saved-remove"
                                title={`Remove ${item.label}`}
                                aria-label={`Remove ${item.label}`}
                                onClick={() => onDeleteSize(item.id)}
                              >
                                <X size={12} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {EXPORT_ASPECT_GROUPS.map((group) => {
                      const items = EXPORT_ASPECTS.filter((item) => item.group === group.id && item.id !== 'custom');
                      if (!items.length) return null;
                      return (
                        <div key={group.id} className="aspect-ratio-menu-group" role="group" aria-label={group.label}>
                          <div className="aspect-ratio-menu-label">{group.label}</div>
                          {items.map((item) => {
                            const selected = exportAspectIds.includes(item.id);
                            return (
                              <button
                                key={item.id}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                className={`aspect-ratio-option ${selected ? 'is-selected' : ''}`}
                                title={`${item.label} · ${item.hint}`}
                                onClick={() => toggleExportAspect(item.id)}
                              >
                                <span className="aspect-ratio-option-copy">
                                  <strong>{item.label}</strong>
                                  <span>{item.hint}</span>
                                </span>
                                {selected ? <Check size={13} /> : null}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>,
                  document.body,
                )}
              </div>
            </section>
            </SettingsSection>
            <SettingsSection id="device" title="Device" icon={Smartphone} open={openSectionId === 'device'} onToggle={toggleSection}>
              <div className="option-toggle-row">
                <span>iOS + Android</span>
                <SwitchControl
                  checked={project.compositionMode === 'split'}
                  label="iOS + Android"
                  title={project.compositionMode === 'split' ? 'Return to a single device' : 'Open dual iOS + Android canvases'}
                  onChange={(on) => (on ? enableSplitComposition() : enableSingleComposition())}
                />
              </div>
              {project.compositionMode === 'split' && (
                <>
                  <div className="publish-target-switch" role="group" aria-label="Publish target">
                    <button
                      type="button"
                      className={activePublishTarget === 'ios' ? 'is-active' : ''}
                      onClick={() => switchPublishTarget('ios')}
                    >
                      Edit iOS
                    </button>
                    <button
                      type="button"
                      className={activePublishTarget === 'android' ? 'is-active' : ''}
                      onClick={() => switchPublishTarget('android')}
                    >
                      Edit Android
                    </button>
                  </div>
                  <div className="option-toggle-row">
                    <span>Link rotation &amp; scale</span>
                    <SwitchControl
                      checked={project.linkSplitTransform !== false}
                      label="Link rotation and scale"
                      title="Keep rotation and scale mirrored across platforms. Position stays independent."
                      onChange={(on) => {
                        if (!on) {
                          updateProject({ linkSplitTransform: false });
                          return;
                        }
                        setProject((current) => {
                          const source = getPublishEnvDevice(current);
                          return syncProjectFromSelected({
                            ...current,
                            linkSplitTransform: true,
                            devices: mirrorLinkedTransforms(current.devices, source),
                          }, source);
                        });
                      }}
                    />
                  </div>
                </>
              )}
              {project.compositionMode === 'split' ? (
                <div className="split-env-device-block">
                  {([
                    { platform: 'ios' as const, device: iosEnvDevice, finish: iosEnvFinish, title: 'iOS device' },
                    { platform: 'android' as const, device: androidEnvDevice, finish: androidEnvFinish, title: 'Android device' },
                  ]).map(({ platform, device, finish, title }) => {
                    const model = getDevice(device.deviceId);
                    const menuOpen = splitDeviceMenu === platform;
                    const platformDevices = filteredDevices.filter((d) => d.platform === platform);
                    const isAssetTarget = activePublishTarget === platform;
                    return (
                      <div
                        key={platform}
                        className={`split-env-device-card ${isAssetTarget ? 'is-active-env' : ''}`}
                      >
                        <div className="split-env-device-card-head">
                          <strong>{title}</strong>
                          <span>{isAssetTarget ? 'Assets target' : 'Model only'}</span>
                        </div>
                        <div className={`device-dropdown ${menuOpen ? 'is-open' : ''}`}>
                          <button
                            type="button"
                            className="device-dropdown-trigger"
                            aria-expanded={menuOpen}
                            aria-haspopup="listbox"
                            title={`Choose ${platform === 'ios' ? 'iOS' : 'Android'} device`}
                            onClick={(event) => {
                              const root = event.currentTarget.closest('.device-dropdown');
                              const willOpen = splitDeviceMenu !== platform;
                              setSplitDeviceMenu(willOpen ? platform : null);
                              if (willOpen && root instanceof HTMLElement) pinToContainerTop(root);
                            }}
                          >
                            <span className="device-dropdown-copy">
                              <strong>{model.label}</strong>
                              <span>{screenSizeLabel(model.screenSize)}</span>
                            </span>
                            <ChevronDown size={14} className="device-dropdown-chevron" />
                          </button>
                          {menuOpen && (
                            <div className="device-dropdown-menu" role="listbox" aria-label={`${title} models`}>
                              <DeviceCategoryBar value={deviceCategoryFilter} onChange={setDeviceCategoryFilter} />
                              <div className="device-dropdown-options">
                              {platformDevices.length === 0 ? (
                                <div className="device-dropdown-empty">No devices in this category</div>
                              ) : (
                                <DeviceMenuOptions
                                  devices={platformDevices}
                                  grouped={deviceCategoryFilter === 'all'}
                                  isSelected={(id) => device.deviceId === id}
                                  isUnlocked={(id) => isDeviceUnlocked(license.tier, id)}
                                  onPick={(option, unlocked) => {
                                    if (!unlocked) {
                                      notify(upgradeCopy('The full device library'));
                                      setLicenseOpen(true);
                                      setSplitDeviceMenu(null);
                                      return;
                                    }
                                    setProject((current) => applyDeviceToPlatform(current, platform, option.id));
                                    setCameraRecenterToken((n) => n + 1);
                                    setDeviceChosen(true);
                                    setSplitDeviceMenu(null);
                                  }}
                                />
                              )}
                              </div>
                            </div>
                          )}
                        </div>
                        <FinishDots
                          ariaLabel={`${title} finish`}
                          color={finish.deviceColor}
                          clayMode={finish.clayMode}
                          onPick={(next) => setProject((current) => applyFinishToPlatform(current, platform, {
                            deviceColor: next,
                            clayMode: next === 'clay',
                          }))}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <>
                  <div
                    className={`device-dropdown ${deviceDropdownOpen ? 'is-open' : ''}`}
                    ref={deviceDropdownRef}
                  >
                    <button
                      type="button"
                      className="device-dropdown-trigger"
                      aria-expanded={deviceDropdownOpen}
                      aria-haspopup="listbox"
                      title="Choose device"
                      onClick={(event) => {
                        const root = event.currentTarget.closest('.device-dropdown');
                        const willOpen = !deviceDropdownOpen;
                        setDeviceDropdownOpen(willOpen);
                        if (willOpen && root instanceof HTMLElement) pinToContainerTop(root);
                      }}
                    >
                      <span className="device-dropdown-copy">
                        <strong>{getDevice(project.deviceId).label}</strong>
                        <span>{screenSizeLabel(getDevice(project.deviceId).screenSize)}</span>
                      </span>
                      <ChevronDown size={14} className="device-dropdown-chevron" />
                    </button>
                    {deviceDropdownOpen && (
                      <div className="device-dropdown-menu" role="listbox" aria-label="Devices">
                        <DeviceCategoryBar value={deviceCategoryFilter} onChange={setDeviceCategoryFilter} />
                        <div className="device-dropdown-options">
                        {filteredDevices.length === 0 ? (
                          <div className="device-dropdown-empty">No devices in this category</div>
                        ) : (
                          <DeviceMenuOptions
                            devices={filteredDevices}
                            grouped={deviceCategoryFilter === 'all'}
                            isSelected={(id) => project.deviceId === id}
                            isUnlocked={(id) => isDeviceUnlocked(license.tier, id)}
                            onPick={(device, unlocked) => {
                              if (!unlocked) {
                                notify(upgradeCopy('The full device library'));
                                setLicenseOpen(true);
                                setDeviceDropdownOpen(false);
                                return;
                              }
                              patchSelectedDevice({ deviceId: device.id });
                              setDeviceChosen(true);
                              setDeviceDropdownOpen(false);
                              if (isPlaceholderScreenshot(activeEnvScreenshot)) {
                                applyScreenImage(placeholderForDevice(device), device.label, 'Size guide updated');
                              }
                            }}
                          />
                        )}
                        </div>
                        <button
                          type="button"
                          className="device-dropdown-import"
                          onClick={() => {
                            customDevicePanelRef.current?.openImport();
                            setDeviceDropdownOpen(false);
                          }}
                        >
                          <Upload size={13} />
                          Import model
                        </button>
                        <button
                          type="button"
                          className="device-dropdown-import device-dropdown-import-folder"
                          onClick={() => {
                            customDevicePanelRef.current?.openImportFolder();
                            setDeviceDropdownOpen(false);
                          }}
                        >
                          <Upload size={13} />
                          Import folder
                        </button>
                          <p className="device-dropdown-import-hint">GLB, glTF, FBX, DAE, OBJ, Blend, or C4D — pick several models at once. Select texture images with each mesh, or import the export folder. Desktop converts .blend via Blender; C4D / Max / Maya still need an export to GLB or FBX first.</p>
                      </div>
                    )}
                  </div>
                  <CustomDevicePanel
                    ref={customDevicePanelRef}
                    selectedDeviceId={project.deviceId}
                    customDevices={customDevices}
                    onNotify={notify}
                    onImported={(metas) => {
                      placeImportedCustomDevices(metas);
                    }}
                    onUpdated={() => {
                      setCustomDevices(loadCustomDeviceMeta());
                      setDevicesTick((n) => n + 1);
                      if (isPlaceholderScreenshot(activeEnvScreenshot) && isCustomDeviceId(project.deviceId)) {
                        applyScreenImage(placeholderForDevice(project.deviceId), 'Custom', 'Size guide updated');
                      }
                    }}
                    onDeleted={(id) => {
                      setCustomDevices(loadCustomDeviceMeta());
                      setDevicesTick((n) => n + 1);
                      if (project.deviceId === id) {
                        const fallback = DEVICE_MODELS[0];
                        patchSelectedDevice({ deviceId: fallback.id });
                        if (isPlaceholderScreenshot(activeEnvScreenshot)) {
                          applyScreenImage(placeholderForDevice(fallback), fallback.label, 'Size guide updated');
                        }
                      }
                    }}
                  />
                  <FinishDots
                    ariaLabel="Device finish"
                    color={project.deviceColor}
                    clayMode={project.clayMode}
                    onPick={(next) => setProject((current) => applyFinishToPublishEnv(current, {
                      deviceColor: next,
                      clayMode: next === 'clay',
                    }))}
                  />
                </>
              )}
              {deviceChosen && (
                <button className="text-button" onClick={() => { setLeftWorkspaceTab('assets'); imageInputRef.current?.click(); }}>
                  <ImagePlus size={14} />
                  {screenMediaKind(activeEnvScreenshot) === 'video' ? 'Replace screen video' : 'Replace screenshot'}
                </button>
              )}
              {project.compositionMode !== 'split' && (
                <div className="device-multi-row">
                  <button
                    type="button"
                    className="text-button"
                    title="Add another device to this composition (⌘D)"
                    disabled={project.devices.length >= entitlementsMaxDevices}
                    onClick={() => addDeviceToScene()}
                  >
                    <Plus size={14} />
                    Add device
                    <span className="device-multi-count">{project.devices.length}/{entitlementsMaxDevices}</span>
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    title="Save devices, angles, lighting and motion as a reusable template (⇧⌘S)"
                    onClick={() => onSaveComposition({ openLibrary: true })}
                  >
                    <LayoutTemplate size={14} />
                    Save as template
                  </button>
                </div>
              )}
            </SettingsSection>

            <SettingsSection id="transform" title="Transform" hint="Position, angle, rotation and materials" icon={Rotate3D} open={openSectionId === 'transform'} onToggle={toggleSection}>
              <div className="field-caption">Studio angle</div>
              <div className="camera-preset-grid studio-pose-grid" role="group" aria-label="Studio angles">
                {STUDIO_POSES.map((pose) => (
                  <button
                    key={pose.id}
                    type="button"
                    title={pose.hint}
                    className={studioPoseIdFor(getSelectedDevice(project).rotation, savedAngles) === pose.id ? 'selected' : ''}
                    onClick={() => applyStudioPose(pose.id)}
                  >
                    {pose.label}
                  </button>
                ))}
                {savedAngles.map((pose) => (
                  <div key={pose.id} className="pose-save-slot">
                    <button
                      type="button"
                      title={pose.hint}
                      className={studioPoseIdFor(getSelectedDevice(project).rotation, savedAngles) === pose.id ? 'selected' : ''}
                      onClick={() => applyStudioPose(pose.id)}
                    >
                      {pose.label}
                    </button>
                    <button
                      type="button"
                      className="pose-save-remove"
                      title={`Remove ${pose.label}`}
                      aria-label={`Remove ${pose.label}`}
                      onClick={() => onDeleteAngle(pose.id)}
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
              <form
                className="preset-save-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSaveAngle();
                }}
              >
                <input
                  className="preset-name-input"
                  value={angleName}
                  maxLength={24}
                  placeholder="Save this angle"
                  aria-label="Angle name"
                  onChange={(event) => setAngleName(event.target.value)}
                />
                <button type="submit" className="button">Save</button>
              </form>
              <p className="field-caption" style={{ marginTop: 8 }}>
                Snaps the model to a product angle. Saved angles stay in this list.
              </p>
              <div className="field-caption">Template</div>
              <form
                className="preset-save-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSaveComposition({ openLibrary: true });
                }}
              >
                <input
                  className="preset-name-input"
                  value={compositionName}
                  maxLength={40}
                  placeholder={project.name || 'Save as template'}
                  aria-label="Template name"
                  onChange={(event) => setCompositionName(event.target.value)}
                />
                <button type="submit" className="button">Save</button>
              </form>
              <p className="field-caption" style={{ marginTop: 6 }}>
                Keeps all {project.devices.length} device{project.devices.length === 1 ? '' : 's'}, angles, lighting, and motion. ⇧⌘S
              </p>
              {isDeveloperToolset && (
                <>
                  <div className="preset-save-row" style={{ marginTop: 6 }}>
                    <button
                      type="button"
                      className="text-button"
                      title="Copy TypeScript for COMPOSITION_TEMPLATES so this shot ships with the app"
                      onClick={() => void onCopyBuiltinComposition('devices')}
                    >
                      <Copy size={13} /> Copy as built-in
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      title="Same, with category: scenes"
                      onClick={() => void onCopyBuiltinComposition('scenes')}
                    >
                      <Copy size={13} /> as scene
                    </button>
                  </div>
                  <p className="field-caption" style={{ marginTop: 4 }}>
                    Dev only — prefer Ship in the developer panel so User gets the layout live.
                  </p>
                </>
              )}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setTemplateCategory('saved');
                  setTemplatePickerOpen(true);
                }}
              >
                <LayoutTemplate size={13} /> Browse your templates
              </button>
              <AxisInputs
                label="Position"
                axes={[
                  { key: 'x', min: -10, max: 10, value: displaySelected.position?.x ?? 0 },
                  { key: 'y', min: -6, max: 6, value: displaySelected.position?.y ?? 0 },
                  { key: 'z', min: -8, max: 8, value: displaySelected.position?.z ?? 0 },
                ]}
                onChange={(axis, value) => {
                  const position = displaySelected.position ?? { x: 0, y: 0, z: 0 };
                  onMoveDevice(displaySelected.id, { ...position, [axis]: value });
                }}
              />
              <SliderField label="Rotate X" min={-90} max={90} value={displaySelected.rotation.x} onChange={(v) => updateRotation('x', v)} />
              <SliderField label="Rotate Y" min={-180} max={180} value={displaySelected.rotation.y} onChange={(v) => updateRotation('y', v)} />
              <SliderField label="Rotate Z" min={-90} max={90} value={displaySelected.rotation.z} onChange={(v) => updateRotation('z', v)} />
              <SliderField label="Scale" min={0.6} max={1.3} step={0.05} unit="×" value={displaySelected.scale} onChange={(v) => {
                patchSelectedDevice({ scale: v });
                if (timelineOpen) keyPropertyAtPlayhead('scale', v);
              }} />
              {getDevice(displaySelected.deviceId).lid ? (
                <SliderField
                  label={getDevice(displaySelected.deviceId).lid?.mode === 'fold' ? 'Fold' : 'Lid'}
                  min={0}
                  max={1}
                  step={0.01}
                  unit=""
                  value={displaySelected.lidOpen ?? 1}
                  onChange={(v) => {
                    patchSelectedDevice({ lidOpen: v });
                    if (timelineOpen) keyPropertyAtPlayhead('lidOpen', v);
                  }}
                />
              ) : null}
              <div className="field-caption">Materials</div>
              <SliderField
                label="Glass reflection"
                min={0}
                max={1}
                step={0.05}
                unit=""
                value={displaySelected.glassReflection ?? 0.55}
                onChange={(v) => patchSelectedDevice({
                  glassReflection: v,
                  reflectionStyle: reflectionStyleForAmount(v),
                })}
              />
              <button className="text-button" onClick={resetDevice}><RotateCcw size={13} /> Reset transform</button>
            </SettingsSection>

            <SettingsSection
              id="overlays"
              title="Overlays"
              hint="Add titles on top of the shot"
              icon={Layers3}
              open={openSectionId === 'overlays'}
              onToggle={toggleSection}
            >
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
                    pinLayer('overlay', next.id);
                  }}
                >
                  <Plus size={14} /> Add text
                </button>
              </div>
              {(project.overlays ?? []).filter((item) => item.kind !== 'comment' && item.kind !== 'path').length === 0 && (
                <p className="field-caption">Add titles, then drag them on the canvas. Colour, size, and timing edit below.</p>
              )}
              {(project.overlays ?? []).filter((item) => item.kind !== 'comment' && item.kind !== 'path').map((overlay) => (
                <div key={overlay.id} className="overlay-editor-slot">
                <div
                  className={`overlay-editor ${selectedOverlayId === overlay.id ? 'is-selected' : ''}`}
                  onClick={() => pinLayer('overlay', overlay.id)}
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
                  {overlay.kind === 'text' && (
                    <div className="overlay-row">
                      <label>
                        Extrusion
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={overlay.extrusion ?? 0}
                          aria-label="Text extrusion"
                          onChange={(e) => patchOverlay(overlay.id, { extrusion: Number(e.target.value) })}
                        />
                      </label>
                    </div>
                  )}
                  {overlay.kind === 'shape' && (
                    <>
                      <div className="overlay-row overlay-row-color">
                        <label className="overlay-color-field">
                          Colour
                          <span className="gradient-color-input">
                            <input
                              type="color"
                              value={overlay.color || '#d7dde4'}
                              aria-label="Shape colour"
                              onChange={(e) => {
                                const hex = normalizeOverlayColor(e.target.value);
                                if (hex) patchOverlay(overlay.id, { color: hex });
                              }}
                            />
                            <input
                              type="text"
                              defaultValue={overlay.color || '#d7dde4'}
                              key={`shape-color-${overlay.id}-${overlay.color || '#d7dde4'}`}
                              maxLength={7}
                              aria-label="Shape colour hex"
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
                          Shape
                          <select
                            value={flatShapeOf(overlay)}
                            aria-label="Flat shape"
                            onChange={(e) => patchOverlay(overlay.id, { text: e.target.value })}
                          >
                            <option value="rect">Rectangle</option>
                            <option value="ellipse">Ellipse</option>
                            <option value="triangle">Triangle</option>
                          </select>
                        </label>
                      </div>
                      <div className="overlay-row">
                        <label>
                          Extrusion
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={overlay.extrusion ?? 0}
                            aria-label="Shape extrusion"
                            onChange={(e) => patchOverlay(overlay.id, { extrusion: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                      <p className="field-caption" style={{ marginTop: 0 }}>
                        Extruded shapes stay front-facing with the camera.
                      </p>
                    </>
                  )}
                  <div className="overlay-row">
                    <label>
                      <span className="overlay-axis-head">
                        X
                        <input
                          type="number"
                          className="overlay-axis-num"
                          min={0}
                          max={1}
                          step={0.01}
                          value={overlay.x.toFixed(2)}
                          aria-label="Position X"
                          title="Drag left or right to adjust. Shift for finer steps."
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            if (!Number.isFinite(next)) return;
                            patchOverlay(overlay.id, { x: Math.min(1, Math.max(0, next)) });
                          }}
                        />
                      </span>
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
                      <span className="overlay-axis-head">
                        Y
                        <input
                          type="number"
                          className="overlay-axis-num"
                          min={0}
                          max={1}
                          step={0.01}
                          value={overlay.y.toFixed(2)}
                          aria-label="Position Y"
                          title="Drag left or right to adjust. Shift for finer steps."
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            if (!Number.isFinite(next)) return;
                            patchOverlay(overlay.id, { y: Math.min(1, Math.max(0, next)) });
                          }}
                        />
                      </span>
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
                </div>
              ))}
            </SettingsSection>

            <SettingsSection id="reflection" title="Reflection" hint="Finish and environment on glass and screens" icon={Aperture} open={openSectionId === 'reflection'} onToggle={toggleSection}>
              <div className="field-caption">Type</div>
              <div className="reflection-type-segment" role="tablist" aria-label="Reflection type">
                {REFLECTION_STYLES.map((style) => {
                  const active = (displaySelected.reflectionStyle
                    ?? reflectionStyleForAmount(displaySelected.glassReflection ?? 0.55)) === style.id;
                  return (
                    <button
                      key={style.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={active ? 'is-active' : ''}
                      onClick={() => patchSelectedDevice({
                        reflectionStyle: style.id as ReflectionStyle,
                        glassReflection: amountForReflectionStyle(style.id),
                      })}
                    >
                      {style.label}
                    </button>
                  );
                })}
              </div>
              <p className="field-caption">Matte stays soft, glossy sheens, mirror sharpens. Applies to every screen and glass surface.</p>
              <ReflectionMapPicker
                value={project.reflectionMap ?? DEFAULT_PROJECT.reflectionMap}
                customImage={project.reflectionMapImage ?? null}
                background={project.background}
                colors={project.background === 'transparent' ? null : project.gradientColors}
                onChange={(id: ReflectionMapSetting) => updateProject({ reflectionMap: id })}
                onCustomImage={(dataUrl) => updateProject({
                  reflectionMapImage: dataUrl,
                  reflectionMap: dataUrl ? 'custom' : 'match_background',
                })}
              />
            </SettingsSection>

            <SettingsSection id="light" title="Light" hint="Gentle key, soft HDRI, and optional extra lights" icon={Sun} open={openSectionId === 'light'} onToggle={toggleSection}>
              <div className="env-group">
                <div className="env-group-head">
                  <div className="field-caption">Key light</div>
                  <div className="env-reset-row">
                    <button
                      type="button"
                      className="env-reset"
                      title="Turn key light off"
                      onClick={() => updateProject({ lightIntensity: 0 })}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      className="env-reset"
                      title="Reset key light"
                      onClick={() => updateProject({
                        lightIntensity: DEFAULT_PROJECT.lightIntensity,
                        lightPosition: { ...DEFAULT_PROJECT.lightPosition },
                        lightColor: DEFAULT_PROJECT.lightColor,
                      })}
                    >
                      <RotateCcw size={12} />
                      Reset
                    </button>
                  </div>
                </div>
                <div className="env-sliders">
                  <SliderField
                    label="Intensity"
                    min={0}
                    max={5}
                    step={0.1}
                    unit="×"
                    value={project.lightIntensity}
                    onChange={(v) => updateProject({ lightIntensity: v })}
                  />
                  <label className="env-color-row">
                    <span>Color</span>
                    <input
                      type="color"
                      value={project.lightColor ?? DEFAULT_PROJECT.lightColor}
                      onChange={(e) => updateProject({ lightColor: e.target.value })}
                      aria-label="Key light color"
                    />
                  </label>
                  <LightDirectionControl
                    position={project.lightPosition ?? DEFAULT_PROJECT.lightPosition}
                    color={project.lightColor ?? DEFAULT_PROJECT.lightColor}
                    focus={displaySelected?.position ?? { x: 0, y: 0, z: 0 }}
                    deviceYawDeg={displaySelected?.rotation.y ?? 0}
                    onChange={(lightPosition) => updateProject({ lightPosition })}
                  />
                  <div className="option-toggle-row">
                    <span>Move in scene</span>
                    <SwitchControl
                      checked={lightGizmoActive}
                      label="Show light move gimbal"
                      onChange={(on) => {
                        setLightGizmoActive(on);
                        if (on) setLayerSelection({ kind: 'key-light' });
                      }}
                    />
                  </div>
                  <p className="field-caption" style={{ marginTop: 2 }}>
                    Drag the coloured axes on the key light to reposition it. Zoom out if the handle is off-frame.
                  </p>
                </div>
              </div>

              <div className="env-group" style={{ marginTop: 12 }}>
                <div className="env-group-head">
                  <div className="field-caption">Environment HDRI</div>
                  <button
                    type="button"
                    className="env-reset"
                    title="Use studio preset HDRI strength"
                    onClick={() => updateProject({ environmentIntensity: null })}
                  >
                    Auto
                  </button>
                </div>
                <div className="env-sliders">
                  <SliderField
                    label="Intensity"
                    min={0}
                    max={3}
                    step={0.05}
                    unit="×"
                    value={project.environmentIntensity
                      ?? resolveStudioPreset(project.background, project.gradientColors).environmentIntensity}
                    onChange={(v) => updateProject({ environmentIntensity: v })}
                  />
                  <p className="field-caption" style={{ marginTop: 2 }}>
                    Soft IBL wrap on metal and glass. Auto follows the studio look.
                  </p>
                </div>
              </div>

              <div className="env-group" style={{ marginTop: 12 }}>
                <div className="env-group-head">
                  <div className="field-caption">Exposure</div>
                  <button
                    type="button"
                    className="env-reset"
                    title="Use studio preset exposure"
                    onClick={() => updateProject({ toneMappingExposure: null })}
                  >
                    Auto
                  </button>
                </div>
                <div className="env-sliders">
                  <SliderField
                    label="ACES"
                    min={0.4}
                    max={2.5}
                    step={0.02}
                    unit="×"
                    value={project.toneMappingExposure
                      ?? resolveStudioPreset(project.background, project.gradientColors).toneMappingExposure}
                    onChange={(v) => updateProject({ toneMappingExposure: v })}
                  />
                  <p className="field-caption" style={{ marginTop: 2 }}>
                    Overall scene brightness after lighting. Auto follows the background studio look.
                  </p>
                </div>
              </div>

              <div className="env-group" style={{ marginTop: 12 }}>
                <div className="env-group-head">
                  <div className="field-caption">Extra lights</div>
                  <span className="field-caption">{(project.sceneLights ?? []).length}/{MAX_SCENE_LIGHTS}</span>
                </div>
                <p className="field-caption" style={{ marginBottom: 6 }}>
                  Point, spot, area, and directional luminaires for Spline-like setups. Layered on the studio softboxes.
                </p>
                <div className="preset-save-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {([
                    ['point', 'Point'],
                    ['spot', 'Spot'],
                    ['area', 'Area'],
                    ['directional', 'Dir'],
                  ] as const).map(([kind, label]) => (
                    <button
                      key={kind}
                      type="button"
                      className="text-button"
                      disabled={(project.sceneLights ?? []).length >= MAX_SCENE_LIGHTS}
                      title={`Add ${label} light`}
                      onClick={() => {
                        const focus = displaySelected?.position ?? { x: 0, y: 0, z: 0 };
                        const next = createSceneLight({ kind, target: { ...focus } });
                        updateProject({
                          sceneLights: [...(project.sceneLights ?? []), next].slice(0, MAX_SCENE_LIGHTS),
                        });
                        notify(`Added ${next.label} light`);
                      }}
                    >
                      <Plus size={13} /> {label}
                    </button>
                  ))}
                </div>
                {(project.sceneLights ?? []).map((light) => {
                  const patchLight = (patch: Partial<SceneLight>) => {
                    updateProject({
                      sceneLights: (project.sceneLights ?? []).map((item) => (
                        item.id === light.id ? { ...item, ...patch } : item
                      )),
                    });
                  };
                  return (
                    <div key={light.id} className="env-group" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                      <div className="env-group-head">
                        <div className="field-caption">{light.label}</div>
                        <div className="env-reset-row">
                          <SwitchControl
                            checked={light.enabled}
                            label={`Toggle ${light.label}`}
                            onChange={(enabled) => patchLight({ enabled })}
                          />
                          <button
                            type="button"
                            className="env-reset"
                            title={`Remove ${light.label}`}
                            onClick={() => updateProject({
                              sceneLights: (project.sceneLights ?? []).filter((item) => item.id !== light.id),
                            })}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      {light.enabled && (
                        <div className="env-sliders">
                          <SliderField
                            label="Intensity"
                            min={0}
                            max={light.kind === 'directional' ? 8 : 12}
                            step={0.1}
                            unit="×"
                            value={light.intensity}
                            onChange={(intensity) => patchLight({ intensity })}
                          />
                          <label className="env-color-row">
                            <span>Color</span>
                            <input
                              type="color"
                              value={light.color}
                              onChange={(e) => patchLight({ color: e.target.value })}
                              aria-label={`${light.label} color`}
                            />
                          </label>
                          {(light.kind === 'point' || light.kind === 'spot') && (
                            <SliderField
                              label="Distance"
                              min={0}
                              max={30}
                              step={0.5}
                              value={light.distance}
                              onChange={(distance) => patchLight({ distance })}
                            />
                          )}
                          {light.kind === 'spot' && (
                            <>
                              <SliderField
                                label="Angle"
                                min={5}
                                max={80}
                                step={1}
                                unit="°"
                                value={(light.angle * 180) / Math.PI}
                                onChange={(deg) => patchLight({ angle: (deg * Math.PI) / 180 })}
                              />
                              <SliderField
                                label="Penumbra"
                                min={0}
                                max={1}
                                step={0.05}
                                value={light.penumbra}
                                onChange={(penumbra) => patchLight({ penumbra })}
                              />
                            </>
                          )}
                          {light.kind === 'area' && (
                            <>
                              <SliderField
                                label="Width"
                                min={0.2}
                                max={8}
                                step={0.1}
                                value={light.width}
                                onChange={(width) => patchLight({ width })}
                              />
                              <SliderField
                                label="Height"
                                min={0.2}
                                max={8}
                                step={0.1}
                                value={light.height}
                                onChange={(height) => patchLight({ height })}
                              />
                            </>
                          )}
                          {(light.kind === 'directional' || light.kind === 'spot' || light.kind === 'point') && (
                            <div className="option-toggle-row">
                              <span>Shadow</span>
                              <SwitchControl
                                checked={light.castShadow}
                                label={`${light.label} cast shadow`}
                                onChange={(castShadow) => patchLight({ castShadow })}
                              />
                            </div>
                          )}
                          <div className="option-toggle-row">
                            <span>Move in scene</span>
                            <SwitchControl
                              checked={layerSelection.kind === 'scene-light' && layerSelection.id === light.id}
                              label={`Show ${light.label} move gimbal`}
                              onChange={(on) => {
                                if (on) focusSceneLight(light.id);
                                else if (layerSelection.kind === 'scene-light' && layerSelection.id === light.id) {
                                  setLayerSelection({ kind: 'key-light' });
                                }
                              }}
                            />
                          </div>
                          <LightDirectionControl
                            position={light.position}
                            color={light.color}
                            focus={light.target}
                            deviceYawDeg={displaySelected?.rotation.y ?? 0}
                            onChange={(position) => patchLight({ position })}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </SettingsSection>

            <SettingsSection id="rim" title="Ambient" hint="Soft wrap that fills the dark side" icon={Sun} open={openSectionId === 'rim'} onToggle={toggleSection}>
              <div className="env-group">
                <div className="env-group-head">
                  <div className="field-caption">Wrap</div>
                  <div className="env-reset-row">
                    <button
                      type="button"
                      className="env-reset"
                      title="Turn ambient off"
                      onClick={() => updateProject({ fillIntensity: 0 })}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      className="env-reset"
                      title="Reset ambient"
                      onClick={() => updateProject({ fillIntensity: DEFAULT_PROJECT.fillIntensity })}
                    >
                      <RotateCcw size={12} />
                      Reset
                    </button>
                  </div>
                </div>
                <div className="env-sliders">
                  <SliderField
                    label="Intensity"
                    min={0}
                    max={2.5}
                    step={0.05}
                    unit="×"
                    value={project.fillIntensity ?? DEFAULT_PROJECT.fillIntensity}
                    onChange={(v) => updateProject({ fillIntensity: v })}
                  />
                  <p className="field-caption" style={{ marginTop: 2 }}>
                    Spline-style soft ambient. Raise for flatter wrap, lower for more contrast.
                  </p>
                </div>
              </div>
            </SettingsSection>

            <SettingsSection id="shadow" title="Shadow" hint="Progressive soft shadows and floor grounding" icon={Layers3} open={openSectionId === 'shadow'} onToggle={toggleSection}>
              <div className="env-group">
                <div className="env-group-head">
                  <div className="field-caption">Shadows</div>
                  <button
                    type="button"
                    className="env-reset"
                    title="Reset shadow"
                    onClick={() => updateProject({
                      shadowType: DEFAULT_PROJECT.shadowType,
                      shadowSoftness: DEFAULT_PROJECT.shadowSoftness,
                      shadowOpacity: DEFAULT_PROJECT.shadowOpacity,
                      shadowContact: DEFAULT_PROJECT.shadowContact,
                      shadowQuality: DEFAULT_PROJECT.shadowQuality,
                      showGroundBase: DEFAULT_PROJECT.showGroundBase,
                    })}
                  >
                    <RotateCcw size={12} />
                    Reset
                  </button>
                </div>
                <div className="option-toggle-row">
                  <span>Shadows</span>
                  <SwitchControl
                    checked={(project.shadowType ?? DEFAULT_PROJECT.shadowType) !== 'off'}
                    label="Toggle floor shadows"
                    onChange={(on) => updateProject({ shadowType: on ? 'soft' : 'off' })}
                  />
                </div>
                {(project.shadowType ?? DEFAULT_PROJECT.shadowType) !== 'off' && (
                  <div className="env-sliders" style={{ marginTop: 12 }}>
                    <SliderField
                      label="Softness"
                      min={0.2}
                      max={8}
                      step={0.1}
                      unit=""
                      value={project.shadowSoftness ?? DEFAULT_PROJECT.shadowSoftness}
                      onChange={(v) => updateProject({ shadowSoftness: v })}
                    />
                    <p className="field-caption" style={{ marginTop: -4 }}>
                      Apparent key-light size — higher softens the penumbra.
                    </p>
                    <SliderField
                      label="Intensity"
                      min={0}
                      max={2}
                      step={0.01}
                      unit=""
                      value={project.shadowOpacity ?? DEFAULT_PROJECT.shadowOpacity}
                      onChange={(v) => updateProject({ shadowOpacity: v })}
                    />
                    <p className="field-caption" style={{ marginTop: -4 }}>
                      Progressive floor shadow — 1 is the soft default, above 1 crushes the core darker, low fades to a whisper.
                    </p>
                    <SliderField
                      label="Contact"
                      min={0}
                      max={1}
                      step={0.01}
                      unit=""
                      value={project.shadowContact ?? DEFAULT_PROJECT.shadowContact}
                      onChange={(v) => updateProject({ shadowContact: v })}
                    />
                    <p className="field-caption" style={{ marginTop: -4 }}>
                      Subtle darkening where the mesh meets the floor.
                    </p>
                    <div className="field-caption" style={{ marginTop: 10 }}>Quality</div>
                    <div className="camera-preset-grid">
                      {SHADOW_QUALITIES.map((quality) => (
                        <button
                          key={quality.id}
                          type="button"
                          title={quality.hint}
                          onClick={() => updateProject({ shadowQuality: quality.id })}
                          className={(project.shadowQuality ?? DEFAULT_PROJECT.shadowQuality) === quality.id ? 'selected' : ''}
                        >
                          {quality.label}
                        </button>
                      ))}
                    </div>
                    <p className="field-caption" style={{ marginTop: 8 }}>
                      {SHADOW_QUALITIES.find((quality) => quality.id === (project.shadowQuality ?? DEFAULT_PROJECT.shadowQuality))?.hint
                        ?? 'Balanced for smooth interaction'}
                    </p>
                    <p className="field-caption" style={{ marginTop: 8 }}>
                      Direction follows the key light — open Light and enable Move in scene, then drag the axes.
                    </p>
                    <div className="option-toggle-row" style={{ marginTop: 8 }}>
                      <span>Move key light</span>
                      <SwitchControl
                        checked={lightGizmoActive}
                        label="Show light move gimbal"
                        onChange={(on) => {
                          setLightGizmoActive(on);
                          if (on) setLayerSelection({ kind: 'key-light' });
                        }}
                      />
                    </div>
                  </div>
                )}
                <div className="option-toggle-row" style={{ marginTop: 12 }}>
                  <span>Floor plate</span>
                  <SwitchControl
                    checked={project.showGroundBase !== false}
                    label="Show floor plate"
                    title="Soft disc under the device. Turn off for a floating product shot."
                    onChange={(on) => updateProject({ showGroundBase: on })}
                  />
                </div>
              </div>
            </SettingsSection>

            <SettingsSection id="look" title="Look & motion" hint="Style, effects and animation" icon={Sparkles} open={openSectionId === 'look'} onToggle={toggleSection}>
              <div className="scene-look-block is-inspector">
                {selectedSceneProp && (
                  <div className="scene-look-group">
                    <div className="field-caption scene-look-sub">
                      {selectedSceneProp.kind === 'studio_backdrop' ? 'Cyclorama colour' : 'Prop colour'}
                    </div>
                    <label className="gradient-color-field">
                      <span className="gradient-color-label">
                        {selectedSceneProp.kind === 'studio_backdrop' ? 'Backdrop' : 'Colour'}
                      </span>
                      <span className="gradient-color-input">
                        <input
                          type="color"
                          value={selectedSceneProp.color && /^#[0-9a-fA-F]{6}$/.test(selectedSceneProp.color)
                            ? selectedSceneProp.color
                            : '#d8d2c8'}
                          aria-label={selectedSceneProp.kind === 'studio_backdrop' ? 'Backdrop colour' : 'Prop colour'}
                          onChange={(e) => patchSceneProp(selectedSceneProp.id, { color: e.target.value })}
                        />
                        <input
                          type="text"
                          defaultValue={selectedSceneProp.color ?? '#d8d2c8'}
                          key={`prop-color-${selectedSceneProp.id}-${selectedSceneProp.color ?? ''}`}
                          maxLength={7}
                          aria-label={selectedSceneProp.kind === 'studio_backdrop' ? 'Backdrop hex' : 'Prop colour hex'}
                          onBlur={(e) => {
                            const next = e.target.value.trim();
                            if (/^#[0-9a-fA-F]{6}$/.test(next)) {
                              patchSceneProp(selectedSceneProp.id, { color: next.toLowerCase() });
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                        />
                      </span>
                    </label>
                    {selectedSceneProp.kind !== 'studio_backdrop' && (
                      <>
                        <div className="field-caption scene-look-sub" style={{ marginTop: 10 }}>
                          Shape transform
                        </div>
                        <p className="field-caption" style={{ marginTop: 2 }}>
                          Drag to spin · Shift-drag to move · rings and arrows for precise edits
                        </p>
                        <SliderField
                          label="Rotate X"
                          min={-180}
                          max={180}
                          value={selectedSceneProp.rotation.x}
                          onChange={(v) => patchSceneProp(selectedSceneProp.id, {
                            rotation: { ...selectedSceneProp.rotation, x: v },
                          })}
                        />
                        <SliderField
                          label="Rotate Y"
                          min={-180}
                          max={180}
                          value={selectedSceneProp.rotation.y}
                          onChange={(v) => patchSceneProp(selectedSceneProp.id, {
                            rotation: { ...selectedSceneProp.rotation, y: v },
                          })}
                        />
                        <SliderField
                          label="Rotate Z"
                          min={-180}
                          max={180}
                          value={selectedSceneProp.rotation.z}
                          onChange={(v) => patchSceneProp(selectedSceneProp.id, {
                            rotation: { ...selectedSceneProp.rotation, z: v },
                          })}
                        />
                        <SliderField
                          label="Scale"
                          min={0.15}
                          max={4}
                          step={0.05}
                          unit="×"
                          value={propFootprintScale(selectedSceneProp.scale)}
                          onChange={(v) => patchSceneProp(selectedSceneProp.id, {
                            scale: withPropFootprintScale(selectedSceneProp.scale, v),
                          })}
                        />
                        <SliderField
                          label="Extrude"
                          min={0.15}
                          max={4}
                          step={0.05}
                          unit="×"
                          value={propExtrusion(selectedSceneProp.scale)}
                          onChange={(v) => patchSceneProp(selectedSceneProp.id, {
                            scale: withPropExtrusion(selectedSceneProp.scale, v),
                          })}
                        />
                      </>
                    )}
                  </div>
                )}
                {!isTransparent && studioSetFocus && (
                  <div className="scene-look-group">
                    <div className="field-caption scene-look-sub" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span>
                        {studioSetFocus === 'sky'
                          ? 'Surround colour'
                          : studioSetFocus === 'floor'
                            ? 'Floor colour'
                            : 'Backdrop colour'}
                      </span>
                      {(layerSelection.kind === 'backdrop' || selectedSceneProp?.kind === 'studio_backdrop') && (
                        <button
                          type="button"
                          className="text-button"
                          title="Remove backdrop"
                          onClick={removeBackdrop}
                        >
                          <Trash2 size={12} /> Remove
                        </button>
                      )}
                    </div>
                    <div className="gradient-color-grid is-separate-stops">
                      {([
                        ['center', 'Backdrop'],
                        ['mid', 'Sky'],
                        ['edge', 'Floor'],
                      ] as const).map(([key, label]) => {
                        const stopFocus = key === 'center' ? 'backdrop' : key === 'mid' ? 'sky' : 'floor';
                        return (
                        <label
                          key={key}
                          className={`gradient-color-field${studioSetFocus === stopFocus ? ' is-highlighted' : ''}`}
                          onPointerDown={() => setStudioSetFocus(stopFocus)}
                        >
                          <span className="gradient-color-label">
                            {key === 'mid' ? 'Sky · surround' : label}
                          </span>
                          <span className="gradient-color-input">
                            <input type="color" value={project.gradientColors[key]} aria-label={`${label} colour`}
                              onFocus={() => setStudioSetFocus(stopFocus)}
                              onChange={(e) => updateGradient(key, e.target.value)} />
                            <input
                              type="text"
                              defaultValue={project.gradientColors[key]}
                              key={`${key}-${project.gradientColors[key]}`}
                              maxLength={7}
                              aria-label={`${label} hex`}
                              onFocus={() => setStudioSetFocus(stopFocus)}
                              onBlur={(e) => updateGradient(key, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.currentTarget.blur();
                                }
                              }}
                            />
                          </span>
                        </label>
                        );
                      })}
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
                      ['turntable', 'Turntable', RotateCw],
                      ['spin', 'Spin 360', RefreshCw],
                      ['float', 'Float', ArrowUpDown],
                      ['tilt', 'Tilt', FlipHorizontal2],
                      ['orbit', 'Orbit', Orbit],
                      ['zoom', 'Zoom in', ZoomIn],
                      ['present', 'Present', Presentation],
                      ['wobble', 'Wobble', Waves],
                      ['fan', 'Fan', Layers3],
                      ['swing', 'Swing', ArrowLeftRight],
                    ] as const).map(([id, label, Icon]) => (
                      <button
                        key={id}
                        type="button"
                        className="motion-preset-chip"
                        title={label}
                        aria-label={`Apply ${label} motion`}
                        onClick={() => applyMotionPreset(id)}
                      >
                        <Icon size={16} strokeWidth={1.8} aria-hidden />
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

          </div>
          <div className="inspector-footer inspector-export-panel">
            <div className="figma-export-head">
              <span className="figma-export-title"><Download size={15} strokeWidth={1.8} /> Export</span>
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
              <Download size={15} strokeWidth={2} />
              {exporting ? exportActionLabel : 'Export composition'}
            </button>
          </div>
        </aside>

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
          cameraPose={liveCameraPose}
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
      <input ref={projectInputRef} type="file" accept=".mockup,.mockup.json,.json,application/json,application/x-mockup-studio" hidden onChange={(e) => { void onProjectFile(e); }} />

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
              const groupSelected = items.filter((item) => exportAspectIds.includes(item.id)).length
                + (group.id === 'other' ? savedSizes.filter((item) => exportAspectIds.includes(item.id)).length : 0);
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
                    {group.id === 'other' && savedSizes.map((item) => {
                      const selected = exportAspectIds.includes(item.id);
                      return (
                        <div key={item.id} className="export-aspect-wrap">
                          <button
                            type="button"
                            className={`export-aspect ${selected ? 'selected' : ''}`}
                            disabled={exporting}
                            title={`${item.width} × ${item.height}`}
                            onClick={() => toggleExportAspect(item.id)}
                          >
                            <div className="export-ratio" style={exportRatioThumbStyle(item.width / Math.max(1, item.height))} />
                            <strong>{item.label}</strong>
                            <span>{item.width}×{item.height}</span>
                            {selected && <span className="export-aspect-check" aria-hidden><Check size={11} strokeWidth={3} /></span>}
                          </button>
                          <button
                            type="button"
                            className="export-aspect-remove"
                            title={`Remove ${item.label}`}
                            aria-label={`Remove ${item.label}`}
                            disabled={exporting}
                            onClick={() => onDeleteSize(item.id)}
                          >
                            <X size={11} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className="modal-field-label">RESOLUTION <span>{resolveExportSize().label} px</span></div>
            <div className="export-resolution-row" role="group" aria-label="Output resolution">
              {availableResolutions.map((item) => {
                const preview = savedSizes.some((size) => size.id === primaryExportAspect) && item.id !== 'custom'
                  ? resolveExportSize(primaryExportAspect)
                  : resolveExportDimensions(
                    (EXPORT_ASPECTS.some((aspect) => aspect.id === primaryExportAspect) ? primaryExportAspect : 'custom') as ExportAspectId,
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
            {(exportAspectIds.includes('custom') || exportResolution === 'custom' || savedSizes.some((item) => exportAspectIds.includes(item.id))) && (
              <form
                className="preset-save-row export-size-save"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSaveAssetSize(customExportSize.width, customExportSize.height);
                }}
              >
                <input
                  className="preset-name-input"
                  value={sizeName}
                  maxLength={40}
                  placeholder="Name this size"
                  aria-label="Name this size"
                  disabled={exporting}
                  onChange={(event) => setSizeName(event.target.value)}
                />
                <button type="submit" className="button" disabled={exporting}>Save size</button>
              </form>
            )}

            <div className="modal-field-label">
              CANVAS CROP
              <span>{previewFrame === 'free' ? 'Off' : 'On'}</span>
            </div>
            <div className="export-free-row" role="group" aria-label="Canvas crop overlay">
              <button
                type="button"
                className={`export-free-option ${previewFrame === 'free' ? 'selected' : ''}`}
                disabled={exporting}
                title="Hide the crop overlay on the canvas"
                onClick={() => applyPlatformFrame('free')}
              >
                <div className="aspect-sidebar-ratio aspect-sidebar-ratio-free" />
                <div>
                  <strong>Free</strong>
                  <span>No crop overlay — compose without a frame guide</span>
                </div>
                <span className="radio-dot">{previewFrame === 'free' && <span />}</span>
              </button>
              {previewFrame === 'free' && (
                <button
                  type="button"
                  className="button subtle-button export-free-restore"
                  disabled={exporting}
                  onClick={() => focusPlatformAspect(exportAspectIds[0] ?? 'custom')}
                >
                  Restore {EXPORT_ASPECTS.find((item) => item.id === (exportAspectIds[0] ?? 'custom'))?.shortLabel ?? 'crop'}
                </button>
              )}
            </div>

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
      {hasOpenProject && isDeveloperToolset && modelingPanelOpen && (
        <ModelingModePanel
          project={project}
          compositionName={compositionName}
          activeTemplateId={activeCompositionId}
          pickedMaterial={pickedMaterial}
          materialTweak={
            pickedMaterial
              ? (project.devices.find((d) => d.id === pickedMaterial.deviceInstanceId)?.materialTweaks?.[pickedMaterial.materialName]
                ?? (pickedMaterial.colorHex ? { color: pickedMaterial.colorHex } : null))
              : null
          }
          selectedProp={
            layerSelection.kind === 'prop'
              ? (project.sceneProps ?? []).find((p) => p.id === layerSelection.id) ?? null
              : null
          }
          backdropSelected={layerSelection.kind === 'backdrop'}
          studioSetFocus={studioSetFocus}
          onPickClear={() => setPickedMaterial(null)}
          onPatchMaterial={patchPickedMaterial}
          onClearMaterial={clearPickedMaterialOverrides}
          onApplyPreset={applyMaterialPresetToPicked}
          onSetMaterialMap={setPickedMaterialMap}
          onPatchProp={patchSceneProp}
          onUpdateGradient={updateGradient}
          onFocusStudioStop={setStudioSetFocus}
          onUpdateProject={(patch) => updateProject(patch)}
          onAddDevice={(deviceId) => {
            const ids = Array.isArray(deviceId) ? deviceId : [deviceId];
            let message = ids.length > 1 ? `Placed ${ids.length} scene sets` : 'Placed scene set';
            let placed = 0;
            setProject((current) => {
              if (current.compositionMode === 'split') {
                message = 'Switch off iOS + Android to place a scene set';
                return current;
              }
              let devices = [...current.devices];
              let last = getSelectedDevice(current);
              for (const id of ids) {
                if (devices.length >= MAX_DEVICES) {
                  message = placed
                    ? `Placed ${placed} · scene is full (${MAX_DEVICES} max)`
                    : `You can place up to ${MAX_DEVICES} devices`;
                  break;
                }
                placed += 1;
                const instance = createDeviceInstance({
                  deviceId: id,
                  rotation: { ...STUDIO_START_ROTATION },
                  position: {
                    x: (placed - 1) * 1.15,
                    y: 0,
                    z: -0.4,
                  },
                  scale: 1.25,
                  screenshot: null,
                });
                devices = [...devices, instance];
                last = instance;
              }
              if (!placed) return current;
              if (placed > 1 && !message.includes('full')) {
                message = `Placed ${placed} scene sets`;
              } else if (placed === 1 && !message.includes('full') && !message.includes('Switch')) {
                message = 'Placed scene set';
              }
              return syncProjectFromSelected({ ...current, devices }, last);
            });
            setDevicesTick((n) => n + 1);
            notify(message);
          }}
          onOpenLightSection={() => setOpenSectionId('light')}
          onNotify={notify}
          onBumpDevices={() => {
            setCustomDevices(loadCustomDeviceMeta());
            setDevicesTick((n) => n + 1);
          }}
          onPromoted={(template) => {
            setTemplatesTick((n) => n + 1);
            setTemplateCategory(template.category === 'scenes' ? 'scenes' : 'devices');
            startFromTemplate(template);
          }}
          onClose={() => {
            setModelingPanelOpen(false);
            setPickedMaterial(null);
          }}
        />
      )}
      {helpOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setHelpOpen(false); }}>
          <div className="export-modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
            <div className="modal-head"><div className="modal-icon"><Settings2 size={21} /></div>
              <button className="modal-close" aria-label="Close settings" onClick={() => setHelpOpen(false)}><X size={19} /></button></div>
            <h2 id="help-title">Settings</h2>
            <p>Theme, shortcuts, and how the studio works.</p>
            <div className="help-appearance">
              <AccentThemePicker />
            </div>
            <div className="help-rows">
              <div><MousePointer2 size={17} /><span>Drag empty canvas to orbit the camera. Tap empty sky to set the surround colour in Look. Drag a device to spin it freely; Shift+drag slides it. Right-drag or Space+drag pans the view. Scroll zooms. Rings and arrows still work for precise moves.</span></div>
              <div><ImagePlus size={17} /><span>Drop a screenshot onto the preview, or drop an FBX, DAE, OBJ, glTF, Blend, or C4D file to extract it as a device. Blend uses your local Blender install.</span></div>
              <div><MonitorSmartphone size={17} /><span>Plug in an iPhone or Android over USB and use Phone Mirror — it auto-detects the device. Snapshot freezes the live screen onto the mockup.</span></div>
              <div><SlidersHorizontal size={17} /><span>Rings rotate on one axis; coloured arrows slide on X / Y / Z. Drag the device body to tumble freely, Shift+drag to reposition. Add more devices from Device → Add device, then Save as template (⇧⌘S) under Templates → Yours.</span></div>
              <div><Gauge size={17} /><span>Space play/pause · long-press & drag to multi-select keys · set Ease on selection · Delete removes selected.</span></div>
              <div><Command size={17} /><span>⌘N Blank file · ⌘S Save · File menu → Save as / Duplicate / Export as · ⇧⌘S Save as template · ⌘Z Undo · ⌘D Add device · ⌘O Open · ⌘E Export · ⌘T New from template · ⌘W Close tab · . hide panels.</span></div>
            </div>
            <div className="help-modal-actions">
              <button
                type="button"
                className="button subtle-button"
                onClick={() => {
                  setHelpOpen(false);
                  setFeedbackOpen(true);
                }}
              >
                Send feedback
              </button>
              <button type="button" className="button primary-button" onClick={() => setHelpOpen(false)}>
                Start creating
              </button>
            </div>
          </div>
        </div>
      )}
      {meshOffer && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !meshExtracting) setMeshOffer(null);
          }}
        >
          <div className="mesh-extract" role="dialog" aria-modal="true" aria-labelledby="mesh-extract-title">
            <h2 id="mesh-extract-title">
              {meshOffer.error
                ? 'Can’t extract this drop'
                : meshOffer.meshCount > 1
                  ? `Extract ${meshOffer.meshCount} models?`
                  : 'Extract this model?'}
            </h2>
            <p>
              {meshOffer.error
                ? meshOffer.error
                : `${meshOffer.format} · ${meshOffer.meshName}. ${
                  meshOffer.textureCount > 0
                    ? `${meshOffer.textureCount} texture ${meshOffer.textureCount === 1 ? 'file' : 'files'} will be packed in.`
                    : meshOffer.meshCount > 1
                      ? 'Each model is added to the library; extras are placed beside the selected device.'
                      : 'Textures already inside the file stay with the model.'
                }`}
            </p>
            <div className="mesh-extract-actions">
              <button
                type="button"
                className="button subtle-button"
                disabled={meshExtracting}
                onClick={() => setMeshOffer(null)}
              >
                {meshOffer.error ? 'OK' : 'Cancel'}
              </button>
              {!meshOffer.error && (
                <button
                  type="button"
                  className="button primary-button"
                  disabled={meshExtracting}
                  onClick={() => { void confirmMeshExtract(); }}
                >
                  {meshExtracting ? 'Extracting…' : 'Extract'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onNotify={notify}
        appVersion="0.1.0"
      />
      <TemplateThumbHost />
      {templatePickerOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setTemplatePickerOpen(false); }}>
          <div
            className={`export-modal template-modal${isDeveloperToolset ? ' is-dev-toolset' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-title"
          >
            <div className="modal-head">
              <div className="modal-icon"><LayoutTemplate size={21} /></div>
              <button className="modal-close" aria-label="Close templates" onClick={() => setTemplatePickerOpen(false)}><X size={19} /></button>
            </div>
            <h2 id="template-title">
              {isDeveloperToolset ? 'Edit shipped templates' : 'Start a new project'}
            </h2>
            <p>
              {isDeveloperToolset
                ? 'Dev mode — open any Devices or Scenes layout, tweak it, then Ship / Update so User mode gets the same templates.'
                : 'Each template is a studio angle with its motion already on the timeline. Looping shots start playing. Opens in a new tab.'}
            </p>
            {toolsetSwitchAvailable && (
              <div
                className="workspace-toolset-switch template-toolset-switch"
                role="group"
                aria-label="Template library mode"
              >
                <button
                  type="button"
                  className={isDeveloperToolset ? 'is-active' : ''}
                  aria-pressed={isDeveloperToolset}
                  title="Show all templates as Dev-editable"
                  onClick={() => setToolset('developer')}
                >
                  <Wrench size={13} strokeWidth={1.9} />
                  Dev templates
                </button>
                <button
                  type="button"
                  className={!isDeveloperToolset ? 'is-active' : ''}
                  aria-pressed={!isDeveloperToolset}
                  title="Show templates as users see them"
                  onClick={() => setToolset('user')}
                >
                  <UserRound size={13} strokeWidth={1.9} />
                  User templates
                </button>
              </div>
            )}
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
              <button
                type="button"
                role="tab"
                aria-selected={templateCategory === 'saved'}
                className={templateCategory === 'saved' ? 'active' : ''}
                onClick={() => setTemplateCategory('saved')}
              >
                <Save size={14} /> Yours
              </button>
            </div>
            <div className="modal-field-label">
              {templateCategory === 'devices'
                ? (isDeveloperToolset ? 'DEV · DEVICE LAYOUTS' : 'DEVICE LAYOUTS')
                : templateCategory === 'scenes'
                  ? (isDeveloperToolset ? 'DEV · SCENE COMPOSITIONS' : 'SCENE COMPOSITIONS')
                  : 'YOUR TEMPLATES'}
              <span>{templateCategory === 'saved' ? savedCompositions.length : `${workspace.tabs.length}/${MAX_PROJECT_TABS} tabs`}</span>
            </div>
            {templateCategory === 'saved' && (
              <>
                <form
                  className="preset-save-row template-save-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onSaveComposition();
                  }}
                >
                  <input
                    className="preset-name-input"
                    value={compositionName}
                    maxLength={40}
                    placeholder={project.name || 'Name this template'}
                    aria-label="Template name"
                    onChange={(event) => setCompositionName(event.target.value)}
                  />
                  <button type="submit" className="button primary-button">
                    <Save size={13} /> Save as template
                  </button>
                </form>
                {isDeveloperToolset && (
                  <div className="preset-save-row template-save-row">
                    <button
                      type="button"
                      className="button"
                      title="Copy TypeScript for COMPOSITION_TEMPLATES so this shot ships with the app"
                      onClick={() => void onCopyBuiltinComposition('devices')}
                    >
                      <Copy size={13} /> Copy as built-in
                    </button>
                    <button
                      type="button"
                      className="button"
                      title="Same, with category: scenes"
                      onClick={() => void onCopyBuiltinComposition('scenes')}
                    >
                      <Copy size={13} /> as scene
                    </button>
                  </div>
                )}
              </>
            )}
            {templateCategory === 'saved' && savedCompositions.length === 0 && (
              <p className="field-caption">
                Add devices with Device → Add device, arrange the shot, then save it as a template. Devices, angles, lighting, and motion come back with it.
              </p>
            )}
            {templateCategory !== 'saved' && (
              <div className="preset-save-row template-save-row" style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  className="button primary-button"
                  disabled={workspace.tabs.length >= MAX_PROJECT_TABS}
                  onClick={startBlankFile}
                >
                  <Plus size={13} /> Blank file
                </button>
                <span className="field-caption">Untitled studio — soft light, no template motion</span>
              </div>
            )}
            <div className="template-grid">
              {(templateCategory === 'saved' ? savedCompositions : templatesByCategory(templateCategory)).map((template) => {
                const editable = isDeveloperToolset && templateCategory !== 'saved';
                return (
                  <div key={template.id} className={`template-card-wrap${editable ? ' is-dev-editable' : ''}`}>
                    <button
                      type="button"
                      className="template-card"
                      title={editable ? `Edit “${template.label}” in Dev, then Ship / Update for User` : undefined}
                      onClick={() => startFromTemplate(template)}
                    >
                      <TemplateThumb template={template} />
                      <div className="template-card-body">
                        <strong>{template.label}</strong>
                        <span>
                          {editable
                            ? 'Open → tweak → Update shipped so User templates match'
                            : template.description}
                        </span>
                        <em>{editable ? 'Dev editable' : template.badge}</em>
                      </div>
                    </button>
                    <div className="template-card-actions">
                      <button
                        type="button"
                        className="template-card-action"
                        title={
                          templateCategory === 'saved'
                            ? `Duplicate “${template.label}”`
                            : `Duplicate “${template.label}” into Yours`
                        }
                        aria-label={`Duplicate ${template.label}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDuplicateLibraryTemplate(template);
                        }}
                      >
                        <Copy size={12} />
                      </button>
                      {templateCategory === 'saved' && (
                        <button
                          type="button"
                          className="template-card-action is-danger"
                          title={`Delete “${template.label}”`}
                          aria-label={`Delete ${template.label}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteComposition(template.id);
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="export-modal-actions">
              <button type="button" className="button subtle-button" onClick={() => setTemplatePickerOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {!LICENSING_DISABLED && (
        <LicenseModal
          open={licenseOpen}
          license={license}
          onClose={() => setLicenseOpen(false)}
          onChange={setLicense}
          onNotify={notify}
        />
      )}
      <FigmaExploreModal
        open={figmaExploreOpen}
        initialUrl={figmaLinkDraft}
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
