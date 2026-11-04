import {
  normalizeGradientColors,
  type GradientColors,
  type ScenePreset,
} from '../types';

const STORAGE_KEY = 'mockup-studio.custom-scene-presets';

function readRaw(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function loadCustomScenePresets(): ScenePreset[] {
  const raw = readRaw();
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Partial<ScenePreset>;
    if (typeof entry.id !== 'string' || !entry.id.startsWith('custom-')) return [];
    if (typeof entry.label !== 'string' || !entry.label.trim()) return [];
    if (!entry.gradient || typeof entry.gradient !== 'object') return [];
    return [{
      id: entry.id,
      label: entry.label.trim().slice(0, 40),
      description: typeof entry.description === 'string' && entry.description.trim()
        ? entry.description.trim().slice(0, 80)
        : 'Custom gradient',
      gradient: normalizeGradientColors(entry.gradient as Partial<GradientColors>),
    }];
  }).slice(0, 24);
}

function writePresets(presets: ScenePreset[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function saveCustomScenePreset(label: string, colors: GradientColors): ScenePreset {
  const presets = loadCustomScenePresets();
  const preset: ScenePreset = {
    id: `custom-${Date.now().toString(36)}`,
    label: label.trim().slice(0, 40) || `Custom ${presets.length + 1}`,
    description: 'Saved gradient',
    gradient: normalizeGradientColors(colors),
  };
  writePresets([preset, ...presets].slice(0, 24));
  return preset;
}

export function deleteCustomScenePreset(id: string): ScenePreset[] {
  const next = loadCustomScenePresets().filter((item) => item.id !== id);
  writePresets(next);
  return next;
}
