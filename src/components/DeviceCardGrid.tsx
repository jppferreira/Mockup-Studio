import { memo, useRef } from 'react';
import { Check } from 'lucide-react';
import {
  categoryOfDevice,
  screenSizeLabel,
  type DeviceModel,
} from '../lib/devices';
import { PLAN_PRICES_GBP, formatGbp, isFreeDevice } from '../lib/license';
import DeviceModelThumb from './DeviceModelThumb';

export const DEVICE_DRAG_MIME = 'application/x-mockup-device';

export type DeviceCardPreviewLayout = 'crop' | 'fit';

type Props = {
  devices: DeviceModel[];
  isSelected: (id: string) => boolean;
  isUnlocked: (id: string) => boolean;
  onPick: (device: DeviceModel, unlocked: boolean) => void;
  onLibraryDragStart?: (deviceId: string) => void;
  onLibraryDragEnd?: () => void;
  previewLayout?: DeviceCardPreviewLayout;
};

/**
 * Device library grid — memoized so App project tweaks (lights, overlays, etc.)
 * do not rebuild every thumb card.
 */
function DeviceCardGridImpl({
  devices,
  isSelected,
  isUnlocked,
  onPick,
  onLibraryDragStart,
  onLibraryDragEnd,
  previewLayout = 'fit',
}: Props) {
  const dragStarted = useRef(false);

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
        const unlocked = isUnlocked(device.id);
        const selected = isSelected(device.id);
        const category = categoryOfDevice(device);
        const proFeature = !isFreeDevice(device.id);
        return (
          <button
            key={device.id}
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
            <span className="device-model-card-thumb" aria-hidden>
              <DeviceModelThumb deviceId={device.id} />
            </span>
            <span className="device-model-card-copy">
              <strong>{device.label}</strong>
              <span>{screenSizeLabel(device.screenSize)}</span>
            </span>
            {selected ? <Check size={12} className="device-model-card-check" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}

function gridEqual(prev: Props, next: Props) {
  return prev.devices === next.devices
    && prev.previewLayout === next.previewLayout
    && prev.isSelected === next.isSelected
    && prev.isUnlocked === next.isUnlocked
    && prev.onPick === next.onPick
    && prev.onLibraryDragStart === next.onLibraryDragStart
    && prev.onLibraryDragEnd === next.onLibraryDragEnd;
}

const DeviceCardGrid = memo(DeviceCardGridImpl, gridEqual);
export default DeviceCardGrid;
