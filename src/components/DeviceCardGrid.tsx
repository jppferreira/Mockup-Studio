import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Check, Download, LoaderCircle } from 'lucide-react';
import {
  categoryOfDevice,
  screenSizeLabel,
  type DeviceModel,
} from '../lib/devices';
import {
  PLAN_PRICES_GBP,
  formatGbp,
  isDeviceUnlocked,
  isFreeDevice,
  type LicenseTier,
} from '../lib/license';
import { isBundledLocalDevice } from '../lib/localDeviceModels';
import {
  downloadDeviceModel,
  listCachedRemoteDeviceIds,
  peekDeviceModelCached,
  remoteModelsConfigured,
} from '../lib/modelCache';
import DeviceModelThumb from './DeviceModelThumb';

export const DEVICE_DRAG_MIME = 'application/x-mockup-device';

export type DeviceCardPreviewLayout = 'crop' | 'fit';

type CacheUi = 'ready' | 'missing' | 'downloading' | 'error';

type Props = {
  devices: DeviceModel[];
  /** Primitive selected id — keeps memo effective across App re-renders. */
  selectedId: string | null | undefined;
  licenseTier: LicenseTier;
  onPick: (device: DeviceModel, unlocked: boolean) => void;
  onLibraryDragStart?: (deviceId: string) => void;
  onLibraryDragEnd?: () => void;
  onNotify?: (message: string) => void;
  previewLayout?: DeviceCardPreviewLayout;
};

/**
 * Device library grid — memoized so App project tweaks (lights, overlays, etc.)
 * do not rebuild every thumb card.
 */
function DeviceCardGridImpl({
  devices,
  selectedId,
  licenseTier,
  onPick,
  onLibraryDragStart,
  onLibraryDragEnd,
  onNotify,
  previewLayout = 'fit',
}: Props) {
  const dragStarted = useRef(false);
  const remote = remoteModelsConfigured();
  const [cacheById, setCacheById] = useState<Record<string, CacheUi>>({});

  useEffect(() => {
    if (!remote) return undefined;
    let cancelled = false;
    void listCachedRemoteDeviceIds().then((ready) => {
      if (cancelled) return;
      setCacheById((prev) => {
        const next = { ...prev };
        for (const device of devices) {
          if (isBundledLocalDevice(device.id)) {
            next[device.id] = 'ready';
            continue;
          }
          if (prev[device.id] === 'downloading') continue;
          if (ready.has(device.id) || peekDeviceModelCached(device.id)) {
            next[device.id] = 'ready';
          } else if (!next[device.id]) {
            next[device.id] = 'missing';
          }
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [devices, remote]);

  const startDownload = useCallback(async (device: DeviceModel) => {
    if (!remote || isBundledLocalDevice(device.id)) return;
    setCacheById((prev) => ({ ...prev, [device.id]: 'downloading' }));
    try {
      await downloadDeviceModel(device.id);
      setCacheById((prev) => ({ ...prev, [device.id]: 'ready' }));
      onNotify?.(`${device.label} ready offline`);
    } catch (err) {
      setCacheById((prev) => ({ ...prev, [device.id]: 'error' }));
      const message = err instanceof Error ? err.message : `Could not download ${device.label}`;
      onNotify?.(message);
    }
  }, [onNotify, remote]);

  if (devices.length === 0) {
    return <div className="device-card-empty">No devices in this category</div>;
  }

  return (
    <div
      className={`device-card-grid is-preview-${previewLayout}`}
      role="listbox"
      aria-label="Devices"
      data-preview-layout={previewLayout}
    >
      {devices.map((device) => {
        const unlocked = isDeviceUnlocked(licenseTier, device.id);
        const selected = selectedId === device.id;
        const category = categoryOfDevice(device);
        const proFeature = !isFreeDevice(device.id);
        const bundled = isBundledLocalDevice(device.id);
        const cache = bundled ? 'ready' : (cacheById[device.id] ?? (peekDeviceModelCached(device.id) ? 'ready' : 'missing'));
        const showDownload = remote && !bundled && unlocked;
        return (
          <div key={device.id} className="device-model-card-wrap">
            <button
              type="button"
              role="option"
              aria-selected={selected}
              draggable={unlocked}
              data-category={category}
              className={`device-model-card ${selected ? 'is-selected' : ''} ${unlocked ? '' : 'is-locked'} ${proFeature ? 'is-pro-feature' : ''}`}
              title={unlocked
                ? `${device.subtitle} · ${screenSizeLabel(device.screenSize)} · Drag onto the canvas to place`
                : `Pro ${formatGbp(PLAN_PRICES_GBP.pro)} — unlock full device library`}
              onDragStart={(event) => {
                if (!unlocked) {
                  event.preventDefault();
                  return;
                }
                dragStarted.current = true;
                event.dataTransfer.setData(DEVICE_DRAG_MIME, device.id);
                event.dataTransfer.setData('text/plain', device.label);
                event.dataTransfer.effectAllowed = 'copy';
                onLibraryDragStart?.(device.id);
                const thumb = event.currentTarget.querySelector('.device-model-card-thumb');
                if (thumb instanceof HTMLElement) {
                  event.dataTransfer.setDragImage(thumb, thumb.clientWidth / 2, thumb.clientHeight / 2);
                }
              }}
              onDragEnd={() => {
                onLibraryDragEnd?.();
                window.setTimeout(() => { dragStarted.current = false; }, 0);
              }}
              onClick={() => {
                if (dragStarted.current) {
                  dragStarted.current = false;
                  return;
                }
                onPick(device, unlocked);
              }}
            >
              {!unlocked ? <span className="pro-feature-tag" aria-label="Locked">Locked</span> : null}
              {bundled ? <span className="device-model-local-tag" aria-label="Ships with app">Local</span> : null}
              <span className="device-model-card-thumb" aria-hidden>
                <DeviceModelThumb deviceId={device.id} />
              </span>
              <span className="device-model-card-copy">
                <strong>{device.label}</strong>
                <span>{screenSizeLabel(device.screenSize)}</span>
              </span>
              {selected ? <Check size={12} className="device-model-card-check" aria-hidden /> : null}
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
                  void startDownload(device);
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
  );
}

function gridEqual(prev: Props, next: Props) {
  return prev.devices === next.devices
    && prev.previewLayout === next.previewLayout
    && prev.selectedId === next.selectedId
    && prev.licenseTier === next.licenseTier
    && prev.onPick === next.onPick
    && prev.onLibraryDragStart === next.onLibraryDragStart
    && prev.onLibraryDragEnd === next.onLibraryDragEnd
    && prev.onNotify === next.onNotify;
}

const DeviceCardGrid = memo(DeviceCardGridImpl, gridEqual);
export default DeviceCardGrid;
