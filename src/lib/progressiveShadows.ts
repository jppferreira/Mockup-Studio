import * as THREE from 'three';
import cleanShadowmapParsFragment from 'three/src/renderers/shaders/ShaderChunk/shadowmap_pars_fragment.glsl.js';

/**
 * Install one shared PCSS filter for the WebGL renderer (Three.js r170).
 *
 * DeviceCanvas can mount multiple simultaneous canvases (split view, thumbnails,
 * captures). Mounting Drei's SoftShadows in each canvas would patch and restore
 * the shared THREE.ShaderChunk independently, so a canvas unmount could disable
 * another canvas's shadows. Instead this always rebuilds the chunk from the
 * stock import, so every call (and every HMR cycle) lands on the same string.
 *
 * Live preview and export share the same contact-hardening filter so orbit
 * never softens the look. Orbit savings come from freezing shadow-map updates,
 * not from a thinner PCSS kernel. Standard PCF stays if the Three.js shader changes.
 */
export type ProgressiveShadowProfile = 'interactive' | 'studio';

const MARKER = '/* MOCKUP_STUDIO_PCSS_V5 */';

const PROFILE_SAMPLES: Record<ProgressiveShadowProfile, { blockers: number; filter: number }> = {
  // Kept identical to studio so any leftover interactive retain calls match pixels.
  interactive: { blockers: 16, filter: 24 },
  // Idle preview + export: full contact-hardening filter.
  studio: { blockers: 16, filter: 24 },
};

let activeProfile: ProgressiveShadowProfile = 'studio';
const cachedByProfile: Partial<Record<ProgressiveShadowProfile, string>> = {};
/** Canvases currently requesting each profile — interactive wins while any pane is busy. */
const profileUsers: Record<ProgressiveShadowProfile, number> = {
  interactive: 0,
  studio: 0,
};

function buildPcssGlsl(blockers: number, filter: number): string {
  return /* glsl */ `
${MARKER}
float studioShadowDepth(sampler2D map, vec2 uv) {
  // Outside the atlas: treat as fully lit so clamped edges never stamp a square.
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
  return unpackRGBAToDepth(texture2D(map, clamp(uv, vec2(0.001), vec2(0.999))));
}

vec2 studioShadowDisk(int index, float count, float angle) {
  float fraction = (float(index) + 0.5) / count;
  float theta = float(index) * 2.39996323 + angle;
  return sqrt(fraction) * vec2(cos(theta), sin(theta));
}

float studioProgressiveShadow(
  sampler2D map,
  vec2 mapSize,
  vec3 receiver,
  float emitterSize
) {
  vec2 texel = 1.0 / mapSize;
  float noise = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
  float angle = noise * 6.2831853;
  float bias = 0.00035;

  float averageDepth = 0.0;
  float blockers = 0.0;
  float searchSize = clamp(emitterSize * 1.15, 3.0, 80.0);
  for (int i = 0; i < ${blockers}; i++) {
    vec2 uv = receiver.xy + studioShadowDisk(i, ${blockers}.0, angle) * texel * searchSize;
    float depth = studioShadowDepth(map, uv);
    if (depth < receiver.z - bias) {
      averageDepth += depth;
      blockers += 1.0;
    }
  }

  if (blockers < 0.5) return 1.0;
  averageDepth /= blockers;
  // Contact-hardening: gap ~ 0 at the feet (crisp core), grows for floating /
  // tilted devices so the cast blooms like a large softbox.
  float gap = max(0.0, (receiver.z - averageDepth) / max(averageDepth, 0.06));
  float minRadius = clamp(emitterSize * 0.12, 1.6, 6.0);
  float radius = clamp(minRadius + pow(gap, 0.85) * emitterSize * 8.5, minRadius, 160.0);

  float visibility = 0.0;
  for (int i = 0; i < ${filter}; i++) {
    vec2 uv = receiver.xy + studioShadowDisk(i, ${filter}.0, angle + 0.51) * texel * radius;
    visibility += step(receiver.z - bias * 0.35, studioShadowDepth(map, uv));
  }
  return visibility / ${filter}.0;
}
`;
}

function buildProgressiveShadowChunk(profile: ProgressiveShadowProfile): string | null {
  const hit = cachedByProfile[profile];
  if (hit) return hit;
  const original = cleanShadowmapParsFragment;
  const { blockers, filter } = PROFILE_SAMPLES[profile];
  const pcss = buildPcssGlsl(blockers, filter);

  const start = '#ifdef USE_SHADOWMAP';
  const functionStart = 'float getShadow( sampler2D shadowMap,';
  const frustumStart = 'if ( frustumTest ) {';
  const functionIndex = original.indexOf(functionStart);
  if (!original.includes(start) || functionIndex < 0 || original.indexOf(frustumStart, functionIndex) < 0) {
    return null;
  }

  let shader = original.replace(start, `${start}\n${pcss}`);
  const at = shader.indexOf(frustumStart, shader.indexOf(functionStart));
  // Replace both PCF paths (the renderer uses PCFSoftShadowMap). VSM and the
  // point-light shadow implementation continue using the original shader.
  // Intensity may exceed 1 so soft penumbras can still crush toward black.
  // mix() extrapolates negative above 1 — use a clamped darken instead.
  const replacement = `${frustumStart}
#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT )
  shadow = studioProgressiveShadow(shadowMap, shadowMapSize, shadowCoord.xyz, shadowRadius);
  return clamp(1.0 - (1.0 - shadow) * shadowIntensity, 0.0, 1.0);
#endif`;
  shader = shader.slice(0, at) + replacement + shader.slice(at + frustumStart.length);
  cachedByProfile[profile] = shader;
  return shader;
}

/**
 * Patch the shared shadow chunk. Safe to call from every canvas' onCreated:
 * the result is deterministic for a given profile, so a second canvas never
 * reverts the first. Returns false (and leaves the stock chunk installed) if
 * the Three.js shader no longer matches the expected entry points.
 *
 * Returns true when the installed profile changed (callers should refresh materials).
 */
export function installProgressiveShadowShader(
  profile: ProgressiveShadowProfile = 'studio',
): boolean {
  const shader = buildProgressiveShadowChunk(profile);
  if (!shader) {
    if (!THREE.ShaderChunk.shadowmap_pars_fragment.includes(MARKER)) {
      console.warn('[mokstudio] Unsupported Three.js shadow chunk, retaining PCF shadows.');
    }
    THREE.ShaderChunk.shadowmap_pars_fragment = cleanShadowmapParsFragment;
    const changed = activeProfile !== profile;
    activeProfile = profile;
    return changed;
  }
  const changed = (
    activeProfile !== profile
    || THREE.ShaderChunk.shadowmap_pars_fragment !== shader
  );
  activeProfile = profile;
  if (THREE.ShaderChunk.shadowmap_pars_fragment !== shader) {
    THREE.ShaderChunk.shadowmap_pars_fragment = shader;
  }
  return changed;
}

export function getProgressiveShadowProfile(): ProgressiveShadowProfile {
  return activeProfile;
}

/**
 * Track per-canvas profile demand. Interactive wins while any canvas is busy so
 * split view never fights over the shared ShaderChunk.
 * Returns true when the installed profile changed.
 */
export function retainProgressiveShadowProfile(
  profile: ProgressiveShadowProfile,
): boolean {
  profileUsers[profile] += 1;
  const desired: ProgressiveShadowProfile = profileUsers.interactive > 0
    ? 'interactive'
    : 'studio';
  return installProgressiveShadowShader(desired);
}

/** Drop a canvas' profile demand; may restore studio PCSS when all panes idle. */
export function releaseProgressiveShadowProfile(
  profile: ProgressiveShadowProfile,
): boolean {
  profileUsers[profile] = Math.max(0, profileUsers[profile] - 1);
  const desired: ProgressiveShadowProfile = profileUsers.interactive > 0
    ? 'interactive'
    : 'studio';
  return installProgressiveShadowShader(desired);
}

/** Force materials to pick up a newly installed PCSS profile. */
export function refreshShadowMaterials(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of list) {
      if (mat) mat.needsUpdate = true;
    }
  });
}
