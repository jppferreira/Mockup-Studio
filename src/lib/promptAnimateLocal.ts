import {
  compileMotionPlan,
  planAnimationPrompt,
  type PromptAnimateResult,
  type PromptMotionBeat,
  type PromptMotionPlan,
} from './promptAnimate';
import type { AnimEase, AnimationClip, DeviceInstance } from '../types';

const OLLAMA_URL = 'http://127.0.0.1:11434';
const MOTIONS = [
  'turntable', 'spin', 'float', 'tilt', 'swing', 'orbit', 'zoom', 'present',
  'wobble', 'bounce', 'flip', 'fan', 'closePan', 'pullBack', 'breathe', 'rise',
  'slide', 'peek', 'drift',
] as const;

type MotionName = (typeof MOTIONS)[number];

const EASES = new Set<AnimEase>(['linear', 'easeIn', 'easeOut', 'easeInOut', 'custom']);

const MOTION_LABEL: Record<MotionName, string> = {
  turntable: 'Turntable',
  spin: 'Spin',
  float: 'Float',
  tilt: 'Tilt',
  swing: 'Swing',
  orbit: 'Orbit',
  zoom: 'Zoom',
  present: 'Settle',
  wobble: 'Wobble',
  bounce: 'Bounce',
  flip: 'Flip',
  fan: 'Fan',
  closePan: 'Close pan',
  pullBack: 'Pull back',
  breathe: 'Breathe',
  rise: 'Rise',
  slide: 'Slide',
  peek: 'Peek',
  drift: 'Drift',
};

let probeCache: { at: number; model: string | null } | null = null;

function isMotion(value: string): value is MotionName {
  return (MOTIONS as readonly string[]).includes(value);
}

async function localModel(): Promise<string | null> {
  const fresh = probeCache && Date.now() - probeCache.at < (probeCache.model ? 60_000 : 20_000);
  if (fresh) return probeCache!.model;
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(450) });
    if (!response.ok) throw new Error('offline');
    const data = await response.json() as { models?: { name?: string }[] };
    const names = (data.models ?? [])
      .map((model) => model.name ?? '')
      .filter((name) => name && !/embed|nomic|bge/i.test(name));
    const model = names.find((name) => /qwen|llama3\.2|llama3\.1|mistral|gemma|phi/i.test(name)) ?? names[0] ?? null;
    probeCache = { at: Date.now(), model };
    return model;
  } catch {
    probeCache = { at: Date.now(), model: null };
    return null;
  }
}

function readJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function asPlan(value: unknown): PromptMotionPlan | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as {
    loop?: unknown;
    stagger?: unknown;
    beats?: unknown;
  };
  if (!Array.isArray(record.beats)) return null;

  const beats: PromptMotionBeat[] = [];
  for (const beat of record.beats.slice(0, 3)) {
    if (!beat || typeof beat !== 'object') continue;
    const item = beat as {
      motions?: unknown;
      seconds?: unknown;
      intensity?: unknown;
      direction?: unknown;
      ease?: unknown;
    };
    const kinds = Array.isArray(item.motions)
      ? item.motions.filter((motion): motion is MotionName => typeof motion === 'string' && isMotion(motion))
      : [];
    if (!kinds.length) continue;
    const ease = typeof item.ease === 'string' && EASES.has(item.ease as AnimEase)
      ? item.ease as AnimEase
      : 'easeInOut';
    beats.push({
      kinds,
      duration: Math.round(clamp(Number(item.seconds) || 3.5, 1, 12) * 20) / 20,
      intensity: clamp(Number(item.intensity) || 1, 0.45, 2),
      direction: Number(item.direction) < 0 ? -1 : 1,
      ease,
    });
  }
  if (!beats.length) return null;

  const label = beats
    .map((beat) => beat.kinds.map((kind) => MOTION_LABEL[kind as MotionName] ?? kind).join(' + '))
    .join(' → ');
  return {
    beats,
    loop: record.loop !== false,
    stagger: record.stagger === true,
    ensemble: record.stagger === true,
    clear: false,
    fallback: false,
    label,
  };
}

async function interpretLocalPrompt(prompt: string): Promise<PromptMotionPlan | null> {
  const model = await localModel();
  if (!model) return null;
  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        options: { temperature: 0.2, num_predict: 320 },
        messages: [
          {
            role: 'system',
            content: [
              'Turn a mockup motion prompt into JSON only.',
              'Schema: {"loop":boolean,"stagger":boolean,"beats":[{"motions":string[],"seconds":number,"intensity":number,"direction":number,"ease":string}]}',
              `motions must be from: ${MOTIONS.join(', ')}.`,
              'Use 1 to 3 beats. "then" starts a new beat. "while" and "and" share a beat.',
              'intensity: 0.55 subtle, 1 normal, 1.55 dramatic, 2 extreme.',
              'direction is 1, or -1 for left or counter-clockwise.',
              'ease is easeInOut, easeIn, easeOut, or linear.',
              'seconds is 1.2 to 8 per beat. loop is false for a reveal or settle.',
              'stagger is true only when several devices should move one after another.',
            ].join(' '),
          },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { message?: { content?: string } };
    return asPlan(readJson(data.message?.content ?? ''));
  } catch {
    return null;
  }
}

/**
 * Compose a clip from the prompt. Open-ended phrases ask Ollama on localhost
 * when a model is already running, then fall back to the on-device planner.
 */
export async function promptToAnimationSmart(
  prompt: string,
  clip: AnimationClip,
  devices: DeviceInstance | DeviceInstance[],
  ensemblePool?: DeviceInstance[],
  onStatus?: (status: string) => void,
): Promise<PromptAnimateResult> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return { clip, label: '', summary: 'Enter a motion prompt' };
  }

  const planned = planAnimationPrompt(trimmed);
  if (!planned.fallback) {
    return compileMotionPlan(planned, clip, devices, ensemblePool);
  }

  onStatus?.('Asking a local model…');
  const local = await interpretLocalPrompt(trimmed);
  if (!local) return compileMotionPlan(planned, clip, devices, ensemblePool);

  const compiled = compileMotionPlan(
    { ...local, ensemble: local.ensemble || planned.ensemble },
    clip,
    devices,
    ensemblePool,
  );
  return {
    ...compiled,
    summary: `Local model · ${compiled.summary}`,
  };
}
