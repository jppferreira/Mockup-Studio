import { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import iconDown from '../assets/scene-hierarchy/icon-down.svg';
import iconDownSelected from '../assets/scene-hierarchy/icon-down-selected.svg';
import iconCube from '../assets/scene-hierarchy/icon-cube.svg';
import iconCubeSelected from '../assets/scene-hierarchy/icon-cube-selected.svg';
import iconPhone from '../assets/scene-hierarchy/icon-phone.svg';
import iconImage from '../assets/scene-hierarchy/icon-image.svg';
import iconCamera from '../assets/scene-hierarchy/icon-camera.svg';
import iconSun from '../assets/scene-hierarchy/icon-sun.svg';
import iconLayers from '../assets/scene-hierarchy/icon-layers.svg';
import iconEye from '../assets/scene-hierarchy/icon-eye.svg';
function TreeChevron() {
  return (
    <svg className="scene-tree-glyph" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TreeCube() {
  return (
    <svg className="scene-tree-glyph" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M15.75 5.25V12.75L9 16.5L2.25 12.75V5.25L9 1.5L15.75 5.25ZM2.25 5.25L9 9M9 16.5V9M15.75 5.25L9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

import { getDevice } from '../lib/devices';
import { bindScrollMore, pinToContainerTop } from '../lib/scrollMore';
import { ensureCompositionLayers } from '../lib/layers';
import {
  BACKGROUNDS,
  gradientCss,
  type CompositionScene,
  type DeviceInstance,
  type MockupProject,
  type ScenePreset,
} from '../types';

export type SceneLayerSelection =
  | { kind: 'scene'; id: string }
  | { kind: 'device'; id: string }
  | { kind: 'screen'; deviceId: string }
  | { kind: 'backdrop'; deviceId: string }
  | { kind: 'prop'; id: string }
  | { kind: 'overlay'; id: string }
  | { kind: 'camera' }
  | { kind: 'reflection' }
  | { kind: 'key-light' }
  | { kind: 'rim-light' }
  | { kind: 'shadow' };

export function sameLayerSelection(a: SceneLayerSelection, b: SceneLayerSelection) {
  if (a.kind !== b.kind) return false;
  if ('id' in a && 'id' in b) return a.id === b.id;
  if ('deviceId' in a && 'deviceId' in b) return a.deviceId === b.deviceId;
  return true;
}

type SceneHierarchyProps = {
  project: MockupProject;
  scenes: CompositionScene[];
  activeSceneId: string;
  looks: ScenePreset[];
  onSwitchScene: (sceneId: string) => void;
  onRenameScene: (sceneId: string, name: string) => void;
  onRemoveScene: (sceneId: string) => void;
  onSelectDevice: (device: DeviceInstance) => void;
  onChooseLook: (look: ScenePreset) => void;
  onDeleteLook: (lookId: string) => void;
  onOpenSection: (sectionId: string) => void;
  onOpenAssets: () => void;
  onSelectOverlay: (overlayId: string) => void;
  onSelectProp: (propId: string) => void;
  onRemoveProp: (propId: string) => void;
  onFocusKeyLight: () => void;
  onSelectionChange: (selection: SceneLayerSelection) => void;
  layerPin?: { kind: 'device' | 'prop' | 'overlay'; id: string; token: number } | null;
};

function sceneRowLabel(scene: CompositionScene, count: number) {
  if (count === 1 && /^scene\s*\d*$/i.test(scene.name.trim())) return 'Scene';
  return scene.name;
}

function propLabel(kind: string) {
  return kind.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function lookThumbStyle(look: ScenePreset) {
  if (!look.gradient) return undefined;
  if (BACKGROUNDS.some((item) => item.id === look.id)) return undefined;
  return { background: gradientCss(look.gradient) };
}

export default function SceneHierarchy({
  project,
  scenes,
  activeSceneId,
  looks,
  onSwitchScene,
  onRenameScene,
  onRemoveScene,
  onSelectDevice,
  onChooseLook,
  onDeleteLook,
  onOpenSection,
  onOpenAssets,
  onSelectOverlay,
  onSelectProp,
  onRemoveProp,
  onFocusKeyLight,
  onSelectionChange,
  layerPin = null,
}: SceneHierarchyProps) {
  const selectedDeviceId = project.selectedDeviceId;
  const [openSceneIds, setOpenSceneIds] = useState<string[]>(() => [activeSceneId]);
  const [openDeviceIds, setOpenDeviceIds] = useState<string[]>(() => [selectedDeviceId]);
  const [selection, setSelection] = useState<SceneLayerSelection>({ kind: 'device', id: selectedDeviceId });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    return bindScrollMore(el);
  }, []);

  useEffect(() => {
    setOpenSceneIds((current) => (current.includes(activeSceneId) ? current : [...current, activeSceneId]));
  }, [activeSceneId]);

  useEffect(() => {
    setSelection((current) => (
      current.kind === 'device' ? { kind: 'device', id: selectedDeviceId } : current
    ));
  }, [selectedDeviceId]);

  useEffect(() => {
    onSelectionChange(selection);
  }, [selection, onSelectionChange]);

  useEffect(() => {
    if (!layerPin) return;
    setSelection(
      layerPin.kind === 'device'
        ? { kind: 'device', id: layerPin.id }
        : layerPin.kind === 'prop'
          ? { kind: 'prop', id: layerPin.id }
          : { kind: 'overlay', id: layerPin.id },
    );
  }, [layerPin]);

  useEffect(() => {
    setSelection((current) => {
      if (current.kind === 'device' && !project.devices.some((device) => device.id === current.id)) {
        return { kind: 'device', id: project.selectedDeviceId };
      }
      if (current.kind === 'prop' && !(project.sceneProps ?? []).some((prop) => prop.id === current.id)) {
        return { kind: 'device', id: project.selectedDeviceId };
      }
      if (current.kind === 'overlay' && !(project.overlays ?? []).some((overlay) => overlay.id === current.id)) {
        return { kind: 'device', id: project.selectedDeviceId };
      }
      if ((current.kind === 'screen' || current.kind === 'backdrop') && !project.devices.some((device) => device.id === current.deviceId)) {
        return { kind: 'device', id: project.selectedDeviceId };
      }
      return current;
    });
  }, [project.devices, project.sceneProps, project.overlays, project.selectedDeviceId]);

  const layers = useMemo(() => ensureCompositionLayers(project), [project]);
  const isVisible = (kind: 'device' | 'prop' | 'overlay', refId: string) => (
    layers.find((layer) => layer.kind === kind && layer.refId === refId)?.visible !== false
  );

  const visibleCount = useMemo(() => {
    const devices = project.devices.filter((device) => isVisible('device', device.id));
    const props = (project.sceneProps ?? []).filter((prop) => isVisible('prop', prop.id));
    const overlays = (project.overlays ?? []).filter((overlay) => isVisible('overlay', overlay.id));
    return devices.length * 3 + props.length + overlays.length + 5;
  }, [project, layers]);

  const pinBranch = (attr: string, id: string) => {
    const el = scrollRef.current?.querySelector(`[${attr}="${CSS.escape(id)}"]`);
    if (el instanceof HTMLElement) pinToContainerTop(el);
  };

  const toggleScene = (sceneId: string) => {
    const opening = !openSceneIds.includes(sceneId);
    setOpenSceneIds((current) => (
      current.includes(sceneId) ? current.filter((id) => id !== sceneId) : [...current, sceneId]
    ));
    if (opening) pinBranch('data-scene-branch', sceneId);
  };

  const toggleDevice = (deviceId: string) => {
    const opening = !openDeviceIds.includes(deviceId);
    setOpenDeviceIds((current) => (
      current.includes(deviceId) ? current.filter((id) => id !== deviceId) : [...current, deviceId]
    ));
    if (opening) pinBranch('data-device-branch', deviceId);
  };

  const selectScene = (scene: CompositionScene) => {
    if (scene.id !== activeSceneId) onSwitchScene(scene.id);
    setSelection({ kind: 'scene', id: scene.id });
    if (!openSceneIds.includes(scene.id)) pinBranch('data-scene-branch', scene.id);
    setOpenSceneIds((current) => (current.includes(scene.id) ? current : [...current, scene.id]));
    onOpenSection('look');
  };

  const selectDevice = (device: DeviceInstance) => {
    onSelectDevice(device);
    setSelection({ kind: 'device', id: device.id });
    if (!openDeviceIds.includes(device.id)) pinBranch('data-device-branch', device.id);
    setOpenDeviceIds((current) => (current.includes(device.id) ? current : [...current, device.id]));
    onOpenSection('device');
  };

  const renameScene = (scene: CompositionScene) => {
    const next = window.prompt('Rename scene', scene.name);
    if (next == null) return;
    onRenameScene(scene.id, next);
  };

  return (
    <div className="scene-hierarchy">
      <div
        className="scene-hierarchy-scroll"
        role="tree"
        aria-label="Scene objects"
        ref={scrollRef}
        onPointerDown={(event) => {
          const row = (event.target as HTMLElement).closest('.scene-tree-row');
          if (!(row instanceof HTMLElement)) return;
          row.classList.add('is-tapped');
          window.setTimeout(() => row.classList.remove('is-tapped'), 420);
        }}
      >
        {scenes.map((scene) => {
          const open = openSceneIds.includes(scene.id);
          const active = scene.id === activeSceneId;
          const sceneSelected = selection.kind === 'scene' && selection.id === scene.id;
          return (
            <div key={scene.id} className="scene-tree-branch" role="group" data-scene-branch={scene.id}>
              <div className={`scene-tree-row is-root ${sceneSelected ? 'is-selected' : ''}`} role="treeitem" aria-expanded={open}>
                <button
                  type="button"
                  className={`scene-tree-chevron ${open ? '' : 'is-collapsed'}`}
                  aria-label={open ? `Collapse ${scene.name}` : `Expand ${scene.name}`}
                  onClick={() => toggleScene(scene.id)}
                >
                  <img src={sceneSelected ? iconDownSelected : iconDown} alt="" />
                </button>
                <button
                  type="button"
                  className="scene-tree-main"
                  onClick={() => selectScene(scene)}
                  onDoubleClick={() => renameScene(scene)}
                  title={`${scene.name} · double-click to rename`}
                >
                  <img src={sceneSelected ? iconCubeSelected : iconCube} alt="" />
                  <span>{sceneRowLabel(scene, scenes.length)}</span>
                </button>
                {scenes.length > 1 && (
                  <button
                    type="button"
                    className="scene-tree-remove"
                    title={`Remove ${scene.name}`}
                    aria-label={`Remove ${scene.name}`}
                    onClick={() => onRemoveScene(scene.id)}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>

              {open && active && (
                <>
                  {project.devices.map((device) => {
                    const deviceOpen = openDeviceIds.includes(device.id);
                    const deviceSelected = selection.kind === 'device' && selection.id === device.id;
                    const label = getDevice(device.deviceId).label;
                    const hidden = !isVisible('device', device.id);
                    return (
                      <div key={device.id} className={`scene-tree-branch ${hidden ? 'is-hidden' : ''}`} role="group" data-device-branch={device.id}>
                        <div className={`scene-tree-row is-device ${deviceSelected ? 'is-selected' : ''}`} role="treeitem" aria-expanded={deviceOpen}>
                          <button
                            type="button"
                            className={`scene-tree-chevron ${deviceOpen ? '' : 'is-collapsed'}`}
                            aria-label={deviceOpen ? `Collapse ${label}` : `Expand ${label}`}
                            onClick={() => toggleDevice(device.id)}
                          >
                            <img src={deviceSelected ? iconDownSelected : iconDown} alt="" />
                          </button>
                          <button type="button" className="scene-tree-main" title="Backspace removes this device" onClick={() => selectDevice(device)}>
                            <img src={deviceSelected ? iconCubeSelected : iconCube} alt="" />
                            <span>{label}</span>
                          </button>
                        </div>
                        {deviceOpen && (
                          <>
                            <button
                              type="button"
                              className={`scene-tree-row is-nested ${selection.kind === 'screen' && selection.deviceId === device.id ? 'is-selected' : ''}`}
                              onClick={() => {
                                onSelectDevice(device);
                                setSelection({ kind: 'screen', deviceId: device.id });
                                onOpenAssets();
                              }}
                            >
                              <img src={iconPhone} alt="" />
                              <span>Screen</span>
                            </button>
                            <button
                              type="button"
                              className={`scene-tree-row is-nested ${selection.kind === 'backdrop' && selection.deviceId === device.id ? 'is-selected' : ''}`}
                              onClick={() => {
                                onSelectDevice(device);
                                setSelection({ kind: 'backdrop', deviceId: device.id });
                                onOpenSection('look');
                              }}
                            >
                              <img src={iconImage} alt="" />
                              <span>Backdrop</span>
                            </button>
                            {selection.kind === 'backdrop' && selection.deviceId === device.id && (
                              <div className="scene-tree-looks">
                                <div className="scene-grid scene-grid-compact">
                                  {looks.map((item) => (
                                    <div key={item.id} className={`scene-card-wrap ${project.background === item.id ? 'active' : ''}`}>
                                      <button
                                        type="button"
                                        className={`scene-card ${project.background === item.id ? 'active' : ''}`}
                                        onClick={() => onChooseLook(item)}
                                        title={item.description}
                                      >
                                        <div className={`scene-thumb ${BACKGROUNDS.some((entry) => entry.id === item.id) ? `bg-${item.id}` : ''}`} style={lookThumbStyle(item)}>
                                          <div className="scene-mini-device"><span /></div>
                                        </div>
                                        <strong>{item.label}</strong>
                                      </button>
                                      {item.id.startsWith('custom-') && (
                                        <button
                                          type="button"
                                          className="scene-delete"
                                          title="Delete preset"
                                          aria-label={`Delete ${item.label}`}
                                          onClick={() => onDeleteLook(item.id)}
                                        >
                                          <Trash2 size={12} />
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                  {project.background === 'custom' && (
                                    <button type="button" className="scene-card active" title="Edited colours">
                                      <div className="scene-thumb" style={{ background: gradientCss(project.gradientColors) }}>
                                        <div className="scene-mini-device"><span /></div>
                                      </div>
                                      <strong>Custom</strong>
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}

                  {(project.sceneProps ?? []).map((prop) => (
                    <div
                      key={prop.id}
                      className={`scene-tree-row is-studio ${!isVisible('prop', prop.id) ? 'is-hidden' : ''} ${selection.kind === 'prop' && selection.id === prop.id ? 'is-selected' : ''}`}
                      role="treeitem"
                    >
                      <button
                        type="button"
                        className="scene-tree-main"
                        title="Select shape · Backspace removes"
                        onClick={() => {
                          setSelection({ kind: 'prop', id: prop.id });
                          onSelectProp(prop.id);
                        }}
                      >
                        <img src={iconCube} alt="" />
                        <span>{propLabel(prop.kind)}</span>
                      </button>
                      <button
                        type="button"
                        className="scene-tree-remove"
                        title={`Remove ${propLabel(prop.kind)}`}
                        aria-label={`Remove ${propLabel(prop.kind)}`}
                        onClick={() => onRemoveProp(prop.id)}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}

                  {(project.overlays ?? []).map((overlay) => {
                    const text = overlay.kind === 'comment'
                      ? (overlay.text || 'Comment').trim()
                      : overlay.kind === 'shape'
                        ? (overlay.text === 'ellipse' ? 'Ellipse' : overlay.text === 'triangle' ? 'Triangle' : 'Rectangle')
                        : overlay.kind === 'path'
                          ? 'Pen stroke'
                          : overlay.kind === 'text'
                            ? (overlay.text || 'Text').trim()
                            : 'Image overlay';
                    const label = text.length > 22 ? `${text.slice(0, 20)}…` : text;
                    return (
                      <button
                        key={overlay.id}
                        type="button"
                        className={`scene-tree-row is-studio ${!isVisible('overlay', overlay.id) ? 'is-hidden' : ''} ${selection.kind === 'overlay' && selection.id === overlay.id ? 'is-selected' : ''}`}
                        title="Backspace removes this layer"
                        onClick={() => {
                          setSelection({ kind: 'overlay', id: overlay.id });
                          onSelectOverlay(overlay.id);
                          onOpenSection('overlays');
                        }}
                      >
                        <img src={overlay.kind === 'text' ? iconLayers : iconImage} alt="" />
                        <span>{label}</span>
                      </button>
                    );
                  })}

                  <div className="scene-tree-rule" />

                  <button
                    type="button"
                    className={`scene-tree-row is-studio ${selection.kind === 'camera' ? 'is-selected' : ''}`}
                    onClick={() => {
                      setSelection({ kind: 'camera' });
                      onOpenSection('camera');
                    }}
                  >
                    <img src={iconCamera} alt="" />
                    <span>Camera</span>
                  </button>
                  <button
                    type="button"
                    className={`scene-tree-row is-studio ${selection.kind === 'reflection' ? 'is-selected' : ''}`}
                    onClick={() => {
                      setSelection({ kind: 'reflection' });
                      onOpenSection('reflection');
                    }}
                  >
                    <img src={iconImage} alt="" />
                    <span>Reflection</span>
                  </button>
                  <button
                    type="button"
                    className={`scene-tree-row is-studio ${selection.kind === 'key-light' ? 'is-selected' : ''}`}
                    onClick={() => {
                      setSelection({ kind: 'key-light' });
                      onFocusKeyLight();
                      onOpenSection('light');
                    }}
                  >
                    <img src={iconSun} alt="" />
                    <span>Key Light</span>
                  </button>
                  <button
                    type="button"
                    className={`scene-tree-row is-studio ${selection.kind === 'rim-light' ? 'is-selected' : ''}`}
                    onClick={() => {
                      setSelection({ kind: 'rim-light' });
                      onOpenSection('rim');
                    }}
                  >
                    <img src={iconSun} alt="" />
                    <span>Rim Light</span>
                  </button>
                  <button
                    type="button"
                    className={`scene-tree-row is-studio ${selection.kind === 'shadow' ? 'is-selected' : ''}`}
                    onClick={() => {
                      setSelection({ kind: 'shadow' });
                      onOpenSection('shadow');
                    }}
                  >
                    <img src={iconLayers} alt="" />
                    <span>Shadow</span>
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="scene-tree-footer">
        <div className="scene-tree-rule" />
        <p className="scene-tree-count">
          <img src={iconEye} alt="" />
          <span>{visibleCount} {visibleCount === 1 ? 'object' : 'objects'} visible</span>
        </p>
      </div>
    </div>
  );
}
