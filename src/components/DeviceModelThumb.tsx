import { useEffect, useRef, useState } from 'react';
import { DEVICE_MODELS, getDevice } from '../lib/devices';

/**
 * Static PNG card art from src/assets/device-thumbs.
 * Non-eager glob so Vite emits per-image chunks; each thumb fetches only when
 * its card nears the viewport (respects `base: './'` for Electron + gh-pages).
 */
const thumbLoaders = import.meta.glob('../assets/device-thumbs/*.png', {
  import: 'default',
}) as Record<string, () => Promise<string>>;

function fileName(path: string) {
  return path.split('/').pop()?.replace(/\.png$/i, '') ?? '';
}

const loadersByName = new Map(
  Object.entries(thumbLoaders).map(([path, load]) => [fileName(path), load]),
);

const PLACEHOLDER_NAMES = ['iphone-clay-angle-01', 'iphone-clay-angle-02', 'iphone-clay-angle-03']
  .filter((name) => loadersByName.has(name));

const resolvedUrls = new Map<string, string>();
const inflightUrls = new Map<string, Promise<string>>();

function loadThumbUrl(name: string): Promise<string> {
  const cached = resolvedUrls.get(name);
  if (cached) return Promise.resolve(cached);
  const pending = inflightUrls.get(name);
  if (pending) return pending;
  const loader = loadersByName.get(name);
  if (!loader) return Promise.resolve('');
  const task = loader()
    .then((url) => {
      resolvedUrls.set(name, url);
      inflightUrls.delete(name);
      return url;
    })
    .catch(() => {
      inflightUrls.delete(name);
      return '';
    });
  inflightUrls.set(name, task);
  return task;
}

function thumbNameForDevice(deviceId: string): string {
  if (loadersByName.has(deviceId)) return deviceId;

  const device = getDevice(deviceId);
  if (device.url) {
    const stem = device.url.split('/').pop()?.replace(/\.glb$/i, '') ?? '';
    if (stem && loadersByName.has(stem)) return stem;
    const sibling = DEVICE_MODELS.find((entry) => (
      entry.id !== deviceId
      && entry.url === device.url
      && loadersByName.has(entry.id)
    ));
    if (sibling) return sibling.id;
  }

  const index = DEVICE_MODELS.findIndex((entry) => entry.id === deviceId);
  const slot = index >= 0 ? index : 0;
  return PLACEHOLDER_NAMES[slot % Math.max(1, PLACEHOLDER_NAMES.length)] ?? '';
}

/** Static PNG card art for the 3D models library. */
export default function DeviceModelThumb({ deviceId }: { deviceId: string }) {
  const name = thumbNameForDevice(deviceId);
  const [src, setSrc] = useState(() => (name ? resolvedUrls.get(name) ?? '' : ''));
  const hostRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!name) {
      setSrc('');
      return undefined;
    }
    const cached = resolvedUrls.get(name);
    if (cached) {
      setSrc(cached);
      return undefined;
    }

    let cancelled = false;
    const run = () => {
      void loadThumbUrl(name).then((url) => {
        if (!cancelled) setSrc(url);
      });
    };

    const el = hostRef.current;
    if (el && typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry?.isIntersecting) return;
          run();
          observer.disconnect();
        },
        { rootMargin: '240px 0px', threshold: 0.01 },
      );
      observer.observe(el);
      return () => {
        cancelled = true;
        observer.disconnect();
      };
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [name]);

  if (!name) return <span className="device-model-shot-img" aria-hidden />;
  if (!src) return <span ref={hostRef} className="device-model-shot-img" aria-hidden />;
  return (
    <img
      className="device-model-shot-img"
      src={src}
      alt=""
      draggable={false}
      decoding="async"
      loading="lazy"
    />
  );
}
