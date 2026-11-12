# Mockup Studio — Performance audit & optimisations

**Branch:** `perf/app-lag`  
**Hardware note:** Timings below are from development profiling on the author’s machine (Apple Silicon / Electron 33). Re-measure on target hardware before claiming targets met.

## A. Audit — measured / validated bottlenecks

| Area | Finding | Evidence |
|------|---------|----------|
| PCSS profile flip on orbit | Previously swapped interactive (8/12) ↔ studio (16/24) samples and called `refreshShadowMaterials` → GPU program rebuilds on drag start/end | `progressiveShadows.ts` + pre-diff `KeyLightRig` |
| ContactShadows `frames={Infinity}` during orbit | Full offscreen bake every frame while dragging | `StudioSoftFloorShadows` (pre-fix) |
| Shadow atlas resize 1024↔4096 | Dispose/realloc on mode flip | `resolveKeyShadowMapSize` (pre-fix) |
| Full DoF (64 taps) + SSAO (12 taps) + MSAA grade during orbit | Dominates GPU while camera moves when effects enabled | `renderRealism.ts` `gl.render` hook |
| Session restore blocked on serial cloud meta/row | Each tab awaited `fetchCloudProjectMeta` before `sessionReady` | `App.tsx` session effect (pre-fix) |
| Animation presets | Up to ~11 WebGL canvases with `frameloop="always"` when visible | `AnimationPresetsPanel.tsx` |
| Orbit React thrash | Mid-drag `setSharedOrbit` / `commitActiveScene` deep clones | Already largely fixed on this branch via `liveOrbit` + deferred commit |

**Not significant after validation:** Softbox intensity dimming (visual regression, limited FPS win vs keeping lights). Shrinking live shadow maps to 1024 during orbit (causes atlas thrash; freeze-at-2048 is safer).

## B. What we implemented

### Adaptive quality (Interactive → Preview → Export)

| Mode | Behaviour |
|------|-----------|
| **Interactive** | Freeze key/scene shadow maps; ContactShadows plate frozen (`frames=1`); skip DoF + AO; `setLivePreviewFast(true)` (single scene pass, no MSAA grade blit); softboxes/HDRI stay lit |
| **Preview (studio idle)** | Auto-update shadows; rebake contact plate; full DoF/AO/grade; accent contact feet |
| **Export** | `exportBoost` — up to 4096 key maps, continuous contact bake, full post stack |

Shadow map budgets stay **stable 2048** across interactive↔preview (no atlas thrash). Export may use **4096**.

### Startup staging

- **Stage A:** Electron + React shell; `prepareModelCache` + meshopt warm on boot
- **Stage B:** Local session tabs restored in parallel from IDB; active GLBs warmed; editor interactive
- **Stage C (idle):** Cloud revision reconcile; deferred `syncIfSignedIn`; dirty local edits never overwritten

### Interaction

- Orbit/gizmo transforms stay on the Three.js path (`liveOrbit` / controls)
- `DemandKeepAlive` pulses while shadow mode is interactive (damping under `frameloop="demand"`)
- PCSS profile locked to studio samples — no shader recompile on drag

### Animation presets

- Visible cards show a **static** first frame (`frameloop="demand"`)
- Continuous animation only on hover / applied, capped at **2** concurrent animated canvases

### Diagnostics (DEV or `?perf=1`)

- `window.__mokPerf` — marks, durations, orbit report
- `window.__mokOrbitFps` — avg/min/max/p95 during orbit
- `window.__mokModelPrefetch` — resolve/decrypt/preload timings
- Console: `[mokstudio:perf]` / `[model-prefetch]`

## C. Before / after

### Synthetic WebGL proxy (`scripts/orbit-shadow-bench.html`)

Measured 2026-03-12 in Cursor’s Chromium (Electron 43.8.4), DPR 2, maxTextureSize 16384.  
Tight loop (not vsync-capped). Proxies ContactShadows as an extra 2048 pass and DoF/AO/grade as N full-scene offscreen renders.

| Scenario | avg ms/frame | equiv FPS |
|----------|-------------|-----------|
| **Before** interactive (4096 map + contact every frame + grade×3) | 3.91 | 255.8 |
| **After** interactive (2048 frozen, softboxes on, grade×0) | 0.19 | 5309.7 |
| Preview idle (2048 updating + grade×3, no per-frame contact) | 1.33 | 749.1 |

**Interactive speedup (proxy): ~20.6×** vs the old orbit path that rebuilt contact + full grade stack every frame.

These numbers overstate absolute FPS (no PCSS kernel, no GLB materials, no React). They **do** validate that freezing maps + skipping the grade/DoF/AO stack is the dominant interactive win.

### In-app checks (run locally)

Warm cache, open a saved project, enable DoF + AO, orbit ~3s, then:

```js
window.__mokOrbitFps
window.__mokPerf
```

| Metric | Before (validated code path) | After |
|--------|------------------------------|-------|
| Orbit start/end hitch | PCSS profile flip + atlas resize + ContactShadows remount | Maps frozen; PCSS profile stable; plate frozen |
| Orbit with DoF+AO | Full grade stack every invalidate | Fast path: single scene pass |
| Session restore | Serial cloud meta/row per tab before `sessionReady` | Local IDB first; cloud on idle (~1.2s+) |
| Presets panel | Up to N `frameloop="always"` canvases | Static first frame; ≤2 animated |

## D. Visual fidelity

- Idle / export pixels: unchanged full stack (PCSS 16/24, softboxes, DoF, AO, contact accent)
- During drag: contact plate and key map freeze at last idle bake (intentional); materials/reflections remain lit
- Export never uses interactive fast path (`exportBoost` / CaptureBridge settle)

Capture before/after stills for glass, soft shadows, floor contact, floating devices, transparent BG, DoF, AO when validating a release.

## E. Files touched (high level)

- `src/components/StudioEnvironment.tsx` — adaptive DoF/AO/fast path; skip extent while interactive; accent contact studio-only
- `src/components/DeviceCanvas.tsx` — DemandKeepAlive + orbit FPS probe
- `src/components/AnimationPresetsPanel.tsx` — static/hover budget
- `src/App.tsx` — staged session restore; deferred cloud sync
- `src/main.tsx` — boot/shell perf marks
- `src/lib/perfDiagnostics.ts` — new
- `src/lib/scheduleIdle.ts` — wired
- `src/lib/studioShadows.ts` / `progressiveShadows.ts` — stable maps + docs
- `src/lib/prefetchDeviceModel.ts` / `useDeviceModelUrl.ts` — capped parallel prefetch

## F. Remaining / next

1. Dual-canvas shared GLTF instance (larger refactor) — still 2× clones in split mode  
2. Library IDB singleton connection (open/close churn on hydrate)  
3. Optional lower interactive DPR (1.0) toggled by mode without remounting Canvas  
4. GPU timer queries where EXT_disjoint_timer_query_webgl2 is available  
5. Automated visual regression harness for export stills  

Do not claim the “warm editor &lt; 1s / 60 FPS” product targets without fresh numbers on the shipping Mac hardware profile.
