import * as THREE from 'three';
import cleanShadowmapParsFragment from 'three/src/renderers/shaders/ShaderChunk/shadowmap_pars_fragment.glsl.js';

/**
 * SoftShadows (PCSS) mutates THREE.ShaderChunk at runtime. HMR can leave a
 * half-patched chunk that stripes every shadow receiver. Always re-install
 * the stock shader before enabling the studio shadow map.
 */
export function ensureCleanShadowShader() {
  THREE.ShaderChunk.shadowmap_pars_fragment = cleanShadowmapParsFragment;
}
