import { DEVICE_MODELS, getDevice } from '../lib/devices';

/**
 * Static PNG card art from public/device-thumbs (not WebP).
 * Uses a sized background box — Electron was collapsing card thumbs to width 0.
 */
const KNOWN_THUMBS = new Set([
  'airpods_pro',
  'apple_homeview',
  'apple_vision_pro',
  'apple_watch_se_3',
  'apple_watch_series_12',
  'apple_watch_series_7',
  'apple_watch_ultra_2',
  'apple_watch_ultra_4',
  'chronograph_watch',
  'galaxy_s21_ultra',
  'galaxy_s26',
  'galaxy_s26_plus',
  'galaxy_s26_ultra',
  'galaxy_watch',
  'galaxy_watch_ultra',
  'galaxy_z_flip8',
  'galaxy_z_fold8',
  'galaxy_z_fold8_ultra',
  'imac_24',
  'imac_m4',
  'ipad_mini_6',
  'ipad_pro_m5',
  'iphone-clay-angle-01',
  'iphone-clay-angle-02',
  'iphone-clay-angle-03',
  'iphone_13_pro_max',
  'iphone_15_pro_max',
  'iphone_16_pro_max',
  'iphone_17',
  'iphone_17_pro',
  'iphone_17_pro_max',
  'iphone_18',
  'iphone_18_pro',
  'iphone_18_pro_max',
  'iphone_air',
  'iphone_duo',
  'jbl_tour_one_m3',
  'macbook_air_13_2023',
  'macbook_pro_13_2020',
  'macbook_pro_16_2021',
  'macbook_pro_m3_16',
  'macbook_pro_m3_space_black',
  'macbook_pro_m5',
  'macbook_pro_touchbar',
  'pixel_10_pro',
  'pixel_11',
  'pixel_11_pro',
  'pixel_11_pro_xl',
  'pixel_9',
  'pixel_9_pro',
  'pixel_9_pro_xl',
  'pixel_fold',
  'pixel_watch',
  'pixel_watch_7',
  'rolex_watch',
  'skullcandy_crusher',
  'sony_mdr_7506',
]);

const PLACEHOLDERS = ['iphone-clay-angle-01', 'iphone-clay-angle-02', 'iphone-clay-angle-03'];

function thumbUrl(name: string) {
  return `/device-thumbs/${name}.png?v=darkclay5`;
}

function thumbForDevice(deviceId: string) {
  if (KNOWN_THUMBS.has(deviceId)) return thumbUrl(deviceId);

  const device = getDevice(deviceId);
  if (device.url) {
    const stem = device.url.split('/').pop()?.replace(/\.glb$/i, '') ?? '';
    if (stem && KNOWN_THUMBS.has(stem)) return thumbUrl(stem);
    const sibling = DEVICE_MODELS.find((entry) => (
      entry.id !== deviceId
      && entry.url === device.url
      && KNOWN_THUMBS.has(entry.id)
    ));
    if (sibling) return thumbUrl(sibling.id);
  }

  const index = DEVICE_MODELS.findIndex((entry) => entry.id === deviceId);
  const slot = index >= 0 ? index : 0;
  return thumbUrl(PLACEHOLDERS[slot % PLACEHOLDERS.length]);
}

/** Static PNG card art for the 3D models library. */
export default function DeviceModelThumb({ deviceId }: { deviceId: string }) {
  const src = thumbForDevice(deviceId);
  return (
    <span
      className="device-model-shot-img"
      role="img"
      aria-hidden
      style={{ backgroundImage: `url("${src}")` }}
    />
  );
}
