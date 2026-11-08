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
 * The standard directional/spot shadow shader already receives shadowRadius.
 * We use it as an approximate emitter size, which means an existing project's
 * shadowSoftness slider drives penumbra width without recompiling shaders.
 *
 * Standard PCF stays in place if the installed Three.js shader changes.
 */
const MARKER = '/* MOCKUP_STUDIO_PCSS_V2 */';

// Packed RGBA depth is the format used by PCF / PCFSoft shadow maps in r170.
// This is a two-pass approximation: blocker search followed by a filter
// whose radius grows with distance between blocker and receiving surface.
const PCSS_GLSL = /* glsl */ `
${MARKER}
float studioShadowDepth(sampler2D map, vec2 uv) {
  // Avoid sampling the clamped edge outside the shadow atlas.
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
  // Rotate the fixed disk kernel per pixel to break up repeated ring patterns.
  float noise = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
  float angle = noise * 6.2831853;

  float averageDepth = 0.0;
  float blockers = 0.0;
  float searchSize = clamp(emitterSize * 1.3, 2.5, 64.0);
  for (int i = 0; i < 12; i++) {
    vec2 uv = receiver.xy + studioShadowDisk(i, 12.0, angle) * texel * searchSize;
    float depth = studioShadowDepth(map, uv);
    if (depth < receiver.z - 0.00025) {
      averageDepth += depth;
      blockers += 1.0;
    }
  }

  if (blockers < 0.5) return 1.0;
  averageDepth /= blockers;
  // The gap is almost zero at contact: the filter then stays crisp.
  // For elevated devices / cast shadows, that gap increases the penumbra.
  float gap = max(0.0, (receiver.z - averageDepth) / max(averageDepth, 0.08));
  float radius = clamp(1.0 + gap * emitterSize * 9.0, 1.0, 96.0);

  float visibility = 0.0;
  for (int i = 0; i < 20; i++) {
    vec2 uv = receiver.xy + studioShadowDisk(i, 20.0, angle + 0.6) * texel * radius;
    visibility += step(receiver.z, studioShadowDepth(map, uv));
  }
  return visibility / 20.0;
}
`;

let cached: string | null = null;

function buildProgressiveShadowChunk(): string | null {
  if (cached) return cached;
  const original = cleanShadowmapParsFragment;

  const start = '#ifdef USE_SHADOWMAP';
  const functionStart = 'float getShadow( sampler2D shadowMap,';
  const frustumStart = 'if ( frustumTest ) {';
  const functionIndex = original.indexOf(functionStart);
  if (!original.includes(start) || functionIndex < 0 || original.indexOf(frustumStart, functionIndex) < 0) {
    return null;
  }

  let shader = original.replace(start, `${start}\n${PCSS_GLSL}`);
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
  cached = shader;
  return shader;
}

/**
 * Patch the shared shadow chunk. Safe to call from every canvas' onCreated:
 * the result is deterministic, so a second canvas never reverts the first.
 * Returns false (and leaves the stock chunk installed) if the Three.js
 * shader no longer matches the expected entry points.
 */
export function installProgressiveShadowShader(): boolean {
  const shader = buildProgressiveShadowChunk();
  if (!shader) {
    if (!THREE.ShaderChunk.shadowmap_pars_fragment.includes(MARKER)) {
      console.warn('[Mockup Studio] Unsupported Three.js shadow chunk, retaining PCF shadows.');
    }
    THREE.ShaderChunk.shadowmap_pars_fragment = cleanShadowmapParsFragment;
    return false;
  }
  if (THREE.ShaderChunk.shadowmap_pars_fragment !== shader) {
    THREE.ShaderChunk.shadowmap_pars_fragment = shader;
  }
  return true;
}
