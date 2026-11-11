import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ChangeEvent } from 'react';
import { Check, Trash2 } from 'lucide-react';
import {
  deleteCustomDevice,
  importCustomDevices,
  listCustomDeviceMaterials,
  updateCustomDeviceMeta,
  type CustomDeviceMeta,
} from '../lib/customDevices';
import { isCustomDeviceId, screenSizeLabel, type DevicePlatform } from '../lib/devices';
import { CUSTOM_MODEL_ACCEPT } from '../lib/meshDrop';

interface Props {
  selectedDeviceId: string;
  customDevices: CustomDeviceMeta[];
  disabled?: boolean;
  onImported: (metas: CustomDeviceMeta[]) => void;
  onUpdated: (meta: CustomDeviceMeta) => void;
  onDeleted: (id: string) => void;
  onNotify: (message: string) => void;
}

export type CustomDevicePanelHandle = {
  openImport: () => void;
  openImportFolder: () => void;
};

const CustomDevicePanel = forwardRef<CustomDevicePanelHandle, Props>(function CustomDevicePanel({
  selectedDeviceId,
  customDevices,
  disabled,
  onImported,
  onUpdated,
  onDeleted,
  onNotify,
}, ref) {
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  useImperativeHandle(ref, () => ({
    openImport: () => {
      if (!disabled) fileRef.current?.click();
    },
    openImportFolder: () => {
      const input = folderRef.current;
      if (!input || disabled) return;
      input.setAttribute('webkitdirectory', '');
      input.click();
    },
  }), [disabled]);
  const [materials, setMaterials] = useState<string[]>([]);
  const selected = isCustomDeviceId(selectedDeviceId)
    ? customDevices.find((d) => d.id === selectedDeviceId)
    : undefined;

  useEffect(() => {
    let cancelled = false;
    if (!selected) {
      setMaterials([]);
      return undefined;
    }
    void listCustomDeviceMaterials(selected.id).then((names) => {
      if (!cancelled) setMaterials(names);
    }).catch(() => {
      if (!cancelled) setMaterials([]);
    });
    return () => { cancelled = true; };
  }, [selected?.id]);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    setBusy(true);
    try {
      const { imported, skipped } = await importCustomDevices({ files });
      onImported(imported);
      if (imported.length === 1) {
        onNotify(
          skipped
            ? `Imported “${imported[0].label}” · ${skipped} skipped (library full)`
            : `Imported “${imported[0].label}”`,
        );
      } else {
        onNotify(
          skipped
            ? `Imported ${imported.length} models · ${skipped} skipped (library full)`
            : `Imported ${imported.length} models`,
        );
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Could not import model');
    } finally {
      setBusy(false);
    }
  };

  const patchSelected = async (patch: Parameters<typeof updateCustomDeviceMeta>[1]) => {
    if (!selected) return;
    const next = await updateCustomDeviceMeta(selected.id, patch);
    if (next) onUpdated(next);
  };

  const removeSelected = async () => {
    if (!selected) return;
    const label = selected.label;
    await deleteCustomDevice(selected.id);
    onDeleted(selected.id);
    onNotify(`Removed “${label}”`);
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={CUSTOM_MODEL_ACCEPT}
        multiple
        hidden
        onChange={(e) => { void onFile(e); }}
      />
      <input
        ref={folderRef}
        type="file"
        accept={CUSTOM_MODEL_ACCEPT}
        multiple
        hidden
        onChange={(e) => { void onFile(e); }}
      />

      {selected && (
        <details className="custom-device-disclosure">
          <summary>{busy ? 'Importing…' : 'Model settings'}</summary>
        <div className="custom-device-editor">

          <label className="field-stack">
            <span>Name</span>
            <input
              type="text"
              value={selected.label}
              maxLength={48}
              disabled={disabled}
              onChange={(e) => { void patchSelected({ label: e.target.value }); }}
            />
          </label>

          <div className="custom-device-row">
            <label className="field-stack">
              <span>Platform</span>
              <select
                value={selected.platform}
                disabled={disabled}
                onChange={(e) => { void patchSelected({ platform: e.target.value as DevicePlatform }); }}
              >
                <option value="ios">iOS</option>
                <option value="android">Android</option>
              </select>
            </label>
            <label className="field-stack">
              <span>Facing</span>
              <select
                value={Math.abs(selected.rot[1] - Math.PI) < 0.01 ? 'back' : 'front'}
                disabled={disabled}
                onChange={(e) => {
                  const rotY = e.target.value === 'back' ? Math.PI : 0;
                  void patchSelected({ rot: [0, rotY, 0] });
                }}
              >
                <option value="back">Screen toward camera</option>
                <option value="front">Flip 180°</option>
              </select>
            </label>
          </div>

          <div className="custom-device-row">
            <label className="field-stack">
              <span>Screen W</span>
              <input
                type="number"
                min={320}
                max={4096}
                value={selected.screenSize.width}
                disabled={disabled}
                onChange={(e) => {
                  void patchSelected({
                    screenSize: { ...selected.screenSize, width: Number(e.target.value) || selected.screenSize.width },
                  });
                }}
              />
            </label>
            <label className="field-stack">
              <span>Screen H</span>
              <input
                type="number"
                min={320}
                max={4096}
                value={selected.screenSize.height}
                disabled={disabled}
                onChange={(e) => {
                  void patchSelected({
                    screenSize: { ...selected.screenSize, height: Number(e.target.value) || selected.screenSize.height },
                  });
                }}
              />
            </label>
          </div>
          <div className="custom-device-size-hint">Ideal screenshot {screenSizeLabel(selected.screenSize)}</div>

          <label className="field-stack">
            <span>Screen material</span>
            {materials.length > 0 ? (
              <select
                value={materials.includes(selected.screenMat) ? selected.screenMat : ''}
                disabled={disabled}
                onChange={(e) => {
                  if (e.target.value) void patchSelected({ screenMat: e.target.value });
                }}
              >
                {!materials.includes(selected.screenMat) && (
                  <option value="">{selected.screenMat || 'Select…'}</option>
                )}
                {materials.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={selected.screenMat}
                disabled={disabled}
                onChange={(e) => { void patchSelected({ screenMat: e.target.value }); }}
                placeholder="Screen"
              />
            )}
          </label>

          <label className="custom-device-check">
            <input
              type="checkbox"
              checked={selected.uv.mirrorX !== false}
              disabled={disabled}
              onChange={(e) => {
                void patchSelected({ uv: { ...selected.uv, mirrorX: e.target.checked } });
              }}
            />
            <span>Mirror screenshot on X</span>
            {selected.uv.mirrorX !== false && <Check size={12} />}
          </label>

          <button
            type="button"
            className="text-button danger-text"
            disabled={disabled}
            onClick={() => { void removeSelected(); }}
          >
            <Trash2 size={13} /> Remove this model
          </button>
        </div>
        </details>
      )}
    </>
  );
});

export default CustomDevicePanel;
