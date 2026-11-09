import * as THREE from 'three';

/**
 * Neutral gray studio HDRI. Equal RGB, so it lights without a color cast.
 * Soft dome wrap first (Spline-like IBL); softbox lobes stay quiet so metals
 * get gentle speculars without washing the product.
 */
export const NEUTRAL_ENVIRONMENT_INTENSITY = 0.55;

/** Default brand accent is purple, which is a cool grade. */
export const COOL_OUTPUT_GAIN: [number, number, number] = [0.968, 0.99, 1.035];
/** Red, orange, and yellow accents lean slightly warm instead. */
export const WARM_OUTPUT_GAIN: [number, number, number] = [1.038, 1.01, 0.96];

const KEY_LIGHT = normalize([4, 5, 7]);
const FILL_LIGHT = normalize([-3.6, 2.8, 4.2]);
const RIM_LIGHT = normalize([-1.2, 4.8, -3.6]);
const KEY_TANGENT = normalize(cross(KEY_LIGHT, [0, 1, 0]));
const KEY_BITANGENT = normalize(cross(KEY_TANGENT, KEY_LIGHT));
const FILL_TANGENT = normalize(cross(FILL_LIGHT, [0, 1, 0]));
const FILL_BITANGENT = normalize(cross(FILL_TANGENT, FILL_LIGHT));
const RIM_TANGENT = normalize(cross(RIM_LIGHT, [0, 1, 0]));
const RIM_BITANGENT = normalize(cross(RIM_TANGENT, RIM_LIGHT));

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function directionFromEquirect(u: number, v: number): [number, number, number] {
  const y = Math.sin((v - 0.5) * Math.PI);
  const horizontal = Math.cos((v - 0.5) * Math.PI);
  const phi = (u - 0.5) * Math.PI * 2;
  return [Math.cos(phi) * horizontal, y, Math.sin(phi) * horizontal];
}

function addLobe(
  rgb: [number, number, number],
  dir: [number, number, number],
  center: [number, number, number],
  peak: number,
  power: number,
) {
  const d = Math.max(0, dir[0] * center[0] + dir[1] * center[1] + dir[2] * center[2]);
  const weight = d ** power;
  rgb[0] += peak * weight;
  rgb[1] += peak * weight;
  rgb[2] += peak * weight;
}

/** Large rectangular softbox — wider speculars than a circular lobe. */
function addSoftbox(
  rgb: [number, number, number],
  dir: [number, number, number],
  center: [number, number, number],
  tangent: [number, number, number],
  bitangent: [number, number, number],
  peak: number,
  halfWidth: number,
  halfHeight: number,
) {
  const facing = dir[0] * center[0] + dir[1] * center[1] + dir[2] * center[2];
  if (facing <= 0.05) return;
  const u = dir[0] * tangent[0] + dir[1] * tangent[1] + dir[2] * tangent[2];
  const v = dir[0] * bitangent[0] + dir[1] * bitangent[1] + dir[2] * bitangent[2];
  const wu = Math.max(0, 1 - Math.abs(u) / halfWidth);
  const wv = Math.max(0, 1 - Math.abs(v) / halfHeight);
  const window = wu * wu * wv * wv;
  if (window <= 0) return;
  const weight = window * facing;
  rgb[0] += peak * weight;
  rgb[1] += peak * weight;
  rgb[2] += peak * weight;
}

/** Float equirectangular map. v = 0 is down, matching three's equirectUv. */
export function createNeutralStudioHdri(width = 1024): THREE.DataTexture {
  const height = Math.max(2, Math.round(width / 2));
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const v = height === 1 ? 0.5 : y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const u = width === 1 ? 0.5 : x / (width - 1);
      const dir = directionFromEquirect(u, v);
      const up = dir[1];
      // Even studio dome — brighter sky, softer ground, no hot spikes.
      const gray = up >= 0 ? 0.52 + up * 0.22 : 0.48 + up * 0.18;
      const rgb: [number, number, number] = [gray, gray, gray];
      addSoftbox(rgb, dir, KEY_LIGHT, KEY_TANGENT, KEY_BITANGENT, 2.4, 0.48, 0.36);
      addSoftbox(rgb, dir, FILL_LIGHT, FILL_TANGENT, FILL_BITANGENT, 1.2, 0.42, 0.34);
      addSoftbox(rgb, dir, RIM_LIGHT, RIM_TANGENT, RIM_BITANGENT, 1.1, 0.14, 0.5);
      addLobe(rgb, dir, [0, 1, 0], 1.4, 4.5);
      addLobe(rgb, dir, [0, -1, 0], 0.35, 2.4);
      const index = (y * width + x) * 4;
      data[index] = rgb[0];
      data[index + 1] = rgb[1];
      data[index + 2] = rgb[2];
      data[index + 3] = 1;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function createNeutralStudioEnvironment(gl: THREE.WebGLRenderer) {
  const source = createNeutralStudioHdri();
  const pmrem = new THREE.PMREMGenerator(gl);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromEquirectangular(source);
  source.dispose();
  pmrem.dispose();
  return {
    texture: target.texture,
    dispose() {
      target.dispose();
    },
  };
}

function hexToHue(hex: string): number {
  const raw = hex.replace('#', '').slice(0, 6);
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

/** Warm when the brand accent is red–yellow. Otherwise a slight cool grade. */
export function renderOutputGain(accentHex: string): [number, number, number] {
  const hue = hexToHue(accentHex);
  const warm = hue <= 70 || hue >= 345;
  return warm ? WARM_OUTPUT_GAIN : COOL_OUTPUT_GAIN;
}

const gradeGains = new WeakMap<THREE.WebGLRenderer, THREE.Vector3>();

export function setRenderGradeGain(gl: THREE.WebGLRenderer, gain: [number, number, number]) {
  gradeGains.get(gl)?.set(gain[0], gain[1], gain[2]);
}

const GRADE_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const GRADE_FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform vec3 uGain;
varying vec2 vUv;
void main() {
  vec4 color = texture2D(tDiffuse, vUv);
  vec3 tinted = color.rgb * uGain;
  float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
  float tintedLuma = dot(tinted, vec3(0.2126, 0.7152, 0.0722));
  tinted *= luma / max(tintedLuma, 1e-4);
  gl_FragColor = vec4(tinted, color.a);
  #include <colorspace_fragment>
}
`;

const DOF_FRAG = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uFocus;
uniform float uFeather;
uniform float uAperture;
uniform float uMaxBlur;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;

float viewDistance(vec2 uv) {
  float depth = texture2D(tDepth, uv).r;
  float viewZ = (uNear * uFar) / ((uFar - uNear) * depth - uFar);
  return -viewZ;
}

float circleOfConfusion(float dist) {
  float delta = max(0.0, abs(dist - uFocus) - uFeather);
  return min(uMaxBlur, delta * uAperture);
}

void main() {
  float dist = viewDistance(vUv);
  float coc = circleOfConfusion(dist);
  vec4 center = texture2D(tColor, vUv);
  if (coc < 0.45) {
    gl_FragColor = center;
    return;
  }

  vec3 rgb = center.rgb * center.a;
  float alpha = center.a;
  float weightSum = 1.0;
  const int SAMPLES = 24;
  const float GOLDEN = 2.39996323;
  for (int i = 0; i < SAMPLES; i++) {
    float fi = float(i);
    float radius = sqrt((fi + 0.5) / float(SAMPLES));
    float theta = fi * GOLDEN;
    vec2 uv = vUv + vec2(cos(theta), sin(theta)) * radius * coc * uTexel;
    float sampleDist = viewDistance(uv);
    float behind = smoothstep(0.2, 1.1, sampleDist - dist);
    float sharp = 1.0 - smoothstep(0.45, 2.2, coc);
    float w = mix(1.0, 1.0 - behind, sharp);
    vec4 sampleColor = texture2D(tColor, uv);
    float luma = dot(sampleColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    w *= 1.0 + smoothstep(0.78, 1.5, luma) * smoothstep(2.0, 12.0, coc) * 0.8;
    rgb += sampleColor.rgb * sampleColor.a * w;
    alpha += sampleColor.a * w;
    weightSum += w;
  }

  gl_FragColor = vec4(rgb / max(alpha, 1e-4), alpha / max(weightSum, 1e-4));
}
`;

const AO_FRAG = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uAmount;
uniform float uRadius;
uniform float uNear;
uniform float uFar;
uniform mat4 uProjection;
uniform mat4 uInvProjection;
varying vec2 vUv;

float viewDistance(vec2 uv) {
  float depth = texture2D(tDepth, uv).r;
  float viewZ = (uNear * uFar) / ((uFar - uNear) * depth - uFar);
  return -viewZ;
}

vec3 viewPos(vec2 uv) {
  float depth = texture2D(tDepth, uv).r;
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uInvProjection * clip;
  return view.xyz / max(view.w, 1e-6);
}

void main() {
  vec4 color = texture2D(tColor, vUv);
  if (uAmount < 0.008 || color.a < 0.02) {
    gl_FragColor = color;
    return;
  }

  float depth = texture2D(tDepth, vUv).r;
  if (depth > 0.9994) {
    gl_FragColor = color;
    return;
  }

  vec3 origin = viewPos(vUv);
  vec3 normal = normalize(cross(dFdx(origin), dFdy(origin)));
  float dist = max(0.08, -origin.z);
  float radius = uRadius * (0.55 + dist * 0.06);

  float noise = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
  float occlusion = 0.0;
  const int SAMPLES = 12;
  const float GOLDEN = 2.39996323;
  for (int i = 0; i < SAMPLES; i++) {
    float fi = float(i);
    float r = sqrt((fi + 0.5) / float(SAMPLES));
    float theta = fi * GOLDEN + noise * 6.2831853;
    vec3 hemi = normalize(normal + vec3(cos(theta) * r, sin(theta) * r, 0.35) * 0.85);
    vec3 sampleView = origin + hemi * (radius * (0.22 + r));
    vec4 clip = uProjection * vec4(sampleView, 1.0);
    vec2 sampleUv = clip.xy / max(clip.w, 1e-6) * 0.5 + 0.5;
    if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) continue;
    float sampleDist = viewDistance(sampleUv);
    float sampleZ = -sampleView.z;
    float delta = sampleZ - sampleDist;
    float range = smoothstep(0.0, 1.0, radius / max(abs(sampleDist - dist), 0.04));
    occlusion += step(0.012, delta) * range;
  }

  float ao = 1.0 - (occlusion / float(SAMPLES)) * uAmount;
  ao = mix(1.0, clamp(ao, 0.42, 1.0), color.a);
  gl_FragColor = vec4(color.rgb * ao, color.a);
}
`;

type DofState = { amount: number; focusDistance: number };

const dofStates = new WeakMap<THREE.WebGLRenderer, DofState>();
const aoStates = new WeakMap<THREE.WebGLRenderer, number>();

/** `amount` is 0–1. Zero skips the pass. `focusDistance` is camera-to-subject, in world units. */
export function setDepthOfField(
  gl: THREE.WebGLRenderer,
  settings: { amount: number; focusDistance: number },
) {
  let state = dofStates.get(gl);
  if (!state) {
    state = { amount: 0, focusDistance: 8 };
    dofStates.set(gl, state);
  }
  const amount = settings.amount;
  const focus = settings.focusDistance;
  state.amount = typeof amount === 'number' && Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : 0;
  state.focusDistance = typeof focus === 'number' && Number.isFinite(focus)
    ? Math.max(0.05, focus)
    : state.focusDistance;
}

function readDof(gl: THREE.WebGLRenderer): DofState {
  return dofStates.get(gl) ?? { amount: 0, focusDistance: 8 };
}

/** `amount` is 0–1. Zero skips the pass. Subtle values (0.2–0.4) read as product photography. */
export function setAmbientOcclusion(gl: THREE.WebGLRenderer, amount: number) {
  const next = typeof amount === 'number' && Number.isFinite(amount)
    ? Math.min(1, Math.max(0, amount))
    : 0;
  aoStates.set(gl, next);
}

function readAo(gl: THREE.WebGLRenderer): number {
  return aoStates.get(gl) ?? 0;
}

function fitTarget(target: THREE.WebGLRenderTarget, width: number, height: number) {
  if (target.width === width && target.height === height) return;
  target.setSize(width, height);
  const depth = target.depthTexture;
  if (depth) {
    depth.image.width = width;
    depth.image.height = height;
  }
}

/**
 * Every perspective render (the view, exports, and snapshots) gets a slight
 * brand grade. Orthographic passes, including contact-shadow blurs, are left alone.
 * Depth of field, when enabled, runs on that same path so stills and video match the view.
 */
export function installRenderGrade(gl: THREE.WebGLRenderer) {
  const tagged = gl as THREE.WebGLRenderer & { __renderGrade?: boolean };
  if (tagged.__renderGrade) return;
  tagged.__renderGrade = true;

  const gain = new THREE.Vector3(...COOL_OUTPUT_GAIN);
  gradeGains.set(gl, gain);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uGain: { value: gain },
    },
    vertexShader: GRADE_VERT,
    fragmentShader: GRADE_FRAG,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const gradeScene = new THREE.Scene();
  gradeScene.add(quad);
  const gradeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const buffer = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: true,
    stencilBuffer: false,
    samples: gl.capabilities.isWebGL2 ? 4 : 0,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
  });
  buffer.texture.colorSpace = THREE.LinearSRGBColorSpace;
  buffer.texture.generateMipmaps = false;

  const depthTexture = new THREE.DepthTexture(1, 1);
  depthTexture.format = THREE.DepthFormat;
  depthTexture.type = THREE.UnsignedIntType;
  const depthTarget = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    depthTexture,
  });
  depthTarget.texture.generateMipmaps = false;

  const dofTarget = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: false,
    stencilBuffer: false,
    samples: 0,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
  });
  dofTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
  dofTarget.texture.generateMipmaps = false;

  const dofMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: null as THREE.Texture | null },
      tDepth: { value: null as THREE.Texture | null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uFocus: { value: 8 },
      uFeather: { value: 0.5 },
      uAperture: { value: 8 },
      uMaxBlur: { value: 24 },
      uNear: { value: 0.1 },
      uFar: { value: 100 },
    },
    vertexShader: GRADE_VERT,
    fragmentShader: DOF_FRAG,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const dofQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dofMaterial);
  dofQuad.frustumCulled = false;
  const dofScene = new THREE.Scene();
  dofScene.add(dofQuad);
  const dofCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const aoTarget = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: false,
    stencilBuffer: false,
    samples: 0,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
  });
  aoTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
  aoTarget.texture.generateMipmaps = false;

  const aoInvProjection = new THREE.Matrix4();
  const aoMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: null as THREE.Texture | null },
      tDepth: { value: null as THREE.Texture | null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uAmount: { value: 0 },
      uRadius: { value: 0.16 },
      uNear: { value: 0.1 },
      uFar: { value: 100 },
      uProjection: { value: new THREE.Matrix4() },
      uInvProjection: { value: aoInvProjection },
    },
    vertexShader: GRADE_VERT,
    fragmentShader: AO_FRAG,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const aoQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), aoMaterial);
  aoQuad.frustumCulled = false;
  const aoScene = new THREE.Scene();
  aoScene.add(aoQuad);
  const aoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const original = gl.render.bind(gl);
  const size = new THREE.Vector2();

  gl.render = (scene: THREE.Object3D, camera: THREE.Camera) => {
    if (!(camera instanceof THREE.PerspectiveCamera)) {
      original(scene, camera);
      return;
    }
    const previous = gl.getRenderTarget();
    const drawing = previous
      ? size.set(previous.width, previous.height)
      : gl.getDrawingBufferSize(size);
    const width = Math.max(1, Math.floor(drawing.x));
    const height = Math.max(1, Math.floor(drawing.y));
    const autoClear = gl.autoClear;
    const dof = readDof(gl);
    const aoAmount = readAo(gl);
    const useDof = dof.amount >= 0.02;
    const useAo = aoAmount >= 0.02;
    const needDepth = (useDof || useAo) && Boolean(depthTarget.depthTexture);

    try {
      let colorTarget: THREE.WebGLRenderTarget = buffer;
      fitTarget(buffer, width, height);
      gl.setRenderTarget(buffer);
      gl.autoClear = true;
      original(scene, camera);

      if (needDepth) {
        // Shared depth for DoF and AO so skinned / transparent materials stay correct.
        fitTarget(depthTarget, width, height);
        gl.setRenderTarget(depthTarget);
        gl.autoClear = true;
        original(scene, camera);
      }

      if (useDof && depthTarget.depthTexture) {
        fitTarget(dofTarget, width, height);
        const px = height / 900;
        const shaped = Math.pow(dof.amount, 1.15);
        const uniforms = dofMaterial.uniforms;
        uniforms.tColor.value = buffer.texture;
        uniforms.tDepth.value = depthTarget.depthTexture;
        uniforms.uTexel.value.set(1 / width, 1 / height);
        uniforms.uFocus.value = dof.focusDistance;
        uniforms.uFeather.value = Math.max(0.5, dof.focusDistance * 0.055);
        uniforms.uAperture.value = shaped * 14 * px;
        uniforms.uMaxBlur.value = shaped * 52 * px;
        uniforms.uNear.value = camera.near;
        uniforms.uFar.value = Math.max(camera.far, camera.near + 0.01);

        gl.setRenderTarget(dofTarget);
        gl.autoClear = true;
        original(dofScene, dofCamera);
        colorTarget = dofTarget;
      }

      if (useAo && depthTarget.depthTexture) {
        fitTarget(aoTarget, width, height);
        aoInvProjection.copy(camera.projectionMatrix).invert();
        const uniforms = aoMaterial.uniforms;
        uniforms.tColor.value = colorTarget.texture;
        uniforms.tDepth.value = depthTarget.depthTexture;
        uniforms.uTexel.value.set(1 / width, 1 / height);
        uniforms.uAmount.value = aoAmount;
        uniforms.uRadius.value = THREE.MathUtils.lerp(0.08, 0.28, aoAmount);
        uniforms.uNear.value = camera.near;
        uniforms.uFar.value = Math.max(camera.far, camera.near + 0.01);
        uniforms.uProjection.value.copy(camera.projectionMatrix);
        uniforms.uInvProjection.value.copy(aoInvProjection);

        gl.setRenderTarget(aoTarget);
        gl.autoClear = true;
        original(aoScene, aoCamera);
        colorTarget = aoTarget;
      }

      gl.setRenderTarget(previous);
      gl.autoClear = false;
      material.uniforms.tDiffuse.value = colorTarget.texture;
      original(gradeScene, gradeCamera);
    } finally {
      gl.autoClear = autoClear;
      if (gl.getRenderTarget() !== previous) gl.setRenderTarget(previous);
    }
  };
}
