import * as THREE from 'three';

/**
 * Neutral gray studio HDRI. Equal RGB, so it lights without a color cast.
 * Softboxes sit above 1 so metals keep a real highlight; the walls stay
 * around a mid gray so rough surfaces pick up ambient bounce.
 */
export const NEUTRAL_ENVIRONMENT_INTENSITY = 0.85;

/** Default brand accent is purple, which is a cool grade. */
export const COOL_OUTPUT_GAIN: [number, number, number] = [0.962, 0.988, 1.042];
/** Red, orange, and yellow accents lean slightly warm instead. */
export const WARM_OUTPUT_GAIN: [number, number, number] = [1.045, 1.012, 0.955];

const KEY_LIGHT = normalize([4, 5, 7]);
const FILL_LIGHT = normalize([-3.2, 2.4, -2.2]);

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
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
      let gray = up >= 0 ? 0.46 + up * 0.3 : 0.46 + up * 0.28;
      const rgb: [number, number, number] = [gray, gray, gray];
      addLobe(rgb, dir, KEY_LIGHT, 12, 26);
      addLobe(rgb, dir, [0, 1, 0], 4.5, 7);
      addLobe(rgb, dir, FILL_LIGHT, 2.2, 14);
      addLobe(rgb, dir, [0, -1, 0], 0.45, 3);
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

/**
 * Every perspective render (the view, exports, and snapshots) gets a slight
 * brand grade. Orthographic passes, including contact-shadow blurs, are left alone.
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
    if (buffer.width !== width || buffer.height !== height) buffer.setSize(width, height);

    const autoClear = gl.autoClear;
    gl.setRenderTarget(buffer);
    gl.autoClear = true;
    original(scene, camera);
    gl.setRenderTarget(previous);
    gl.autoClear = false;
    material.uniforms.tDiffuse.value = buffer.texture;
    original(gradeScene, gradeCamera);
    gl.autoClear = autoClear;
  };
}
