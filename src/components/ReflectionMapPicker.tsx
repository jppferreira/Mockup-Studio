import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import {
  REFLECTION_MAPS,
  reflectionMapPreviewDataUrl,
  type ReflectionMapId,
} from '../lib/reflectionMaps';
import type { BackgroundPreset, GradientColors } from '../types';

interface Props {
  value: ReflectionMapId | 'custom';
  customImage: string | null;
  background: BackgroundPreset;
  colors: GradientColors | null;
  onChange: (id: ReflectionMapId | 'custom') => void;
  onCustomImage: (dataUrl: string | null) => void;
}

export default function ReflectionMapPicker({
  value,
  customImage,
  background,
  colors,
  onChange,
  onCustomImage,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const colorKey = colors ? `${colors.center}-${colors.mid}-${colors.edge}` : '';
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [customPreview, setCustomPreview] = useState<string | null>(null);
  const [heroPreview, setHeroPreview] = useState<string | null>(null);

  const options = useMemo(
    () => ({ background, colors }),
    [background, colorKey, colors],
  );

  // Generate sphere previews off the critical path so the 3D canvas can paint first.
  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(() => {
      const next: Record<string, string> = {};
      for (const map of REFLECTION_MAPS) {
        if (cancelled) return;
        next[map.id] = reflectionMapPreviewDataUrl(map.id, options, 72);
      }
      if (!cancelled) setPreviews(next);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [options, background, colorKey]);

  useEffect(() => {
    let cancelled = false;
    if (!customImage) {
      setCustomPreview(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setCustomPreview(reflectionMapPreviewDataUrl('custom', { ...options, customImage: img }, 72));
    };
    img.src = customImage;
    return () => { cancelled = true; };
  }, [customImage, options, background, colorKey]);

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void (async () => {
        if (value === 'custom' && customImage) {
          const img = await loadImage(customImage);
          if (cancelled) return;
          setHeroPreview(reflectionMapPreviewDataUrl('custom', { ...options, customImage: img }, 140));
          return;
        }
        if (cancelled) return;
        setHeroPreview(reflectionMapPreviewDataUrl(value === 'custom' ? 'studio' : value, options, 140));
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [value, customImage, options, background, colorKey]);

  const activeLabel = value === 'custom'
    ? 'Custom image'
    : REFLECTION_MAPS.find((m) => m.id === value)?.label ?? 'Reflection';

  const activeDesc = value === 'custom'
    ? 'Uploaded equirect / panorama'
    : REFLECTION_MAPS.find((m) => m.id === value)?.description ?? '';

  return (
    <div className="reflection-map-picker">
      <div className="reflection-hero">
        <div className="reflection-hero-sphere" aria-hidden>
          {heroPreview && <img src={heroPreview} alt="" />}
        </div>
        <div className="reflection-hero-meta">
          <strong>{activeLabel}</strong>
          <span>{activeDesc}</span>
          <p>Chrome ball preview — same environment the device glass samples.</p>
        </div>
      </div>

      <div className="reflection-sphere-grid" role="listbox" aria-label="Reflection maps">
        {REFLECTION_MAPS.map((map) => (
          <button
            key={map.id}
            type="button"
            role="option"
            aria-selected={value === map.id}
            className={`reflection-sphere-card ${value === map.id ? 'selected' : ''}`}
            title={map.description}
            onClick={() => onChange(map.id)}
          >
            <span className="reflection-sphere-thumb">
              {previews[map.id] && <img src={previews[map.id]} alt="" />}
            </span>
            <span className="reflection-sphere-label">{map.label}</span>
          </button>
        ))}

        <button
          type="button"
          role="option"
          aria-selected={value === 'custom'}
          className={`reflection-sphere-card ${value === 'custom' ? 'selected' : ''}`}
          title="Upload a reflection image"
          onClick={() => fileRef.current?.click()}
        >
          <span className="reflection-sphere-thumb reflection-sphere-upload">
            {customPreview
              ? <img src={customPreview} alt="" />
              : <ImagePlus size={22} strokeWidth={1.75} />}
          </span>
          <span className="reflection-sphere-label">Upload</span>
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (file.size > 12 * 1024 * 1024) return;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = typeof reader.result === 'string' ? reader.result : null;
            if (!dataUrl) return;
            onCustomImage(dataUrl);
            onChange('custom');
          };
          reader.readAsDataURL(file);
        }}
      />
    </div>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
