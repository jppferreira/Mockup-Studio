# Mockup Studio — Performance audit & optimisations

**Branch:** `cursor/hq-3d-rendering-performance`  
**Hardware note:** Timings below are from development profiling on the author’s machine (Apple Silicon / Electron 33). Re-measure on target hardware before claiming targets met.

## A. Audit — measured / validated bottlenecks

| Area | Finding | Evidence |
|------|---------|----------|
| PCSS profile flip on orbit | Previously swapped interactive ↔ studio samples and called `refreshShadowMaterials` → GPU program rebuilds on drag start/end | `progressiveShadows.ts` + pre-diff `KeyLightRig` |
| ContactShadows `frames={Infinity}` during orbit | Full offscreen bake every frame while dragging | `StudioSoftFloorShadows` (pre-fix) |
| Shadow atlas resize mid-orbit | Dispose/realloc on mode flip | `resolveKeyShadowMapSize` (pre-fix) |
| Full DoF (64 taps) + SSAO (12 taps) + grade during orbit | Dominates GPU while camera moves when effects enabled | `renderRealism.ts` `gl.render` hook |
| Dual-canvas split view | 2× GLTF clones + 2× WebGL contexts | `DualCanvasLayout` + `DeviceCanvas` |
| Export settle | ContactShadows remount without multi-pass bake before readback | `CaptureBridge` (pre-fix) |

## B. Adaptive quality (Interactive → Preview → Export)

| Mode | Behaviour |
|------|-----------|
| **Interactive** | Freeze key/scene shadow maps; ContactShadows plate frozen (`frames=1`); skip DoF + AO; `setLivePreviewFast(true)` (single scene pass); softboxes/HDRI stay lit |
| **Preview (studio idle)** | Auto-update shadows; rebake contact plate; full DoF/AO/grade (scaled by render preset); accent contact feet |
| **Export** | `exportBoost` — up to preset export atlas, multi-frame ContactShadows settle, optional grade MSAA (Ultra), full post stack |

Live shadow map budgets stay **stable** across interactive↔preview (no atlas thrash). Export may bump per preset.

## C. Product render presets (Performance / Balanced / Ultra)

Editor preference only (`localStorage` key `mokstudio.renderQuality`) — **never written into saved compositions**.

| Preset | Live DPR | Idle key map | Export key map | Idle AO/DoF | Export settle | Notes |
|--------|----------|--------------|----------------|-------------|---------------|-------|
| **Performance** | 1.0 | 1024 | 2048 | AO ×0.35, DoF off | 2 frames | Thin PCSS studio taps |
| **Balanced** (default) | 1–1.25 | 1024 | 4096 | Full | 4 frames | Matches prior default look |
| **Ultra** | 1–1.5 | 2048 | 4096 | Full | 8 frames + MSAA×4 | Richer PCSS (20/32) |

Existing **Shadow maps** Auto / High / Ultra control still fine-tunes atlas size within the active preset (Performance caps live High/Ultra requests).

Source of truth: `src/lib/renderQuality.ts` → consumed by `studioShadows.ts`, `progressiveShadows.ts`, `DeviceCanvas`, `StudioEnvironment`, `SceneLights`, `CaptureBridge`.

## D. Diagnostics (DEV or `?perf=1`)

- `window.__mokPerf` — marks, durations, orbit report, last frame stats
- `window.__mokOrbitFps` — avg/min/max/p95 during orbit
- Console: `[mokstudio:perf]`

```js
window.__mokOrbitFps
window.__mokPerf
```

## E. Synthetic WebGL proxy (`scripts/orbit-shadow-bench.html`)

Measured 2026-03-12 in Cursor’s Chromium (Electron 43.8.4), DPR 2.  
Tight loop (not vsync-capped). Proxies ContactShadows as an extra pass and DoF/AO/grade as N full-scene offscreen renders.

| Scenario | avg ms/frame | equiv FPS |
|----------|-------------|-----------|
| **Before** interactive (4096 map + contact every frame + grade×3) | 3.91 | 255.8 |
| **After** interactive (frozen maps, grade×0) | 0.19 | 5309.7 |
| Preview idle (updating + grade×3, no per-frame contact) | 1.33 | 749.1 |

These numbers overstate absolute FPS. They validate that freezing maps + skipping the grade/DoF/AO stack is the dominant interactive win.

## F. Remaining / next

1. Dual-canvas shared GLTF instance (larger refactor) — still 2× clones in split mode  
2. Library IDB singleton connection (open/close churn on hydrate)  
3. Rebuild studio HDRI when switching presets mid-session (currently cached per GL on first create)  
4. GPU timer queries where `EXT_disjoint_timer_query_webgl2` is available  
5. Automated visual regression harness for export stills  

Do not claim the “warm editor &lt; 1s / 60 FPS” product targets without fresh numbers on the shipping Mac hardware profile.
