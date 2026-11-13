import { useRef, useState, type ChangeEvent } from 'react';
import {
  Box, Download, LayoutTemplate, Palette, Plus, RefreshCw, Sparkles, Sun, Trash2, Upload, X,
} from 'lucide-react';
import { importCustomDevices } from '../lib/customDevices';
import { MATERIAL_PRESETS, type MaterialPresetId } from '../lib/materialPresets';
import {
  getCompositionTemplate,
  isDevEditableTemplateId,
  type CompositionTemplate,
  type ShippedTemplateCategory,
} from '../lib/templates';
import {
  prepareShippedFromProject,
  shipCompositionTemplate,
  shippedCategoryOf,
} from '../lib/shippedTemplates';
import {
  MAX_SCENE_LIGHTS, createSceneLight, createSceneProp,
  type GradientColors, type MaterialTweak, type MockupProject, type SceneProp, type ScenePropKind,
} from '../types';
import {
  propExtrusion,
  propFootprintScale,
  withPropExtrusion,
  withPropFootprintScale,
} from '../lib/propTransform';

const QUICK_PROPS: { kind: ScenePropKind; label: string }[] = [
  { kind: 'stage', label: 'Stage' },
  { kind: 'rock', label: 'Rock' },
  { kind: 'pedestal', label: 'Pedestal' },
  { kind: 'studio_backdrop', label: 'Backdrop' },
  { kind: 'concrete_slab', label: 'Slab' },
  { kind: 'clay_cube', label: 'Cube' },
];

const STUDIO_SET_STOPS: { key: keyof GradientColors; label: string; hint: string }[] = [
  { key: 'center', label: 'Backdrop', hint: 'Cyclorama wall' },
  { key: 'mid', label: 'Sky', hint: 'Surround wash · tap empty sky' },
  { key: 'edge', label: 'Floor', hint: 'Ground sweep' },
];

export type PickedMaterial = {
  deviceInstanceId: string;
  materialName: string;
  /** Mesh / node under the pointer — used by Remove part. */
  meshName?: string;
  colorHex?: string;
};

export type StudioSetFocus = 'backdrop' | 'sky' | 'floor' | null;

interface ModelingModePanelProps {
  project: MockupProject;
  compositionName: string;
  /** Active Devices/Scenes template id for this tab, when editing a shipped layout. */
  activeTemplateId: string | null;
  /** Current free-orbit camera pose to bake into shipped templates. */
  cameraOrbit?: CompositionTemplate['cameraOrbit'] | null;
  pickedMaterial: PickedMaterial | null;
  materialTweak: MaterialTweak | null;
  selectedProp: SceneProp | null;
  /** Built-in cyclorama / Backdrop row selected in the scene. */
  backdropSelected?: boolean;
  /** Which studio-set stop should highlight in the colour list. */
  studioSetFocus?: StudioSetFocus;
  onPickClear: () => void;
  onPatchMaterial: (patch: MaterialTweak) => void;
  onClearMaterial: () => void;
  onApplyPreset: (presetId: MaterialPresetId) => void;
  onSetMaterialMap: (slot: 'mapDataUrl' | 'normalMapDataUrl', dataUrl: string | null) => void;
  /** Hide the picked mesh / node from the device (Apple logos, emboss marks, stray parts). */
  onRemovePickedMesh: () => void;
  /** Restore every mesh removed on the picked device in this session / project. */
  onRestoreHiddenMeshes: () => void;
  onPatchProp: (propId: string, patch: Partial<SceneProp>) => void;
  onUpdateGradient: (key: keyof GradientColors, hex: string) => void;
  onFocusStudioStop: (stop: StudioSetFocus) => void;
  onUpdateProject: (patch: Partial<MockupProject>) => void;
  onAddDevice: (deviceId: string | string[]) => void;
  onOpenLightSection: () => void;
  onNotify: (message: string) => void;
  onBumpDevices: () => void;
  /** After promote: open a fresh composition tab from the shipped template. */
  onPromoted: (template: CompositionTemplate) => void;
  onClose: () => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function num(tweak: MaterialTweak | null, key: string, fallback: number) {
  const value = tweak?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function hexColor(tweak: MaterialTweak | null, fallback = '#c8ccd2') {
  const value = tweak?.color;
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function propLabel(kind: ScenePropKind) {
  if (kind === 'studio_backdrop') return 'Backdrop';
  if (kind === 'stage') return 'Stage';
  return kind.replace(/_/g, ' ');
}

export default function ModelingModePanel({
  project,
  compositionName,
  activeTemplateId,
  cameraOrbit = null,
  pickedMaterial,
  materialTweak,
  selectedProp,
  backdropSelected = false,
  studioSetFocus = null,
  onPickClear,
  onPatchMaterial,
  onClearMaterial,
  onApplyPreset,
  onSetMaterialMap,
  onRemovePickedMesh,
  onRestoreHiddenMeshes,
  onPatchProp,
  onUpdateGradient,
  onFocusStudioStop,
  onUpdateProject,
  onAddDevice,
  onOpenLightSection,
  onNotify,
  onBumpDevices,
  onPromoted,
  onClose,
}: ModelingModePanelProps) {
  const sceneInputRef = useRef<HTMLInputElement>(null);
  const mapInputRef = useRef<HTMLInputElement>(null);
  const normalInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<ShippedTemplateCategory>('devices');

  const canUpdateExisting = isDevEditableTemplateId(activeTemplateId);
  const linkedTemplate = canUpdateExisting && activeTemplateId
    ? getCompositionTemplate(activeTemplateId)
    : null;
  const showStudioSet = project.background !== 'transparent';
  const stageSelected = selectedProp?.kind === 'stage';
  const backdropPropSelected = selectedProp?.kind === 'studio_backdrop';
  const activeStudioStop: StudioSetFocus = studioSetFocus
    ?? (backdropSelected || backdropPropSelected ? 'backdrop' : null);

  const addProp = (kind: ScenePropKind) => {
    const existing = project.sceneProps ?? [];
    const prop = createSceneProp({
      kind,
      position: { x: 0, y: -1.55, z: 0 },
      color: kind === 'stage' ? '#2a2724' : kind === 'studio_backdrop' ? '#ffffff' : undefined,
    });
    onUpdateProject({ sceneProps: [...existing, prop] });
    onNotify(`Added ${propLabel(kind)}`);
  };

  const importSceneSet = async (files: FileList | File[] | null) => {
    const list = files ? [...files] : [];
    if (!list.length) return;
    setBusy(true);
    try {
      const { imported, skipped } = await importCustomDevices({ files: list, asSceneSet: true });
      const captured = imported.flatMap((meta) => meta.sceneLights ?? []);
      if (captured.length) {
        const existing = project.sceneLights ?? [];
        onUpdateProject({
          sceneLights: [...existing, ...captured].slice(0, MAX_SCENE_LIGHTS),
        });
      }
      onBumpDevices();
      onAddDevice(imported.map((meta) => meta.id));
      const lightNote = captured.length
        ? ` with ${captured.length} light${captured.length === 1 ? '' : 's'}`
        : '';
      const skipNote = skipped ? ` · ${skipped} skipped (library full)` : '';
      onNotify(
        imported.length === 1
          ? `Imported scene set “${imported[0].label}”${lightNote}${skipNote}`
          : `Imported ${imported.length} scene sets${lightNote}${skipNote}`,
      );
      if (captured.length) onOpenLightSection();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not import scene set');
    } finally {
      setBusy(false);
      if (sceneInputRef.current) sceneInputRef.current.value = '';
    }
  };

  const promoteCurrent = async (mode: 'new' | 'update') => {
    setBusy(true);
    try {
      const existing = mode === 'update' ? linkedTemplate : null;
      const shipCategory = mode === 'update'
        ? shippedCategoryOf(existing, category)
        : category;
      const label = (mode === 'update' && existing?.label)
        || compositionName
        || project.name
        || 'Untitled composition';
      const next = prepareShippedFromProject(
        label,
        project,
        shipCategory,
        {
          ...(mode === 'update' && activeTemplateId ? { id: activeTemplateId } : {}),
          cameraOrbit,
          description: existing?.description,
          badge: existing?.badge,
          preview: existing?.preview,
        },
      );
      const result = await shipCompositionTemplate(next);
      onPromoted(result.template);
      if (!result.ok) {
        onNotify(result.reason
          ? `Saved “${result.template.label}” here · ${result.reason}`
          : `Saved “${result.template.label}” here · master file not saved`);
        return;
      }
      const where = result.downloaded
        ? ' · downloaded master JSON (drop into src/data/)'
        : ' · master catalog · User view sees it now';
      onNotify(
        mode === 'update'
          ? `Updated “${result.template.label}”${where}`
          : `Shipped “${result.template.label}”${where}`,
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Ship failed');
    } finally {
      setBusy(false);
    }
  };

  const addExtraLight = (kind: 'point' | 'spot' | 'area' | 'directional') => {
    const lights = project.sceneLights ?? [];
    if (lights.length >= MAX_SCENE_LIGHTS) {
      onNotify(`Max ${MAX_SCENE_LIGHTS} extra lights`);
      return;
    }
    const focus = project.devices[0]?.position ?? { x: 0, y: 0, z: 0 };
    const light = createSceneLight({ kind, target: { ...focus } });
    onUpdateProject({ sceneLights: [...lights, light] });
    onOpenLightSection();
    onNotify(`Added ${light.label} light`);
  };

  const onTextureFile = async (
    event: ChangeEvent<HTMLInputElement>,
    slot: 'mapDataUrl' | 'normalMapDataUrl',
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (!dataUrl.startsWith('data:image')) {
        onNotify('Pick an image texture (PNG / JPG / WebP)');
        return;
      }
      onSetMaterialMap(slot, dataUrl);
      onNotify(slot === 'mapDataUrl' ? 'Albedo texture applied' : 'Normal map applied');
    } catch {
      onNotify('Could not read texture');
    }
  };

  const color = hexColor(materialTweak, pickedMaterial?.colorHex ?? '#c8ccd2');
  const pickedDevice = pickedMaterial
    ? project.devices.find((device) => device.id === pickedMaterial.deviceInstanceId) ?? null
    : null;
  const removedParts = pickedDevice?.hiddenMeshes ?? [];
  const canRemovePickedMesh = Boolean(
    pickedMaterial?.meshName
    && !removedParts.includes(pickedMaterial.meshName),
  );
  const propColor = selectedProp?.color && /^#[0-9a-fA-F]{6}$/.test(selectedProp.color)
    ? selectedProp.color
    : selectedProp?.kind === 'stage'
      ? '#2a2724'
      : selectedProp?.kind === 'studio_backdrop'
        ? project.gradientColors.center
        : '#d8d2c8';

  return (
    <aside className="modeling-mode-panel" aria-label="Developer modeling toolset">
      <header className="modeling-mode-head">
        <div>
          <strong>Developer toolset</strong>
          <span>Tweak & ship layouts · stay in Dev while this is closed</span>
        </div>
        <button type="button" className="modal-close" aria-label="Hide developer panel" title="Hide panel (stay in Dev)" onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      <section className="modeling-mode-section modeling-mode-material">
        <h4><Palette size={14} /> Material</h4>
        <p>Tap a surface to edit it — or Remove part for logos and stray meshes.</p>

        {pickedMaterial ? (
          <>
            <div className="modeling-mode-material-name">
              <strong>{pickedMaterial.materialName}</strong>
              <button type="button" className="text-button" onClick={onPickClear}>Deselect</button>
            </div>
            {pickedMaterial.meshName && pickedMaterial.meshName !== pickedMaterial.materialName && (
              <p className="modeling-mode-hint" style={{ marginTop: -4 }}>
                Part <code>{pickedMaterial.meshName}</code>
              </p>
            )}

            <div className="modeling-mode-chip-row" style={{ marginBottom: 8 }}>
              <button
                type="button"
                className="text-button"
                disabled={!canRemovePickedMesh}
                title={canRemovePickedMesh
                  ? `Remove “${pickedMaterial.meshName}” from this device`
                  : 'Tap a mesh part to remove it'}
                onClick={onRemovePickedMesh}
              >
                <Trash2 size={12} /> Remove part
              </button>
              {removedParts.length > 0 && (
                <button
                  type="button"
                  className="text-button"
                  title="Bring back every part removed on this device"
                  onClick={onRestoreHiddenMeshes}
                >
                  Restore {removedParts.length} removed
                </button>
              )}
            </div>
            {removedParts.length > 0 && (
              <p className="modeling-mode-hint">
                Removed: {removedParts.slice(0, 4).map((name) => name).join(', ')}
                {removedParts.length > 4 ? ` +${removedParts.length - 4}` : ''}
              </p>
            )}

            <label className="modeling-mode-color-field is-highlighted">
              <span>Colour</span>
              <span className="gradient-color-input">
                <input
                  type="color"
                  value={color}
                  aria-label="Material colour"
                  onChange={(e) => onPatchMaterial({ color: e.target.value })}
                />
                <input
                  type="text"
                  value={color}
                  maxLength={7}
                  aria-label="Material colour hex"
                  onChange={(e) => {
                    const next = e.target.value.trim();
                    if (/^#[0-9a-fA-F]{6}$/.test(next)) onPatchMaterial({ color: next });
                  }}
                />
              </span>
            </label>

            <label className="modeling-mode-slider">
              <span>Metalness <em>{num(materialTweak, 'metalness', 0).toFixed(2)}</em></span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={num(materialTweak, 'metalness', 0)}
                onChange={(e) => onPatchMaterial({ metalness: Number(e.target.value) })}
              />
            </label>
            <label className="modeling-mode-slider">
              <span>Roughness <em>{num(materialTweak, 'roughness', 0.45).toFixed(2)}</em></span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={num(materialTweak, 'roughness', 0.45)}
                onChange={(e) => onPatchMaterial({ roughness: Number(e.target.value) })}
              />
            </label>
            <label className="modeling-mode-slider">
              <span>Clearcoat <em>{num(materialTweak, 'clearcoat', 0).toFixed(2)}</em></span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={num(materialTweak, 'clearcoat', 0)}
                onChange={(e) => onPatchMaterial({ clearcoat: Number(e.target.value) })}
              />
            </label>
            <label className="modeling-mode-slider">
              <span>Transmission <em>{num(materialTweak, 'transmission', 0).toFixed(2)}</em></span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={num(materialTweak, 'transmission', 0)}
                onChange={(e) => onPatchMaterial({
                  transmission: Number(e.target.value),
                  transparent: Number(e.target.value) > 0.01,
                })}
              />
            </label>

            <div className="field-caption" style={{ marginTop: 8 }}>Finish presets</div>
            <div className="modeling-mode-chip-row">
              {MATERIAL_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="text-button"
                  title={preset.description}
                  onClick={() => onApplyPreset(preset.id)}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="field-caption" style={{ marginTop: 10 }}>Textures</div>
            <div className="modeling-mode-chip-row">
              <input
                ref={mapInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={(e) => void onTextureFile(e, 'mapDataUrl')}
              />
              <input
                ref={normalInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={(e) => void onTextureFile(e, 'normalMapDataUrl')}
              />
              <button type="button" className="text-button" onClick={() => mapInputRef.current?.click()}>
                <Upload size={12} /> Albedo
              </button>
              <button type="button" className="text-button" onClick={() => normalInputRef.current?.click()}>
                <Upload size={12} /> Normal
              </button>
              {typeof materialTweak?.mapDataUrl === 'string' && materialTweak.mapDataUrl && (
                <button type="button" className="text-button" onClick={() => onSetMaterialMap('mapDataUrl', null)}>
                  Clear albedo
                </button>
              )}
              {typeof materialTweak?.normalMapDataUrl === 'string' && materialTweak.normalMapDataUrl && (
                <button type="button" className="text-button" onClick={() => onSetMaterialMap('normalMapDataUrl', null)}>
                  Clear normal
                </button>
              )}
            </div>

            <button type="button" className="text-button" style={{ marginTop: 8 }} onClick={onClearMaterial}>
              Reset material overrides
            </button>
          </>
        ) : selectedProp && selectedProp.kind !== 'studio_backdrop' ? (
          <>
            <div className="modeling-mode-material-name">
              <strong>{propLabel(selectedProp.kind)}</strong>
            </div>
            <label className={`modeling-mode-color-field is-highlighted${stageSelected ? ' is-stage' : ''}`}>
              <span>{stageSelected ? 'Stage colour' : 'Prop colour'}</span>
              <span className="gradient-color-input">
                <input
                  type="color"
                  value={propColor}
                  aria-label={stageSelected ? 'Stage colour' : 'Prop colour'}
                  onChange={(e) => onPatchProp(selectedProp.id, { color: e.target.value })}
                />
                <input
                  type="text"
                  defaultValue={propColor}
                  key={`prop-color-${selectedProp.id}-${propColor}`}
                  maxLength={7}
                  aria-label={stageSelected ? 'Stage colour hex' : 'Prop colour hex'}
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (/^#[0-9a-fA-F]{6}$/.test(next)) onPatchProp(selectedProp.id, { color: next });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                />
              </span>
            </label>
            <p className="modeling-mode-hint">Drag to spin · Shift-drag to move · use Extrude to stretch height.</p>
            {(['x', 'y', 'z'] as const).map((axis) => (
              <label key={axis} className="modeling-mode-slider">
                <span>Rotate {axis.toUpperCase()} <em>{Math.round(selectedProp.rotation[axis])}°</em></span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={selectedProp.rotation[axis]}
                  onChange={(e) => onPatchProp(selectedProp.id, {
                    rotation: { ...selectedProp.rotation, [axis]: Number(e.target.value) },
                  })}
                />
              </label>
            ))}
            <label className="modeling-mode-slider">
              <span>Scale <em>{propFootprintScale(selectedProp.scale).toFixed(2)}×</em></span>
              <input
                type="range"
                min={0.15}
                max={4}
                step={0.05}
                value={propFootprintScale(selectedProp.scale)}
                onChange={(e) => onPatchProp(selectedProp.id, {
                  scale: withPropFootprintScale(selectedProp.scale, Number(e.target.value)),
                })}
              />
            </label>
            <label className="modeling-mode-slider">
              <span>Extrude <em>{propExtrusion(selectedProp.scale).toFixed(2)}×</em></span>
              <input
                type="range"
                min={0.15}
                max={4}
                step={0.05}
                value={propExtrusion(selectedProp.scale)}
                onChange={(e) => onPatchProp(selectedProp.id, {
                  scale: withPropExtrusion(selectedProp.scale, Number(e.target.value)),
                })}
              />
            </label>
          </>
        ) : (
          <p className="modeling-mode-hint">
            {activeStudioStop === 'sky'
              ? 'Surround sky selected — change the Sky colour below.'
              : activeStudioStop === 'floor'
                ? 'Floor selected — change the Floor colour below.'
                : backdropSelected || backdropPropSelected
                  ? 'Backdrop selected — edit Backdrop / Sky / Floor below.'
                  : 'Click any mesh material — or a quick prop — to edit it here. Tap empty background to set its colour.'}
          </p>
        )}
      </section>

      {showStudioSet && (
        <section className="modeling-mode-section modeling-mode-studio-set">
          <h4><Sparkles size={14} /> Studio set</h4>
          <p>
            {activeStudioStop === 'sky'
              ? 'Surround sky is active — edit the Sky colour below.'
              : activeStudioStop === 'floor'
                ? 'Floor is active — edit the Floor colour below.'
                : activeStudioStop === 'backdrop'
                  ? 'Backdrop is active — edit the Backdrop colour below.'
                  : 'Backdrop, sky, and floor are separate colours — tap empty background or a stop to highlight it.'}
          </p>
          <div className="modeling-mode-studio-stops">
            {STUDIO_SET_STOPS.map(({ key, label, hint }) => {
              const stopFocus = key === 'center' ? 'backdrop' : key === 'mid' ? 'sky' : 'floor';
              const highlighted = activeStudioStop === stopFocus
                || (activeStudioStop == null && backdropPropSelected && stopFocus === 'backdrop');
              return (
                <label
                  key={key}
                  className={`modeling-mode-color-field${highlighted ? ' is-highlighted' : ''}`}
                  onPointerDown={() => onFocusStudioStop(stopFocus)}
                >
                  <span>
                    {label}
                    <em className="modeling-mode-stop-hint">{hint}</em>
                  </span>
                  <span className="gradient-color-input">
                    <input
                      type="color"
                      value={project.gradientColors[key]}
                      aria-label={`${label} colour`}
                      onChange={(e) => onUpdateGradient(key, e.target.value)}
                      onFocus={() => onFocusStudioStop(stopFocus)}
                    />
                    <input
                      type="text"
                      defaultValue={project.gradientColors[key]}
                      key={`${key}-${project.gradientColors[key]}`}
                      maxLength={7}
                      aria-label={`${label} hex`}
                      onFocus={() => onFocusStudioStop(stopFocus)}
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (/^#[0-9a-fA-F]{6}$/.test(next)) onUpdateGradient(key, next);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                    />
                  </span>
                </label>
              );
            })}
          </div>
          {backdropPropSelected && selectedProp && (
            <label className="modeling-mode-color-field is-highlighted">
              <span>Backdrop prop tint</span>
              <span className="gradient-color-input">
                <input
                  type="color"
                  value={propColor}
                  aria-label="Backdrop prop colour"
                  onChange={(e) => onPatchProp(selectedProp.id, { color: e.target.value })}
                />
                <input
                  type="text"
                  defaultValue={propColor}
                  key={`backdrop-prop-${selectedProp.id}-${propColor}`}
                  maxLength={7}
                  aria-label="Backdrop prop hex"
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (/^#[0-9a-fA-F]{6}$/.test(next)) onPatchProp(selectedProp.id, { color: next });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                />
              </span>
            </label>
          )}
        </section>
      )}

      <section className="modeling-mode-section">
        <h4><Upload size={14} /> Scene set (Spline / Blender GLB)</h4>
        <p>Keeps authored materials, reflections, bump/normals, and pulls embedded lights into the Light panel. Select several GLBs at once to place them together.</p>
        <input
          ref={sceneInputRef}
          type="file"
          accept=".glb,.gltf,.fbx,.dae,.obj,.c4d,.blend,model/gltf-binary,model/gltf+json"
          multiple
          hidden
          onChange={(event) => void importSceneSet(event.target.files)}
        />
        <button
          type="button"
          className="button primary-button"
          disabled={busy}
          onClick={() => sceneInputRef.current?.click()}
        >
          <Upload size={14} /> Import scene GLB
        </button>
      </section>

      <section className="modeling-mode-section">
        <h4><Box size={14} /> Quick props</h4>
        <div className="modeling-mode-chip-row">
          {QUICK_PROPS.map((item) => (
            <button
              key={item.kind}
              type="button"
              className="text-button"
              onClick={() => addProp(item.kind)}
            >
              <Plus size={12} /> {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="modeling-mode-section">
        <h4><Sun size={14} /> Lights</h4>
        <p>Soft ambient wrap + gentle key stay on. Add extras, or open the full Light panel.</p>
        <div className="modeling-mode-chip-row">
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
              onClick={() => addExtraLight(kind)}
            >
              <Plus size={12} /> {label}
            </button>
          ))}
        </div>
        <button type="button" className="text-button" onClick={onOpenLightSection}>
          <Sparkles size={13} /> Open Light panel
        </button>
      </section>

      <section className="modeling-mode-section">
        <h4><LayoutTemplate size={14} /> Master catalog</h4>
        <p>
          Legacy pack ship — prefer <strong>Publish as Template</strong> in Inspect for
          versioned global templates. This still writes <code>shippedTemplates.json</code> in Dev
          and the master pack. Flip to <strong>User</strong> to verify.
        </p>
        {canUpdateExisting && (
          <p className="modeling-mode-active-id">
            Editing master <code>{activeTemplateId}</code>
            {linkedTemplate ? ` · ${linkedTemplate.category}` : ''}
          </p>
        )}
        <div className="modeling-mode-chip-row">
          <button
            type="button"
            className={category === 'devices' ? 'text-button is-active' : 'text-button'}
            onClick={() => setCategory('devices')}
          >
            Devices
          </button>
          <button
            type="button"
            className={category === 'scenes' ? 'text-button is-active' : 'text-button'}
            onClick={() => setCategory('scenes')}
          >
            Scenes
          </button>
          <button
            type="button"
            className={category === 'social' ? 'text-button is-active' : 'text-button'}
            onClick={() => setCategory('social')}
          >
            Social
          </button>
        </div>
        {canUpdateExisting && (
          <button
            type="button"
            className="button primary-button"
            disabled={busy || project.devices.length === 0}
            onClick={() => void promoteCurrent('update')}
          >
            <RefreshCw size={14} /> Update master template
          </button>
        )}
        <button
          type="button"
          className={canUpdateExisting ? 'button' : 'button primary-button'}
          disabled={busy || project.devices.length === 0}
          onClick={() => void promoteCurrent('new')}
        >
          <Download size={14} /> Ship as new template
        </button>
      </section>
    </aside>
  );
}
