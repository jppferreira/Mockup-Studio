import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Diamond, Gauge, KeyRound, Music2, PanelBottomClose, PanelBottomOpen, Pause, Play, Plus,
  Repeat, SkipBack, Sparkles, Trash2, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import {
  createTrack,
  formatTimecode,
  moveKeyframesByDelta,
  readProperty,
  removeKeyframes,
  resolveBezier,
  setKeyframeEase,
  upsertKeyframe,
} from '../lib/animation';
import { PROMPT_SUGGESTIONS, promptToAnimation } from '../lib/promptAnimate';
import {
  ANIM_EASES,
  ANIM_PROPERTIES,
  DEFAULT_CUSTOM_BEZIER,
  type AnimEase,
  type AnimProperty,
  type AnimTrack,
  type AnimationClip,
  type DeviceInstance,
  type EaseBezier,
} from '../types';
import EaseGraphEditor from './EaseGraphEditor';

interface Props {
  open: boolean;
  /** Hide timeline panel and collapsed bar (focus mode). */
  chromeHidden?: boolean;
  onToggle: () => void;
  clip: AnimationClip;
  onChange: (clip: AnimationClip) => void;
  currentTime: number;
  onSeek: (time: number) => void;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  selectedDevice: DeviceInstance;
  devices: DeviceInstance[];
  soundtrackName?: string | null;
  soundtrackData?: string | null;
  soundtrackStart?: number;
  soundtrackOffset?: number;
  soundtrackDuration?: number;
  soundtrackFadeIn?: number;
  soundtrackFadeOut?: number;
  onSoundtrackChange?: (next: { name: string; dataUrl: string } | null) => void;
  onSoundtrackPatch?: (patch: {
    soundtrackStart?: number;
    soundtrackOffset?: number;
    soundtrackDuration?: number;
    soundtrackFadeIn?: number;
    soundtrackFadeOut?: number;
  }) => void;
}

const MUSIC_MIN_DUR = 0.15;
const MUSIC_FADE_MAX = 8;

function soundtrackVolumeAt(localTime: number, clipDuration: number, fadeIn: number, fadeOut: number) {
  let volume = 1;
  if (fadeIn > 0) volume = Math.min(volume, Math.min(1, Math.max(0, localTime / fadeIn)));
  if (fadeOut > 0) {
    const start = Math.max(0, clipDuration - fadeOut);
    if (localTime >= start) volume = Math.min(volume, Math.max(0, (clipDuration - localTime) / fadeOut));
  }
  return Math.max(0, Math.min(1, volume));
}

function clampMusicPlacement(
  start: number,
  offset: number,
  duration: number,
  timelineDur: number,
  sourceDur: number,
) {
  const src = sourceDur > 0 ? sourceDur : timelineDur;
  let off = Math.max(0, offset);
  let dur = Math.max(MUSIC_MIN_DUR, duration);
  if (src > 0) {
    off = Math.min(off, Math.max(0, src - MUSIC_MIN_DUR));
    dur = Math.min(dur, Math.max(MUSIC_MIN_DUR, src - off));
  }
  dur = Math.min(dur, Math.max(MUSIC_MIN_DUR, timelineDur));
  const st = Math.max(0, Math.min(start, Math.max(0, timelineDur - dur)));
  return { start: st, offset: off, duration: dur };
}

function clampMusicFades(fadeIn: number, fadeOut: number, duration: number) {
  const maxEach = Math.min(MUSIC_FADE_MAX, Math.max(0, duration));
  let inn = Math.min(maxEach, Math.max(0, fadeIn));
  let out = Math.min(maxEach, Math.max(0, fadeOut));
  if (inn + out > duration) {
    const scale = duration / Math.max(inn + out, 0.0001);
    inn *= scale;
    out *= scale;
  }
  return { fadeIn: inn, fadeOut: out };
}

const MUSIC_TRACK_ID = '__soundtrack__';

/** CapCut-style gain envelope in 0–100 viewBox space for the music-bar SVG vector. */
function musicFadeEnvelopePath(fadeIn: number, fadeOut: number, duration: number) {
  const dur = Math.max(duration, 0.001);
  const samples = 36;
  let curve = '';
  let area = 'M 0 100';
  for (let i = 0; i <= samples; i++) {
    const tNorm = i / samples;
    const g = soundtrackVolumeAt(tNorm * dur, dur, fadeIn, fadeOut);
    const x = +(tNorm * 100).toFixed(2);
    const y = +(8 + (1 - g) * 84).toFixed(2);
    curve += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    area += ` L ${x} ${y}`;
  }
  area += ' L 100 100 Z';
  const fadeInPct = Math.min(50, (Math.max(0, fadeIn) / dur) * 100);
  const fadeOutPct = Math.min(50, (Math.max(0, fadeOut) / dur) * 100);
  const inGain = soundtrackVolumeAt(Math.min(dur, Math.max(0, fadeIn)), dur, fadeIn, fadeOut);
  const outGain = soundtrackVolumeAt(Math.max(0, dur - Math.max(0, fadeOut)), dur, fadeIn, fadeOut);
  return {
    curve,
    area,
    fadeInPct,
    fadeOutPct,
    inX: fadeInPct,
    outX: 100 - fadeOutPct,
    inY: 8 + (1 - inGain) * 84,
    outY: 8 + (1 - outGain) * 84,
  };
}

type MusicDrag =
  | { kind: 'move'; originX: number; start0: number }
  | { kind: 'trim-left'; originX: number; start0: number; offset0: number; duration0: number; end0: number }
  | { kind: 'trim-right'; originX: number; duration0: number }
  | { kind: 'fade-in'; originX: number; fade0: number; barLeftPx: number; barWidthPx: number }
  | { kind: 'fade-out'; originX: number; fade0: number; barLeftPx: number; barWidthPx: number };

type KeyRef = { trackId: string; keyframeId: string };

const TRACK_COLORS: Record<AnimProperty, string> = {
  'rotation.x': '#ff5a5a',
  'rotation.y': '#5dff6e',
  'rotation.z': '#4db8ff',
  'position.x': '#c9a8ff',
  'position.y': '#ff8ec8',
  'position.z': '#7aecff',
  scale: '#ffb020',
  'camera.x': '#9ad0ff',
  'camera.y': '#7ec8ff',
  'camera.z': '#5ab8ff',
};

const LONG_PRESS_MS = 280;
const MOVE_THRESHOLD_PX = 6;
const RULER_H = 32;
const LANE_H = 32;
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const ZOOM_STEP = 0.5;

const keyId = (ref: KeyRef) => `${ref.trackId}::${ref.keyframeId}`;

function easeLabel(ease: AnimEase | undefined) {
  return ANIM_EASES.find((e) => e.id === (ease ?? 'easeInOut'))?.label ?? 'Ease In-Out';
}

function easePath(ease: AnimEase | undefined, bezier?: EaseBezier): string {
  if (ease === 'custom') {
    const [x1, y1, x2, y2] = resolveBezier('custom', bezier);
    const mapX = (x: number) => 1 + x * 14;
    const mapY = (y: number) => 11 - Math.min(1.2, Math.max(-0.2, y)) * 10;
    return `M1 11 C ${mapX(x1)} ${mapY(y1)}, ${mapX(x2)} ${mapY(y2)}, 15 1`;
  }
  switch (ease ?? 'easeInOut') {
    case 'linear':
      return 'M1 11 L15 1';
    case 'easeIn':
      return 'M1 11 C 10 11, 12 6, 15 1';
    case 'easeOut':
      return 'M1 11 C 4 6, 6 1, 15 1';
    case 'easeInOut':
    default:
      return 'M1 11 C 5 11, 11 1, 15 1';
  }
}

export default function AnimationTimeline({
  open,
  chromeHidden = false,
  onToggle,
  clip,
  onChange,
  currentTime,
  onSeek,
  playing,
  onPlayingChange,
  selectedDevice,
  devices,
  soundtrackName = null,
  soundtrackData = null,
  soundtrackStart = 0,
  soundtrackOffset = 0,
  soundtrackDuration = 4,
  soundtrackFadeIn = 0.8,
  soundtrackFadeOut = 1.2,
  onSoundtrackChange,
  onSoundtrackPatch,
}: Props) {
  const scrubRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const easeWrapRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const musicBarRef = useRef<HTMLDivElement>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<KeyRef[]>([]);
  const [hoveredKeyId, setHoveredKeyId] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [musicDrag, setMusicDrag] = useState<MusicDrag | null>(null);
  const [draggingKeys, setDraggingKeys] = useState<{
    items: { trackId: string; keyframeId: string; startTime: number }[];
    originClientX: number;
  } | null>(null);
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const [easeGraphOpen, setEaseGraphOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [promptStatus, setPromptStatus] = useState<string | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const promptInputRef = useRef<HTMLInputElement>(null);
  const promptShellRef = useRef<HTMLDivElement>(null);

  const pressTimerRef = useRef<number | null>(null);
  const pressOriginRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const marqueeModeRef = useRef(false);
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;

  const musicSelected = selectedTrackId === MUSIC_TRACK_ID;
  const musicClip = useMemo(() => {
    const placed = clampMusicPlacement(
      soundtrackStart,
      soundtrackOffset,
      soundtrackDuration,
      clip.duration,
      audioDuration,
    );
    const fades = clampMusicFades(soundtrackFadeIn, soundtrackFadeOut, placed.duration);
    return { ...placed, ...fades };
  }, [
    soundtrackStart,
    soundtrackOffset,
    soundtrackDuration,
    soundtrackFadeIn,
    soundtrackFadeOut,
    clip.duration,
    audioDuration,
  ]);
  const fadeEnvelope = useMemo(
    () => musicFadeEnvelopePath(musicClip.fadeIn, musicClip.fadeOut, musicClip.duration),
    [musicClip.fadeIn, musicClip.fadeOut, musicClip.duration],
  );

  const beginMusicDrag = (event: ReactPointerEvent, drag: MusicDrag) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedTrackId(MUSIC_TRACK_ID);
    setSelectedKeys([]);
    setMusicDrag(drag);
  };

  const deviceTracks = useMemo(
    () => clip.tracks.filter((t) => t.targetId === selectedDevice.id),
    [clip.tracks, selectedDevice.id],
  );

  const visibleTracks = useMemo(() => {
    const preferred: AnimProperty[] = ['rotation.x', 'rotation.y', 'rotation.z', 'scale'];
    const byProp = new Map(deviceTracks.map((t) => [t.property, t]));
    return preferred.map((property) => {
      const existing = byProp.get(property);
      if (existing) return existing;
      return {
        id: `placeholder-${selectedDevice.id}-${property}`,
        targetId: selectedDevice.id,
        property,
        keyframes: [],
      } satisfies AnimTrack;
    });
  }, [deviceTracks, selectedDevice.id]);

  const selectedSet = useMemo(() => new Set(selectedKeys.map(keyId)), [selectedKeys]);

  const selectedEase = useMemo(() => {
    if (!selectedKeys.length) return null;
    const eases = selectedKeys.map((ref) => {
      const track = clip.tracks.find((t) => t.id === ref.trackId);
      return track?.keyframes.find((k) => k.id === ref.keyframeId)?.ease ?? 'easeInOut';
    });
    const first = eases[0];
    return eases.every((e) => e === first) ? first : 'mixed';
  }, [selectedKeys, clip.tracks]);

  const selectedBezier = useMemo((): EaseBezier | null => {
    if (!selectedKeys.length) return null;
    const beziers = selectedKeys.map((ref) => {
      const track = clip.tracks.find((t) => t.id === ref.trackId);
      const kf = track?.keyframes.find((k) => k.id === ref.keyframeId);
      return resolveBezier(kf?.ease, kf?.easeBezier);
    });
    const first = beziers[0];
    const same = beziers.every((b) => (
      b[0] === first[0] && b[1] === first[1] && b[2] === first[2] && b[3] === first[3]
    ));
    return same ? first : null;
  }, [selectedKeys, clip.tracks]);

  useEffect(() => {
    if (!selectedKeys.length) {
      setEaseGraphOpen(false);
      return;
    }
    // Auto-open only when switching into custom; don't fight a manual close.
    if (selectedEase === 'custom') setEaseGraphOpen(true);
    else setEaseGraphOpen(false);
  }, [selectedEase, selectedKeys.length]);

  // Close ease graph on outside pointer / Escape
  useEffect(() => {
    if (!easeGraphOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const root = easeWrapRef.current;
      if (!root) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      setEaseGraphOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEaseGraphOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [easeGraphOpen]);

  const xToTime = (clientX: number) => {
    const el = scrubRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(clip.duration, Math.max(0, ((clientX - rect.left) / rect.width) * clip.duration));
  };

  const ticks = useMemo(() => {
    const visibleSpan = clip.duration / Math.max(zoom, 1);
    const step = visibleSpan <= 1 ? 0.1
      : visibleSpan <= 2 ? 0.25
        : visibleSpan <= 4 ? 0.5
          : visibleSpan <= 8 ? 1
            : 2;
    const list: number[] = [];
    for (let t = 0; t <= clip.duration + 0.001; t += step) list.push(Number(t.toFixed(2)));
    return list;
  }, [clip.duration, zoom]);

  const clampZoom = (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));

  const scrollPlayheadIntoView = (time = currentTime, behavior: ScrollBehavior = 'auto') => {
    const viewport = scrollRef.current;
    const content = scrubRef.current;
    if (!viewport || !content || clip.duration <= 0) return;
    const contentWidth = content.scrollWidth || content.offsetWidth;
    const playheadX = (time / clip.duration) * contentWidth;
    const target = playheadX - viewport.clientWidth / 2;
    viewport.scrollTo({ left: Math.max(0, target), behavior });
  };

  const applyZoom = (nextZoom: number, anchorTime = currentTime) => {
    const clamped = clampZoom(nextZoom);
    setZoom(clamped);
    requestAnimationFrame(() => scrollPlayheadIntoView(anchorTime));
  };
  const applyZoomRef = useRef(applyZoom);
  applyZoomRef.current = applyZoom;

  const zoomBy = (delta: number) => applyZoom(zoom + delta);

  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const clipRef = useRef(clip);
  clipRef.current = clip;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const onPlayingChangeRef = useRef(onPlayingChange);
  onPlayingChangeRef.current = onPlayingChange;
  const visibleTracksRef = useRef(visibleTracks);
  visibleTracksRef.current = visibleTracks;

  const clearPressTimer = () => {
    if (pressTimerRef.current != null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!playing || scrubbing || draggingKeys || marquee) return undefined;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const { duration, loop } = clipRef.current;
      let next = currentTimeRef.current + dt;
      if (next >= duration) {
        if (loop) next %= duration;
        else {
          next = duration;
          onPlayingChangeRef.current(false);
        }
      }
      onSeekRef.current(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, scrubbing, draggingKeys, marquee]);

  const updateTrack = (trackId: string, updater: (track: AnimTrack) => AnimTrack) => {
    const exists = clip.tracks.some((t) => t.id === trackId);
    if (!exists) {
      const draft = visibleTracks.find((t) => t.id === trackId);
      if (!draft) return;
      onChange({ ...clip, tracks: [...clip.tracks, updater(draft)] });
      return;
    }
    onChange({
      ...clip,
      tracks: clip.tracks.map((t) => (t.id === trackId ? updater(t) : t)),
    });
  };

  const keyProperty = (property: AnimProperty, time = currentTime, value = readProperty(selectedDevice, property)) => {
    const existing = clip.tracks.find((t) => t.targetId === selectedDevice.id && t.property === property);
    const base = existing ?? createTrack(selectedDevice.id, property);
    const next = upsertKeyframe(base, time, value);
    onChange({
      ...clip,
      tracks: existing
        ? clip.tracks.map((t) => (t.id === existing.id ? next : t))
        : [...clip.tracks, next],
    });
  };

  const addKeyframeAtPlayhead = (property?: AnimProperty) => {
    const props = property
      ? [property]
      : (['rotation.x', 'rotation.y', 'rotation.z', 'scale'] as AnimProperty[]);
    let tracks = [...clip.tracks];
    for (const prop of props) {
      const existing = tracks.find((t) => t.targetId === selectedDevice.id && t.property === prop);
      const base = existing ?? createTrack(selectedDevice.id, prop);
      const value = readProperty(selectedDevice, prop);
      const next = upsertKeyframe(base, currentTime, value);
      if (existing) tracks = tracks.map((t) => (t.id === existing.id ? next : t));
      else tracks = [...tracks, next];
    }
    onChange({ ...clip, tracks });
  };

  const keysInMarquee = (box: { x0: number; y0: number; x1: number; y1: number }): KeyRef[] => {
    const el = scrubRef.current;
    if (!el) return [];
    const rect = el.getBoundingClientRect();
    const left = Math.min(box.x0, box.x1) - rect.left;
    const right = Math.max(box.x0, box.x1) - rect.left;
    const top = Math.min(box.y0, box.y1) - rect.top;
    const bottom = Math.max(box.y0, box.y1) - rect.top;
    if (right - left < 2 && bottom - top < 2) return [];

    const hits: KeyRef[] = [];
    visibleTracksRef.current.forEach((track, laneIndex) => {
      const live = clipRef.current.tracks.find(
        (t) => t.targetId === selectedDevice.id && t.property === track.property,
      ) ?? track;
      if (live.id.startsWith('placeholder-')) return;
      const laneTop = RULER_H + laneIndex * LANE_H;
      const laneBottom = laneTop + LANE_H;
      if (laneBottom < top || laneTop > bottom) return;
      for (const kf of live.keyframes) {
        const x = (kf.time / clipRef.current.duration) * rect.width;
        if (x >= left - 8 && x <= right + 8) {
          hits.push({ trackId: live.id, keyframeId: kf.id });
        }
      }
    });
    return hits;
  };

  const beginScrub = (event: ReactPointerEvent, opts?: { fromPlayhead?: boolean }) => {
    if (draggingKeys || musicDrag || marqueeModeRef.current) return;
    if ((event.target as HTMLElement | null)?.closest?.('.timeline-key')) return;
    if ((event.target as HTMLElement | null)?.closest?.('.timeline-ease')) return;
    event.preventDefault();
    event.stopPropagation();
    onPlayingChange(false);

    if (opts?.fromPlayhead) {
      clearPressTimer();
      pressOriginRef.current = null;
      marqueeModeRef.current = false;
      setScrubbing(true);
      onSeek(xToTime(event.clientX));
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      return;
    }

    // Pending: short drag → scrub; long-press then drag → marquee multi-select
    clearPressTimer();
    marqueeModeRef.current = false;
    setMarquee(null);
    pressOriginRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);

    pressTimerRef.current = window.setTimeout(() => {
      const origin = pressOriginRef.current;
      if (!origin) return;
      marqueeModeRef.current = true;
      setScrubbing(false);
      setSelectedKeys([]);
      setMarquee({ x0: origin.x, y0: origin.y, x1: origin.x, y1: origin.y });
    }, LONG_PRESS_MS);
  };

  const onScrubMove = (event: ReactPointerEvent) => {
    const origin = pressOriginRef.current;
    if (origin && !marqueeModeRef.current && !scrubbing && !draggingKeys) {
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      if (Math.hypot(dx, dy) > MOVE_THRESHOLD_PX) {
        clearPressTimer();
        setScrubbing(true);
        setSelectedKeys([]);
        onSeek(xToTime(event.clientX));
      }
      return;
    }

    if (marqueeModeRef.current && origin) {
      const next = { x0: origin.x, y0: origin.y, x1: event.clientX, y1: event.clientY };
      setMarquee(next);
      setSelectedKeys(keysInMarquee(next));
      return;
    }

    if (!scrubbing || draggingKeys) return;
    onSeek(xToTime(event.clientX));
  };

  const endScrub = (event: ReactPointerEvent) => {
    const wasMarquee = marqueeModeRef.current;
    const hadPending = pressOriginRef.current != null && !scrubbing && !wasMarquee;
    clearPressTimer();
    pressOriginRef.current = null;
    marqueeModeRef.current = false;

    if (wasMarquee) {
      const box = marqueeRef.current;
      if (box) setSelectedKeys(keysInMarquee(box));
      setMarquee(null);
      try {
        (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
      } catch {
        /* already released */
      }
      return;
    }

    if (hadPending) {
      // Tap without drag/long-press: seek + clear selection
      setSelectedKeys([]);
      onSeek(xToTime(event.clientX));
    }

    if (!scrubbing) {
      try {
        (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
      } catch {
        /* already released */
      }
      return;
    }
    setScrubbing(false);
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    } catch {
      /* already released */
    }
  };

  useEffect(() => {
    if (!draggingKeys) return undefined;
    const onMove = (event: PointerEvent) => {
      const el = scrubRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const deltaPct = (event.clientX - draggingKeys.originClientX) / Math.max(1, rect.width);
      const deltaTime = deltaPct * clipRef.current.duration;
      onChangeRef.current(moveKeyframesByDelta(
        clipRef.current,
        draggingKeys.items,
        deltaTime,
        clipRef.current.duration,
      ));
    };
    const onUp = () => setDraggingKeys(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [draggingKeys]);

  useEffect(() => {
    if (!musicDrag || !onSoundtrackPatch) return undefined;
    const onMove = (event: PointerEvent) => {
      const timelineDur = clipRef.current.duration;
      const sourceDur = audioDuration > 0 ? audioDuration : timelineDur;
      const lanes = scrubRef.current?.getBoundingClientRect();
      const dt = lanes && lanes.width > 0
        ? ((event.clientX - musicDrag.originX) / lanes.width) * timelineDur
        : 0;

      if (musicDrag.kind === 'move') {
        const next = clampMusicPlacement(
          musicDrag.start0 + dt,
          soundtrackOffset,
          soundtrackDuration,
          timelineDur,
          sourceDur,
        );
        onSoundtrackPatch({ soundtrackStart: next.start });
        return;
      }

      if (musicDrag.kind === 'trim-right') {
        const maxDur = Math.min(
          sourceDur - soundtrackOffset,
          timelineDur - soundtrackStart,
        );
        const nextDur = Math.max(MUSIC_MIN_DUR, Math.min(maxDur, musicDrag.duration0 + dt));
        const fades = clampMusicFades(soundtrackFadeIn, soundtrackFadeOut, nextDur);
        onSoundtrackPatch({
          soundtrackDuration: nextDur,
          soundtrackFadeIn: fades.fadeIn,
          soundtrackFadeOut: fades.fadeOut,
        });
        return;
      }

      if (musicDrag.kind === 'trim-left') {
        // Keep timeline end fixed; slide start + source offset together.
        const end = musicDrag.end0;
        let nextStart = musicDrag.start0 + dt;
        nextStart = Math.max(0, Math.min(nextStart, end - MUSIC_MIN_DUR));
        const startDelta = nextStart - musicDrag.start0;
        let nextOffset = musicDrag.offset0 + startDelta;
        nextOffset = Math.max(0, Math.min(nextOffset, sourceDur - MUSIC_MIN_DUR));
        // Reconcile if offset hit a wall.
        nextStart = musicDrag.start0 + (nextOffset - musicDrag.offset0);
        nextStart = Math.max(0, Math.min(nextStart, end - MUSIC_MIN_DUR));
        const nextDur = Math.max(MUSIC_MIN_DUR, end - nextStart);
        const maxFromSource = Math.max(MUSIC_MIN_DUR, sourceDur - nextOffset);
        const duration = Math.min(nextDur, maxFromSource);
        const fades = clampMusicFades(soundtrackFadeIn, soundtrackFadeOut, duration);
        onSoundtrackPatch({
          soundtrackStart: end - duration,
          soundtrackOffset: nextOffset,
          soundtrackDuration: duration,
          soundtrackFadeIn: fades.fadeIn,
          soundtrackFadeOut: fades.fadeOut,
        });
        return;
      }

      if (musicDrag.kind === 'fade-in') {
        const localX = event.clientX - musicDrag.barLeftPx;
        const nextFade = Math.max(
          0,
          Math.min(
            MUSIC_FADE_MAX,
            musicClip.duration - musicClip.fadeOut,
            (localX / Math.max(1, musicDrag.barWidthPx)) * musicClip.duration,
          ),
        );
        onSoundtrackPatch({ soundtrackFadeIn: nextFade });
        return;
      }

      if (musicDrag.kind === 'fade-out') {
        const localX = event.clientX - musicDrag.barLeftPx;
        const fromEnd = musicClip.duration - (localX / Math.max(1, musicDrag.barWidthPx)) * musicClip.duration;
        const nextFade = Math.max(
          0,
          Math.min(MUSIC_FADE_MAX, musicClip.duration - musicClip.fadeIn, fromEnd),
        );
        onSoundtrackPatch({ soundtrackFadeOut: nextFade });
      }
    };
    const onUp = () => setMusicDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [
    musicDrag,
    onSoundtrackPatch,
    soundtrackOffset,
    soundtrackDuration,
    soundtrackStart,
    soundtrackFadeIn,
    soundtrackFadeOut,
    audioDuration,
    musicClip.duration,
    musicClip.fadeIn,
    musicClip.fadeOut,
  ]);

  const deleteSelectedKeyframes = () => {
    if (selectedKeys.length) {
      onChange(removeKeyframes(clip, selectedKeys));
      setSelectedKeys([]);
      return;
    }
    if (hoveredKeyId) {
      for (const track of clip.tracks) {
        if (track.keyframes.some((k) => k.id === hoveredKeyId)) {
          onChange(removeKeyframes(clip, [{ trackId: track.id, keyframeId: hoveredKeyId }]));
          return;
        }
      }
    }
    if (!selectedTrackId) return;
    const track = clip.tracks.find((t) => t.id === selectedTrackId);
    if (!track?.keyframes.length) return;
    const nearest = [...track.keyframes].sort((a, b) => Math.abs(a.time - currentTime) - Math.abs(b.time - currentTime))[0];
    if (!nearest || Math.abs(nearest.time - currentTime) > 0.2) return;
    onChange(removeKeyframes(clip, [{ trackId: track.id, keyframeId: nearest.id }]));
  };

  const applyEaseToSelection = (ease: AnimEase, bezier?: EaseBezier) => {
    if (!selectedKeys.length) return;
    const ids = new Set(selectedKeys.map(keyId));
    onChange({
      ...clip,
      tracks: clip.tracks.map((track) => {
        let next = track;
        for (const kf of track.keyframes) {
          if (ids.has(`${track.id}::${kf.id}`)) {
            next = setKeyframeEase(next, kf.id, ease, bezier);
          }
        }
        return next;
      }),
    });
    if (ease === 'custom') setEaseGraphOpen(true);
    else setEaseGraphOpen(false);
  };

  const applyBezierToSelection = (bezier: EaseBezier) => {
    applyEaseToSelection('custom', bezier);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const clearKey = event.key === 'Delete' || event.key === 'Backspace' || event.key === 'Clear'
        || event.code === 'Delete' || event.code === 'Backspace' || event.code === 'NumpadDecimal';
      if (!clearKey) return;
      if (!selectedKeys.length && !hoveredKeyId && !selectedTrackId) return;
      event.preventDefault();
      event.stopPropagation();
      deleteSelectedKeyframes();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useEffect(() => () => clearPressTimer(), []);

  // Keep the playhead visible while playing when zoomed in
  useEffect(() => {
    if (!playing || zoom <= 1 || scrubbing || draggingKeys || marquee) return;
    scrollPlayheadIntoView(currentTime);
  }, [currentTime, playing, zoom, scrubbing, draggingKeys, marquee]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Scroll over the timeline lanes zooms in/out (anchor under cursor).
  // Trackpad sideways swipe pans when zoomed; Shift+scroll also pans.
  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return undefined;
    const onWheel = (event: WheelEvent) => {
      const absX = Math.abs(event.deltaX);
      const absY = Math.abs(event.deltaY);
      const wantsPan = event.shiftKey || absX > absY;

      if (wantsPan) {
        if (zoomRef.current <= 1) return;
        event.preventDefault();
        const delta = event.shiftKey && absY >= absX ? event.deltaY : event.deltaX;
        viewport.scrollLeft += delta;
        return;
      }

      if (absY < 0.5) return;
      event.preventDefault();
      const content = scrubRef.current;
      const rect = content?.getBoundingClientRect();
      const duration = clipRef.current.duration;
      const anchor = rect && rect.width > 0
        ? ((event.clientX - rect.left) / rect.width) * duration
        : currentTimeRef.current;
      // Scale step by wheel intensity so trackpads feel smooth and mice stay snappy.
      const units = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const steps = Math.max(0.15, Math.min(1.5, Math.abs(units) / 80));
      const direction = units > 0 ? -1 : 1;
      applyZoomRef.current(zoomRef.current + direction * ZOOM_STEP * steps, anchor);
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, []);

  const deviceLabel = (id: string) => {
    const index = devices.findIndex((d) => d.id === id);
    return index >= 0 ? `Device ${index + 1}` : 'Device';
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!soundtrackData) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      setAudioDuration(0);
      return;
    }
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setAudioDuration(audio.duration);
      }
    };
    audio.addEventListener('loadedmetadata', onMeta);
    if (audio.getAttribute('src') !== soundtrackData) {
      audio.src = soundtrackData;
      audio.load();
    } else {
      onMeta();
    }
    audio.loop = false;
    return () => audio.removeEventListener('loadedmetadata', onMeta);
  }, [soundtrackData]);

  // Fit newly loaded audio into the timeline window once metadata arrives.
  useEffect(() => {
    if (!soundtrackData || !onSoundtrackPatch || audioDuration <= 0 || musicDrag) return;
    const fitted = clampMusicPlacement(
      soundtrackStart,
      soundtrackOffset,
      soundtrackDuration > 0 ? soundtrackDuration : Math.min(audioDuration, clip.duration),
      clip.duration,
      audioDuration,
    );
    const fades = clampMusicFades(soundtrackFadeIn, soundtrackFadeOut, fitted.duration);
    const needsPatch = Math.abs(fitted.start - soundtrackStart) > 0.001
      || Math.abs(fitted.offset - soundtrackOffset) > 0.001
      || Math.abs(fitted.duration - soundtrackDuration) > 0.001
      || Math.abs(fades.fadeIn - soundtrackFadeIn) > 0.001
      || Math.abs(fades.fadeOut - soundtrackFadeOut) > 0.001;
    if (needsPatch) {
      onSoundtrackPatch({
        soundtrackStart: fitted.start,
        soundtrackOffset: fitted.offset,
        soundtrackDuration: fitted.duration,
        soundtrackFadeIn: fades.fadeIn,
        soundtrackFadeOut: fades.fadeOut,
      });
    }
  }, [audioDuration, soundtrackData]); // eslint-disable-line react-hooks/exhaustive-deps -- fit once when source length is known

  const syncMusicAudio = (audio: HTMLAudioElement, play: boolean) => {
    const local = currentTime - musicClip.start;
    const inWindow = local >= 0 && local <= musicClip.duration;
    const sourceTime = musicClip.offset + Math.max(0, Math.min(musicClip.duration, local));
    audio.volume = inWindow
      ? soundtrackVolumeAt(local, musicClip.duration, musicClip.fadeIn, musicClip.fadeOut)
      : 0;
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const target = Math.min(Math.max(0, sourceTime), audio.duration);
    if (!inWindow) {
      audio.pause();
      return;
    }
    if (Math.abs((audio.currentTime || 0) - target) > 0.08) {
      audio.currentTime = target;
    }
    if (play) {
      void audio.play().catch(() => { /* autoplay / decode */ });
    } else {
      audio.pause();
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !soundtrackData) return;
    syncMusicAudio(audio, playing);
  }, [playing, soundtrackData]); // eslint-disable-line react-hooks/exhaustive-deps -- seek on play edge only

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !soundtrackData) return;
    syncMusicAudio(audio, playing);
  }, [
    currentTime,
    playing,
    soundtrackData,
    musicClip.start,
    musicClip.offset,
    musicClip.duration,
    musicClip.fadeIn,
    musicClip.fadeOut,
  ]);

  const onAudioPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !onSoundtrackChange) return;
    if (!/^audio\//.test(file.type) && !/\.(mp3|wav|ogg|m4a|aac)$/i.test(file.name)) return;
    if (file.size > 15 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : null;
      if (!dataUrl) return;
      onSoundtrackChange({
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Soundtrack',
        dataUrl,
      });
    };
    reader.readAsDataURL(file);
  };

  const closePrompt = () => {
    setPromptOpen(false);
    setPromptStatus(null);
  };

  const openPrompt = () => {
    setPromptOpen(true);
    setPromptStatus(null);
  };

  useEffect(() => {
    if (!open || chromeHidden) closePrompt();
  }, [open, chromeHidden]);

  useEffect(() => {
    if (!promptOpen) return;
    const id = window.requestAnimationFrame(() => {
      promptInputRef.current?.focus();
    });
    const onPointerDown = (event: PointerEvent) => {
      if (!promptShellRef.current?.contains(event.target as Node)) {
        closePrompt();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePrompt();
        promptInputRef.current?.blur();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(id);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [promptOpen]);

  const runPrompt = (raw: string) => {
    const text = raw.trim();
    if (!text || promptBusy) return;
    setPromptBusy(true);
    try {
      const result = promptToAnimation(text, clip, selectedDevice);
      onChange(result.clip);
      onSeek(0);
      onPlayingChange(result.label !== 'Clear');
      setPromptStatus(result.summary);
      setPrompt('');
      setPromptOpen(true);
    } finally {
      window.setTimeout(() => setPromptBusy(false), 120);
    }
  };

  const onPromptSubmit = (event: FormEvent) => {
    event.preventDefault();
    runPrompt(prompt);
  };

  const playheadPct = clip.duration <= 0 ? 0 : (currentTime / clip.duration) * 100;

  const marqueeStyle = (() => {
    if (!marquee || !scrubRef.current) return null;
    const rect = scrubRef.current.getBoundingClientRect();
    const left = Math.min(marquee.x0, marquee.x1) - rect.left;
    const top = Math.min(marquee.y0, marquee.y1) - rect.top;
    const width = Math.abs(marquee.x1 - marquee.x0);
    const height = Math.abs(marquee.y1 - marquee.y0);
    return { left, top, width, height };
  })();

  const panelVisible = open && !chromeHidden;

  return (
    <>
    <div className={`timeline-panel ${panelVisible ? 'is-open' : 'is-closed'}`} ref={panelRef} tabIndex={-1} aria-hidden={!panelVisible}>
      <div className={`timeline-chrome ${promptOpen ? 'is-prompting' : ''}`}>
        <div
          ref={promptShellRef}
          className={`timeline-prompt ${promptOpen ? 'is-open' : 'is-compact'}`}
        >
          {!promptOpen ? (
            <button
              type="button"
              className="timeline-prompt-trigger"
              onClick={openPrompt}
              aria-expanded={false}
              aria-controls="timeline-prompt-panel"
            >
              <Sparkles size={14} aria-hidden />
              <span>AI Animate</span>
            </button>
          ) : (
            <form
              id="timeline-prompt-panel"
              className="timeline-prompt-form"
              onSubmit={onPromptSubmit}
            >
              <div className="timeline-prompt-field">
                <Sparkles size={14} className="timeline-prompt-icon" aria-hidden />
                <input
                  ref={promptInputRef}
                  type="text"
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    if (promptStatus) setPromptStatus(null);
                  }}
                  placeholder="Describe a motion…"
                  aria-label="Animate with prompt"
                  disabled={promptBusy}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="submit"
                  className="timeline-prompt-go"
                  disabled={promptBusy || !prompt.trim()}
                  title="Generate animation"
                >
                  Go
                </button>
              </div>
              <div className="timeline-prompt-meta">
                {promptStatus ? (
                  <span className="timeline-prompt-status">{promptStatus}</span>
                ) : (
                  <div className="timeline-prompt-chips" role="list">
                    {PROMPT_SUGGESTIONS.slice(0, 5).map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        role="listitem"
                        className="timeline-prompt-chip"
                        onClick={() => runPrompt(chip)}
                        title={`Animate: ${chip}`}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </form>
          )}
        </div>

        {!promptOpen && (
          <div className="timeline-transport" aria-hidden={false}>
            <div className="timeline-transport-cluster" role="group" aria-label="Playback">
              <button type="button" className="timeline-icon-btn" title="Go to start" onClick={() => { onPlayingChange(false); onSeek(0); }}>
                <SkipBack size={14} />
              </button>
              <button
                type="button"
                className={`timeline-play-btn ${playing ? 'is-playing' : ''}`}
                title={playing ? 'Pause (Space)' : 'Play (Space)'}
                onClick={() => onPlayingChange(!playing)}
              >
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <button
                type="button"
                className={`timeline-icon-btn ${clip.loop ? 'is-active' : ''}`}
                title={clip.loop ? 'Loop on — click to play once' : 'Loop off — click to loop'}
                aria-label={clip.loop ? 'Disable loop' : 'Enable loop'}
                aria-pressed={clip.loop}
                onClick={() => onChange({ ...clip, loop: !clip.loop })}
              >
                <Repeat size={14} />
              </button>
              <span className="timeline-timecode" title={`${deviceLabel(selectedDevice.id)} playhead`}>
                {formatTimecode(currentTime, clip.fps)}
                <span>/ {formatTimecode(clip.duration, clip.fps)}</span>
              </span>
            </div>

            <span className="timeline-transport-divider" aria-hidden />

            <div className="timeline-transport-cluster" role="group" aria-label="Keyframes">
              <button type="button" className="timeline-icon-btn" onClick={() => addKeyframeAtPlayhead()} title="Key current transform">
                <Diamond size={13} />
              </button>
              <button type="button" className="timeline-icon-btn" onClick={() => addKeyframeAtPlayhead('rotation.y')} title="Key rotate Y">
                <KeyRound size={13} />
              </button>
              <div
                ref={easeWrapRef}
                className={`timeline-ease-wrap ${selectedKeys.length ? 'is-armed' : ''} ${easeGraphOpen ? 'is-open' : ''}`}
              >
                <label
                  className={`timeline-ease-select ${selectedKeys.length ? 'is-armed' : ''}`}
                  title="Ease from selected keyframe(s) to the next"
                >
                  <select
                    value={selectedEase === 'mixed' ? '' : (selectedEase ?? 'easeInOut')}
                    disabled={!selectedKeys.length}
                    aria-label="Keyframe ease"
                    onChange={(e) => applyEaseToSelection(e.target.value as AnimEase)}
                  >
                    {selectedEase === 'mixed' && <option value="" disabled>Mixed</option>}
                    {ANIM_EASES.map((ease) => (
                      <option key={ease.id} value={ease.id}>{ease.label}</option>
                    ))}
                  </select>
                </label>
                {selectedKeys.length > 0 && (
                  <button
                    type="button"
                    className={`timeline-icon-btn timeline-ease-graph-toggle ${easeGraphOpen ? 'is-open' : ''} ${selectedEase === 'custom' ? 'is-custom' : ''}`}
                    title={easeGraphOpen ? 'Hide ease graph' : 'Edit custom ease curve'}
                    aria-expanded={easeGraphOpen}
                    onClick={() => {
                      if (selectedEase !== 'custom') {
                        applyEaseToSelection('custom');
                        return;
                      }
                      setEaseGraphOpen((open) => !open);
                    }}
                  >
                    <Gauge size={13} />
                  </button>
                )}
                {easeGraphOpen && selectedKeys.length > 0 && (
                  <div
                    className="timeline-ease-popover"
                    role="dialog"
                    aria-label="Custom ease curve"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <div className="timeline-ease-popover-head">
                      <span>Custom ease</span>
                      <button type="button" className="timeline-ease-popover-close" onClick={() => setEaseGraphOpen(false)} title="Close (Esc)">×</button>
                    </div>
                    <EaseGraphEditor
                      value={selectedBezier ?? DEFAULT_CUSTOM_BEZIER}
                      onChange={applyBezierToSelection}
                    />
                  </div>
                )}
              </div>
              <button
                type="button"
                className={`timeline-icon-btn timeline-delete-btn ${selectedKeys.length || hoveredKeyId ? 'is-armed' : ''}`}
                onClick={deleteSelectedKeyframes}
                title="Delete selected / hovered keyframe (Delete · Backspace · Clear)"
              >
                <Trash2 size={13} />
                {selectedKeys.length > 1 ? <span className="timeline-delete-count">{selectedKeys.length}</span> : null}
              </button>
            </div>

            <span className="timeline-transport-divider" aria-hidden />

            <div className="timeline-transport-cluster" role="group" aria-label="Timeline options">
              {onSoundtrackChange && (
                <div className={`timeline-music ${soundtrackData ? 'has-track' : ''}`}>
                  <audio ref={audioRef} preload="metadata" aria-hidden />
                  <input
                    ref={audioInputRef}
                    type="file"
                    accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/mp4,audio/x-m4a,audio/aac,.mp3,.wav,.ogg,.m4a,.aac"
                    hidden
                    onChange={onAudioPicked}
                  />
                  <button
                    type="button"
                    className={`timeline-icon-btn ${soundtrackData ? 'is-active' : ''}`}
                    title={soundtrackData ? `Soundtrack: ${soundtrackName || 'Track'} — click to replace` : 'Add soundtrack'}
                    aria-label={soundtrackData ? `Soundtrack ${soundtrackName || 'Track'}` : 'Add soundtrack'}
                    onClick={() => audioInputRef.current?.click()}
                  >
                    <Music2 size={13} />
                  </button>
                  {soundtrackData && (
                    <button
                      type="button"
                      className="timeline-icon-btn timeline-music-clear"
                      title="Remove soundtrack"
                      aria-label="Remove soundtrack"
                      onClick={() => onSoundtrackChange(null)}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              )}
              <div className="timeline-zoom" title="Scroll over the timeline to zoom">
                <button
                  type="button"
                  className="timeline-icon-btn"
                  title="Zoom out"
                  disabled={zoom <= ZOOM_MIN}
                  onClick={() => zoomBy(-ZOOM_STEP)}
                >
                  <ZoomOut size={13} />
                </button>
                <button
                  type="button"
                  className="timeline-zoom-level"
                  title="Reset zoom"
                  onClick={() => applyZoom(1)}
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  className="timeline-icon-btn"
                  title="Zoom in"
                  disabled={zoom >= ZOOM_MAX}
                  onClick={() => zoomBy(ZOOM_STEP)}
                >
                  <ZoomIn size={13} />
                </button>
              </div>
              <label className="timeline-duration" title="Clip duration">
                <input
                  type="number"
                  min={1}
                  max={30}
                  step={0.5}
                  value={clip.duration}
                  aria-label="Duration in seconds"
                  onChange={(e) => onChange({ ...clip, duration: Math.min(30, Math.max(1, Number(e.target.value) || 4)) })}
                />
                <span>s</span>
              </label>
            </div>
          </div>
        )}

        <div className="timeline-chrome-end">
          <button
            type="button"
            className={`timeline-panel-toggle ${open ? 'is-open' : ''}`}
            aria-label={open ? 'Collapse timeline' : 'Expand timeline'}
            aria-expanded={open}
            title={open ? 'Collapse timeline' : 'Expand timeline'}
            onClick={onToggle}
          >
            {open
              ? <PanelBottomClose size={15} strokeWidth={2.2} aria-hidden />
              : <PanelBottomOpen size={15} strokeWidth={2.2} aria-hidden />}
          </button>
        </div>
      </div>

      <div className="timeline-body">
        <div className="timeline-labels">
          <div className="timeline-ruler-spacer">Tracks</div>
          {visibleTracks.map((track) => {
            const meta = ANIM_PROPERTIES.find((p) => p.id === track.property);
            return (
              <div
                key={track.id}
                className={`timeline-label-row ${selectedTrackId === track.id ? 'selected' : ''}`}
                onClick={() => setSelectedTrackId(track.id)}
              >
                <span className="timeline-swatch" style={{ background: TRACK_COLORS[track.property] }} />
                <span>{meta?.label ?? track.property}</span>
                <button
                  type="button"
                  className="timeline-mini-add"
                  title="Add keyframe"
                  onClick={(e) => {
                    e.stopPropagation();
                    keyProperty(track.property);
                  }}
                >
                  <Plus size={12} />
                </button>
              </div>
            );
          })}
          {onSoundtrackChange && (
            <div
              className={`timeline-label-row timeline-music-label-row ${soundtrackData ? 'has-track' : 'is-empty'} ${musicSelected ? 'selected' : ''}`}
              onClick={() => {
                if (!soundtrackData) return;
                setSelectedTrackId(MUSIC_TRACK_ID);
                setSelectedKeys([]);
              }}
            >
              <span className="timeline-swatch timeline-music-swatch" />
              {soundtrackData ? (
                <>
                  <span className="timeline-music-label-text" title={soundtrackName || 'Music'}>
                    {soundtrackName || 'Music'}
                  </span>
                  {onSoundtrackPatch && musicSelected && (
                    <span className="timeline-music-fade-controls" onPointerDown={(e) => e.stopPropagation()}>
                      <label title="Fade in">
                        In
                        <input
                          type="number"
                          min={0}
                          max={8}
                          step={0.1}
                          value={Number(musicClip.fadeIn.toFixed(1))}
                          onChange={(e) => {
                            const fades = clampMusicFades(
                              Math.min(MUSIC_FADE_MAX, Math.max(0, Number(e.target.value) || 0)),
                              musicClip.fadeOut,
                              musicClip.duration,
                            );
                            onSoundtrackPatch({
                              soundtrackFadeIn: fades.fadeIn,
                              soundtrackFadeOut: fades.fadeOut,
                            });
                          }}
                        />
                      </label>
                      <label title="Fade out">
                        Out
                        <input
                          type="number"
                          min={0}
                          max={8}
                          step={0.1}
                          value={Number(musicClip.fadeOut.toFixed(1))}
                          onChange={(e) => {
                            const fades = clampMusicFades(
                              musicClip.fadeIn,
                              Math.min(MUSIC_FADE_MAX, Math.max(0, Number(e.target.value) || 0)),
                              musicClip.duration,
                            );
                            onSoundtrackPatch({
                              soundtrackFadeIn: fades.fadeIn,
                              soundtrackFadeOut: fades.fadeOut,
                            });
                          }}
                        />
                      </label>
                    </span>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="timeline-music-add-label"
                  title="Add soundtrack"
                  onClick={() => audioInputRef.current?.click()}
                >
                  <Music2 size={12} />
                  Music
                </button>
              )}
            </div>
          )}
        </div>

        <div className="timeline-lanes-viewport" ref={scrollRef}>
        <div
          ref={scrubRef}
          className={[
            'timeline-lanes',
            scrubbing ? 'is-scrubbing' : '',
            draggingKeys ? 'is-dragging-key' : '',
            musicDrag ? 'is-dragging-music' : '',
            marquee ? 'is-marquee' : '',
          ].filter(Boolean).join(' ')}
          style={{ width: `${zoom * 100}%`, minWidth: '100%' }}
          onPointerDown={beginScrub}
          onPointerMove={onScrubMove}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
        >
          <div className="timeline-ruler">
            {ticks.map((t) => (
              <span key={t} className="timeline-tick" style={{ left: `${(t / clip.duration) * 100}%` }}>
                <i />
                {t % 1 === 0 || zoom >= 3 ? `${t % 1 === 0 ? t : t.toFixed(2)}s` : ''}
              </span>
            ))}
          </div>

          {visibleTracks.map((track) => {
            const live = clip.tracks.find((t) => t.targetId === selectedDevice.id && t.property === track.property) ?? track;
            const sorted = live.keyframes;
            return (
              <div
                key={track.id}
                className={`timeline-lane ${selectedTrackId === live.id ? 'selected' : ''}`}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const time = xToTime(e.clientX);
                  onPlayingChange(false);
                  onSeek(time);
                  keyProperty(track.property, time);
                  setSelectedTrackId(live.id);
                }}
              >
                <div className="timeline-lane-fill" style={{ background: `${TRACK_COLORS[track.property]}22` }} />
                {sorted.slice(0, -1).map((kf, index) => {
                  const next = sorted[index + 1];
                  const leftPct = (kf.time / clip.duration) * 100;
                  const widthPct = ((next.time - kf.time) / clip.duration) * 100;
                  const ease = kf.ease ?? 'easeInOut';
                  return (
                    <button
                      key={`ease-${kf.id}`}
                      type="button"
                      className={`timeline-ease ${selectedSet.has(keyId({ trackId: live.id, keyframeId: kf.id })) ? 'is-selected' : ''}`}
                      style={{
                        left: `${leftPct}%`,
                        width: `${Math.max(widthPct, 0)}%`,
                        color: TRACK_COLORS[track.property],
                      }}
                      title={`${easeLabel(ease)} → next key${ease === 'custom' ? ' · double-click to edit graph' : ''}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTrackId(live.id);
                        setSelectedKeys([{ trackId: live.id, keyframeId: kf.id }]);
                        onSeek(kf.time);
                        panelRef.current?.focus({ preventScroll: true });
                        if (ease === 'custom') setEaseGraphOpen(true);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        const ref = { trackId: live.id, keyframeId: kf.id };
                        setSelectedTrackId(live.id);
                        setSelectedKeys([ref]);
                        onChange({
                          ...clip,
                          tracks: clip.tracks.map((track) => (
                            track.id === live.id
                              ? setKeyframeEase(track, kf.id, 'custom', kf.easeBezier)
                              : track
                          )),
                        });
                        setEaseGraphOpen(true);
                      }}
                    >
                      <svg viewBox="0 0 16 12" width="16" height="10" aria-hidden>
                        <path d={easePath(ease, kf.easeBezier)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </button>
                  );
                })}
                {sorted.map((kf) => {
                  const ref = { trackId: live.id, keyframeId: kf.id };
                  const isSelected = selectedSet.has(keyId(ref));
                  const isHovered = hoveredKeyId === kf.id;
                  const isDragging = draggingKeys?.items.some((item) => item.keyframeId === kf.id);
                  return (
                    <button
                      key={kf.id}
                      type="button"
                      className={[
                        'timeline-key',
                        isSelected ? 'is-selected' : '',
                        isHovered ? 'is-hovered' : '',
                        isDragging ? 'is-dragging' : '',
                      ].filter(Boolean).join(' ')}
                      style={{ left: `${(kf.time / clip.duration) * 100}%`, color: TRACK_COLORS[track.property] }}
                      title={`${kf.value.toFixed(1)} @ ${kf.time.toFixed(2)}s · ${easeLabel(kf.ease)} — Shift-click add, long-press drag to multi-select`}
                      aria-pressed={isSelected}
                      onMouseEnter={() => setHoveredKeyId(kf.id)}
                      onMouseLeave={() => setHoveredKeyId((id) => (id === kf.id ? null : id))}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        onPlayingChange(false);
                        setSelectedTrackId(live.id);
                        clearPressTimer();
                        marqueeModeRef.current = false;
                        setMarquee(null);
                        setScrubbing(false);

                        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
                        let nextSelection: KeyRef[];
                        if (additive) {
                          const exists = selectedSet.has(keyId(ref));
                          nextSelection = exists
                            ? selectedKeys.filter((k) => keyId(k) !== keyId(ref))
                            : [...selectedKeys, ref];
                        } else if (isSelected && selectedKeys.length > 1) {
                          nextSelection = selectedKeys;
                        } else {
                          nextSelection = [ref];
                        }
                        setSelectedKeys(nextSelection);

                        const dragSet = nextSelection.length ? nextSelection : [ref];
                        const items = dragSet.map((item) => {
                          const trackForItem = clip.tracks.find((t) => t.id === item.trackId);
                          const startTime = trackForItem?.keyframes.find((k) => k.id === item.keyframeId)?.time ?? kf.time;
                          return { ...item, startTime };
                        });
                        setDraggingKeys({ items, originClientX: e.clientX });
                        panelRef.current?.focus({ preventScroll: true });
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTrackId(live.id);
                        if (!(e.shiftKey || e.metaKey || e.ctrlKey)) {
                          setSelectedKeys([ref]);
                        }
                        onSeek(kf.time);
                        panelRef.current?.focus({ preventScroll: true });
                      }}
                    >
                      <Diamond size={16} fill="currentColor" strokeWidth={0} />
                    </button>
                  );
                })}
              </div>
            );
          })}

          {onSoundtrackChange && (
            <div
              className={`timeline-lane timeline-music-lane ${soundtrackData ? 'has-track' : 'is-empty'} ${musicSelected ? 'selected' : ''}`}
              aria-label="Music track"
              onClick={(e) => {
                if (!soundtrackData) return;
                e.stopPropagation();
                setSelectedTrackId(MUSIC_TRACK_ID);
                setSelectedKeys([]);
              }}
            >
              {soundtrackData ? (
                <div
                  ref={musicBarRef}
                  className={`timeline-music-bar ${musicSelected ? 'is-selected' : ''} ${musicDrag ? `is-dragging-${musicDrag.kind}` : ''}`}
                  style={{
                    left: `${(musicClip.start / Math.max(clip.duration, 0.001)) * 100}%`,
                    width: `${Math.min(100, (musicClip.duration / Math.max(clip.duration, 0.001)) * 100)}%`,
                    ['--music-fade-in' as string]: `${fadeEnvelope.fadeInPct}%`,
                    ['--music-fade-out' as string]: `${fadeEnvelope.fadeOutPct}%`,
                  }}
                  title={`${soundtrackName || 'Music'} · ${musicClip.duration.toFixed(1)}s — drag to move, edges to trim`}
                  onPointerDown={(e) => {
                    if (!onSoundtrackPatch) {
                      e.stopPropagation();
                      return;
                    }
                    beginMusicDrag(e, {
                      kind: 'move',
                      originX: e.clientX,
                      start0: musicClip.start,
                    });
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTrackId(MUSIC_TRACK_ID);
                    setSelectedKeys([]);
                  }}
                >
                  <svg
                    className="timeline-music-fade-vector"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden
                  >
                    {fadeEnvelope.fadeInPct > 0.5 && (
                      <path
                        className="timeline-music-fade-wedge"
                        d={`M 0 0 L ${fadeEnvelope.fadeInPct.toFixed(2)} 0 L 0 100 Z`}
                      />
                    )}
                    {fadeEnvelope.fadeOutPct > 0.5 && (
                      <path
                        className="timeline-music-fade-wedge"
                        d={`M 100 0 L ${(100 - fadeEnvelope.fadeOutPct).toFixed(2)} 0 L 100 100 Z`}
                      />
                    )}
                    <path className="timeline-music-fade-area" d={fadeEnvelope.area} />
                    <path className="timeline-music-fade-curve" d={fadeEnvelope.curve} />
                    {musicSelected && (
                      <>
                        <line
                          className="timeline-music-fade-marker"
                          x1={fadeEnvelope.inX}
                          y1={0}
                          x2={fadeEnvelope.inX}
                          y2={100}
                        />
                        <line
                          className="timeline-music-fade-marker"
                          x1={fadeEnvelope.outX}
                          y1={0}
                          x2={fadeEnvelope.outX}
                          y2={100}
                        />
                      </>
                    )}
                  </svg>
                  {musicSelected && onSoundtrackPatch && (
                    <>
                      <button
                        type="button"
                        className="timeline-music-fade-handle is-in"
                        style={{ left: `${fadeEnvelope.inX}%`, top: `${fadeEnvelope.inY}%` }}
                        title="Drag fade in"
                        aria-label="Drag fade in"
                        onPointerDown={(e) => {
                          const rect = musicBarRef.current?.getBoundingClientRect();
                          beginMusicDrag(e, {
                            kind: 'fade-in',
                            originX: e.clientX,
                            fade0: musicClip.fadeIn,
                            barLeftPx: rect?.left ?? 0,
                            barWidthPx: rect?.width ?? 1,
                          });
                        }}
                      />
                      <button
                        type="button"
                        className="timeline-music-fade-handle is-out"
                        style={{ left: `${fadeEnvelope.outX}%`, top: `${fadeEnvelope.outY}%` }}
                        title="Drag fade out"
                        aria-label="Drag fade out"
                        onPointerDown={(e) => {
                          const rect = musicBarRef.current?.getBoundingClientRect();
                          beginMusicDrag(e, {
                            kind: 'fade-out',
                            originX: e.clientX,
                            fade0: musicClip.fadeOut,
                            barLeftPx: rect?.left ?? 0,
                            barWidthPx: rect?.width ?? 1,
                          });
                        }}
                      />
                      <button
                        type="button"
                        className="timeline-music-trim-handle is-left"
                        title="Trim start"
                        aria-label="Trim music start"
                        onPointerDown={(e) => {
                          beginMusicDrag(e, {
                            kind: 'trim-left',
                            originX: e.clientX,
                            start0: musicClip.start,
                            offset0: musicClip.offset,
                            duration0: musicClip.duration,
                            end0: musicClip.start + musicClip.duration,
                          });
                        }}
                      />
                      <button
                        type="button"
                        className="timeline-music-trim-handle is-right"
                        title="Trim end"
                        aria-label="Trim music end"
                        onPointerDown={(e) => {
                          beginMusicDrag(e, {
                            kind: 'trim-right',
                            originX: e.clientX,
                            duration0: musicClip.duration,
                          });
                        }}
                      />
                    </>
                  )}
                  <span className="timeline-music-bar-label">
                    {musicClip.duration.toFixed(1)}s
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className="timeline-music-empty"
                  title="Add soundtrack"
                  onClick={(e) => {
                    e.stopPropagation();
                    audioInputRef.current?.click();
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Music2 size={12} />
                  Add music
                </button>
              )}
            </div>
          )}

          {marqueeStyle && (
            <div
              className="timeline-marquee"
              style={{
                left: marqueeStyle.left,
                top: marqueeStyle.top,
                width: marqueeStyle.width,
                height: marqueeStyle.height,
              }}
            />
          )}

          <div
            className={`timeline-playhead ${scrubbing ? 'is-active' : ''}`}
            style={{ left: `${playheadPct}%` }}
            onPointerDown={(e) => beginScrub(e, { fromPlayhead: true })}
          >
            <button type="button" className="timeline-playhead-handle" aria-label="Drag playhead" tabIndex={-1}>
              <span className="timeline-playhead-knob" />
            </button>
            <i className="timeline-playhead-line" />
          </div>
        </div>
        </div>
      </div>
    </div>
    </>
  );
}
