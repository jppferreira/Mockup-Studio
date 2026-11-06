import { DEVICE_MODELS } from '../lib/devices';

const thumbFiles = import.meta.glob('../assets/device-thumbs/*.webp', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

function fileName(path: string) {
  return path.split('/').pop()?.replace(/\.webp$/, '') ?? '';
}

const thumbsByName = new Map(
  Object.entries(thumbFiles).map(([path, url]) => [fileName(path), url]),
);

const PLACEHOLDER_THUMBS = ['iphone-clay-angle-01', 'iphone-clay-angle-02', 'iphone-clay-angle-03']
  .map((name) => thumbsByName.get(name))
  .filter((url): url is string => Boolean(url));

function thumbForDevice(deviceId: string) {
  const assigned = thumbsByName.get(deviceId);
  if (assigned) return assigned;
  const index = DEVICE_MODELS.findIndex((device) => device.id === deviceId);
  const slot = index >= 0 ? index : 0;
  return PLACEHOLDER_THUMBS[slot % Math.max(1, PLACEHOLDER_THUMBS.length)] ?? '';
}

export default function DeviceModelThumb({ deviceId }: { deviceId: string }) {
  const src = thumbForDevice(deviceId);
  return (
    <span className="device-model-shot is-placeholder">
      {src ? <img src={src} alt="" /> : null}
    </span>
  );
}
