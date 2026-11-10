import { DEVICE_MODELS, getDevice } from '../lib/devices';

/**
 * Static PNG card art from src/assets/device-thumbs.
 * Bundled via import.meta.glob so URLs respect Vite `base: './'`
 * (absolute `/device-thumbs/...` resolves to file:///device-thumbs/... in Electron).
 */
const thumbFiles = import.meta.glob('../assets/device-thumbs/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

function fileName(path: string) {
  return path.split('/').pop()?.replace(/\.png$/i, '') ?? '';
}

const thumbsByName = new Map(
  Object.entries(thumbFiles).map(([path, url]) => [fileName(path), url]),
);

const PLACEHOLDERS = ['iphone-clay-angle-01', 'iphone-clay-angle-02', 'iphone-clay-angle-03']
  .map((name) => thumbsByName.get(name))
  .filter((url): url is string => Boolean(url));

function thumbForDevice(deviceId: string) {
  const assigned = thumbsByName.get(deviceId);
  if (assigned) return assigned;

  const device = getDevice(deviceId);
  if (device.url) {
    const stem = device.url.split('/').pop()?.replace(/\.glb$/i, '') ?? '';
    const fromStem = stem ? thumbsByName.get(stem) : undefined;
    if (fromStem) return fromStem;
    const sibling = DEVICE_MODELS.find((entry) => (
      entry.id !== deviceId
      && entry.url === device.url
      && thumbsByName.has(entry.id)
    ));
    if (sibling) {
      const siblingUrl = thumbsByName.get(sibling.id);
      if (siblingUrl) return siblingUrl;
    }
  }

  const index = DEVICE_MODELS.findIndex((entry) => entry.id === deviceId);
  const slot = index >= 0 ? index : 0;
  return PLACEHOLDERS[slot % Math.max(1, PLACEHOLDERS.length)] ?? '';
}

/** Static PNG card art for the 3D models library. */
export default function DeviceModelThumb({ deviceId }: { deviceId: string }) {
  const src = thumbForDevice(deviceId);
  if (!src) return <span className="device-model-shot-img" aria-hidden />;
  return (
    <img
      className="device-model-shot-img"
      src={src}
      alt=""
      draggable={false}
      decoding="async"
    />
  );
}
