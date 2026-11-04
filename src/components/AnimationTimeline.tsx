import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ChevronDown, ChevronUp, Diamond, Gauge, KeyRound, Pause, Play, Plus,
  Repeat, SkipBack, Trash2, ZoomIn, ZoomOut,
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
}

type KeyRef = { trackId: string; keyframeId: string };

const TRACK_COLORS: Record<AnimProperty, string> = {
  'rotation.x': '#7ec8e3',
  'rotation.y': '#c5f2b6',
  'rotation.z': '#e3c17e',
  'position.x': '#b8a4f0',
  'position.y': '#f0a4c8',
  'position.z': '#a4e0f0',
  scale: '#f0d4a4',
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
}: Props) {
  const scrubRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const easeWrapRef = useRef<HTMLDivElement>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<KeyRef[]>([]);
  const [hoveredKeyId, setHoveredKeyId] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [zoom, setZoom] = useState(1);
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

  const pressTimerRef = useRef<number | null>(null);
  const pressOriginRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const marqueeModeRef = useRef(false);
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;

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
    if (draggingKeys || marqueeModeRef.current) return;
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

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const content = scrubRef.current;
      const rect = content?.getBoundingClientRect();
      const anchor = rect && rect.width > 0
        ? ((event.clientX - rect.left) / rect.width) * clip.duration
        : currentTime;
      const direction = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      applyZoom(zoom + direction, anchor);
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [zoom, clip.duration, currentTime]); // eslint-disable-line react-hooks/exhaustive-deps

  const deviceLabel = (id: string) => {
    const index = devices.findIndex((d) => d.id === id);
    return index >= 0 ? `Device ${index + 1}` : 'Device';
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
    <div className={`timeline-collapsed ${open || chromeHidden ? 'is-hidden' : ''}`}>
      <button type="button" className="timeline-open-btn" onClick={onToggle}>
        <Gauge size={14} /> Animation timeline <ChevronUp size={14} />
      </button>
    </div>
    <div className={`timeline-panel ${panelVisible ? 'is-open' : 'is-closed'}`} ref={panelRef} tabIndex={-1} aria-hidden={!panelVisible}>
      <div className="timeline-transport">
        <div className="timeline-transport-left">
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
            title="Loop"
            onClick={() => onChange({ ...clip, loop: !clip.loop })}
          >
            <Repeat size={14} />
          </button>
          <span className="timeline-timecode">
            {formatTimecode(currentTime, clip.fps)}
            <span> / {formatTimecode(clip.duration, clip.fps)}</span>
          </span>
        </div>

        <div className="timeline-transport-center">
          <span className="timeline-target">{deviceLabel(selectedDevice.id)}</span>
          <button type="button" className="timeline-action" onClick={() => addKeyframeAtPlayhead()} title="Key current transform">
            <Diamond size={13} /> Keyframe
          </button>
          <button type="button" className="timeline-action" onClick={() => addKeyframeAtPlayhead('rotation.y')} title="Key rotate Y">
            <KeyRound size={13} /> Rot Y
          </button>
          <div
            ref={easeWrapRef}
            className={`timeline-ease-wrap ${selectedKeys.length ? 'is-armed' : ''} ${easeGraphOpen ? 'is-open' : ''}`}
          >
            <label
              className={`timeline-ease-select ${selectedKeys.length ? 'is-armed' : ''}`}
              title="Ease from selected keyframe(s) to the next"
            >
              <span>Ease</span>
              <select
                value={selectedEase === 'mixed' ? '' : (selectedEase ?? 'easeInOut')}
                disabled={!selectedKeys.length}
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
                className={`timeline-ease-graph-toggle ${easeGraphOpen ? 'is-open' : ''} ${selectedEase === 'custom' ? 'is-custom' : ''}`}
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
                Graph
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
            className={`timeline-action subtle ${selectedKeys.length || hoveredKeyId ? 'is-armed' : ''}`}
            onClick={deleteSelectedKeyframes}
            title="Delete selected / hovered keyframe (Delete · Backspace · Clear)"
          >
            <Trash2 size={13} />
            {selectedKeys.length > 1 ? <span>{selectedKeys.length}</span> : null}
          </button>
        </div>

        <div className="timeline-transport-right">
          <div className="timeline-zoom" title="Zoom timeline (⌘/Ctrl + scroll)">
            <button
              type="button"
              className="timeline-icon-btn"
              title="Zoom out"
              disabled={zoom <= ZOOM_MIN}
              onClick={() => zoomBy(-ZOOM_STEP)}
            >
              <ZoomOut size={14} />
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
              <ZoomIn size={14} />
            </button>
          </div>
          <label className="timeline-duration">
            <span>Dur</span>
            <input
              type="number"
              min={1}
              max={30}
              step={0.5}
              value={clip.duration}
              onChange={(e) => onChange({ ...clip, duration: Math.min(30, Math.max(1, Number(e.target.value) || 4)) })}
            />
            <span>s</span>
          </label>
          <button type="button" className="timeline-icon-btn" title="Collapse timeline" onClick={onToggle}>
            <ChevronDown size={14} />
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
        </div>

        <div className="timeline-lanes-viewport" ref={scrollRef}>
        <div
          ref={scrubRef}
          className={[
            'timeline-lanes',
            scrubbing ? 'is-scrubbing' : '',
            draggingKeys ? 'is-dragging-key' : '',
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
