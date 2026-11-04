import { useMemo } from 'react';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import type { SceneProp, Vec3 } from '../types';

function asScale(scale: number | Vec3): [number, number, number] {
  if (typeof scale === 'number') return [scale, scale, scale];
  return [scale.x, scale.y, scale.z];
}

function parseRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Soft value-noise field (cached grid + bilinear sample) */
function makeNoiseField(size: number, cell: number, rand: () => number) {
  const cols = Math.ceil(size / cell) + 2;
  const grid = new Float32Array(cols * cols);
  for (let i = 0; i < grid.length; i += 1) grid[i] = rand();
  return (x: number, y: number) => {
    const gx = x / cell;
    const gy = y / cell;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const i = (x0 + 1) + (y0 + 1) * cols;
    const a = grid[i];
    const b = grid[i + 1];
    const c = grid[i + cols];
    const d = grid[i + cols + 1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves = 4) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.05;
  }
  return sum / norm;
}

function texFromImageData(data: ImageData, opts?: { srgb?: boolean; repeat?: number }): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  canvas.getContext('2d')!.putImageData(data, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const r = opts?.repeat ?? 1.6;
  tex.repeat.set(r, r);
  if (opts?.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace;
  else tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function heightToNormal(height: Float32Array, size: number, strength = 2.4): ImageData {
  const out = new ImageData(size, size);
  const d = out.data;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const left = height[y * size + ((x - 1 + size) % size)];
      const right = height[y * size + ((x + 1) % size)];
      const up = height[((y - 1 + size) % size) * size + x];
      const down = height[((y + 1) % size) * size + x];
      const dx = (left - right) * strength;
      const dy = (up - down) * strength;
      const len = Math.hypot(dx, dy, 1) || 1;
      const idx = i * 4;
      d[idx] = Math.floor(((dx / len) * 0.5 + 0.5) * 255);
      d[idx + 1] = Math.floor(((dy / len) * 0.5 + 0.5) * 255);
      d[idx + 2] = Math.floor(((1 / len) * 0.5 + 0.5) * 255);
      d[idx + 3] = 255;
    }
  }
  return out;
}

type MaterialMaps = {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
};

function makeConcreteMaps(tint: string, seed = 1): MaterialMaps {
  const size = 1024;
  const rand = mulberry32(seed * 7919 + 17);
  const n1 = makeNoiseField(size, 64, rand);
  const n2 = makeNoiseField(size, 24, rand);
  const n3 = makeNoiseField(size, 8, rand);
  const [br, bg, bb] = parseRgb(tint);

  const albedo = new ImageData(size, size);
  const rough = new ImageData(size, size);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const idx = i * 4;

      // Large tonal patches + mid mottling + fine grit
      const macro = fbm(n1, x, y, 3);
      const mid = fbm(n2, x * 1.3, y * 1.3, 3);
      const grit = n3(x, y);
      const pebble = Math.pow(Math.max(0, mid - 0.58), 1.6);

      // Panel / formwork lines (subtle recessed grooves)
      const panelX = Math.abs(((x / size) * 3) % 1 - 0.5);
      const panelY = Math.abs(((y / size) * 2) % 1 - 0.5);
      const seam = (panelX < 0.012 ? (0.012 - panelX) / 0.012 : 0)
        + (panelY < 0.01 ? (0.01 - panelY) / 0.01 : 0);
      const seamAmt = Math.min(1, seam) * 0.35;
      // Bake soft AO into albedo (avoids needing uv2)
      const ambient = 1 - (1 - mid) * 0.06 - seamAmt * 0.45;

      const tone = (macro - 0.5) * 38 + (mid - 0.5) * 22 + (grit - 0.5) * 14 - seamAmt * 40;
      const pebbleLift = pebble * 28;

      albedo.data[idx] = Math.max(0, Math.min(255, (br + tone + pebbleLift * 0.4) * ambient));
      albedo.data[idx + 1] = Math.max(0, Math.min(255, (bg + tone * 0.95 + pebbleLift * 0.35) * ambient));
      albedo.data[idx + 2] = Math.max(0, Math.min(255, (bb + tone * 0.85 + pebbleLift * 0.25) * ambient));
      albedo.data[idx + 3] = 255;

      // Height for normals: grit + pebbles + seams
      height[i] = macro * 0.35 + mid * 0.3 + grit * 0.25 + pebble * 0.55 - seamAmt;

      const rv = Math.floor(150 + grit * 70 + pebble * 40 + seamAmt * 50);
      rough.data[idx] = rough.data[idx + 1] = rough.data[idx + 2] = Math.max(0, Math.min(255, rv));
      rough.data[idx + 3] = 255;
    }
  }

  // Sparse larger aggregate stones
  for (let k = 0; k < 280; k += 1) {
    const cx = Math.floor(rand() * size);
    const cy = Math.floor(rand() * size);
    const rad = 2 + Math.floor(rand() * 5);
    const light = rand() > 0.4;
    for (let oy = -rad; oy <= rad; oy += 1) {
      for (let ox = -rad; ox <= rad; ox += 1) {
        if (ox * ox + oy * oy > rad * rad) continue;
        const x = (cx + ox + size) % size;
        const y = (cy + oy + size) % size;
        const i = y * size + x;
        const idx = i * 4;
        const fall = 1 - Math.hypot(ox, oy) / (rad + 0.01);
        const d = (light ? 18 : -22) * fall;
        albedo.data[idx] = Math.max(0, Math.min(255, albedo.data[idx] + d));
        albedo.data[idx + 1] = Math.max(0, Math.min(255, albedo.data[idx + 1] + d * 0.95));
        albedo.data[idx + 2] = Math.max(0, Math.min(255, albedo.data[idx + 2] + d * 0.9));
        height[i] += fall * (light ? 0.15 : -0.1);
      }
    }
  }

  return {
    map: texFromImageData(albedo, { srgb: true, repeat: 1.35 }),
    roughnessMap: texFromImageData(rough, { srgb: false, repeat: 1.35 }),
    normalMap: texFromImageData(heightToNormal(height, size, 3.2), { srgb: false, repeat: 1.35 }),
  };
}

function makeClayMaps(color: string, seed = 1): MaterialMaps {
  const size = 512;
  const rand = mulberry32(seed * 1337 + 9);
  const n1 = makeNoiseField(size, 48, rand);
  const n2 = makeNoiseField(size, 12, rand);
  const [cr, cg, cb] = parseRgb(color);

  const albedo = new ImageData(size, size);
  const rough = new ImageData(size, size);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const idx = i * 4;
      const soft = fbm(n1, x, y, 3);
      const micro = n2(x, y);
      // Very subtle knead marks / fingerprints — not speckly
      const tone = (soft - 0.5) * 10 + (micro - 0.5) * 4;
      albedo.data[idx] = Math.max(0, Math.min(255, cr + tone));
      albedo.data[idx + 1] = Math.max(0, Math.min(255, cg + tone * 0.92));
      albedo.data[idx + 2] = Math.max(0, Math.min(255, cb + tone * 0.85));
      albedo.data[idx + 3] = 255;

      height[i] = soft * 0.55 + micro * 0.2;
      const rv = Math.floor(175 + soft * 35 + micro * 25);
      rough.data[idx] = rough.data[idx + 1] = rough.data[idx + 2] = Math.max(0, Math.min(255, rv));
      rough.data[idx + 3] = 255;
    }
  }

  return {
    map: texFromImageData(albedo, { srgb: true, repeat: 1.1 }),
    roughnessMap: texFromImageData(rough, { srgb: false, repeat: 1.1 }),
    normalMap: texFromImageData(heightToNormal(height, size, 1.1), { srgb: false, repeat: 1.1 }),
  };
}

function ClayMaterial({ color, seed = 1 }: { color: string; seed?: number }) {
  const maps = useMemo(() => makeClayMaps(color, seed), [color, seed]);
  return (
    <meshPhysicalMaterial
      color="#ffffff"
      map={maps.map}
      roughnessMap={maps.roughnessMap}
      normalMap={maps.normalMap}
      normalScale={new THREE.Vector2(0.35, 0.35)}
      roughness={0.86}
      metalness={0}
      sheen={0.85}
      sheenRoughness={0.62}
      sheenColor={color}
      clearcoat={0.06}
      clearcoatRoughness={0.75}
      envMapIntensity={0.4}
    />
  );
}

function ConcreteMaterial({ tint = '#9a958e', seed = 1 }: { tint?: string; seed?: number }) {
  const maps = useMemo(() => makeConcreteMaps(tint, seed), [tint, seed]);
  return (
    <meshStandardMaterial
      color="#e4e0d8"
      map={maps.map}
      roughnessMap={maps.roughnessMap}
      normalMap={maps.normalMap}
      normalScale={new THREE.Vector2(0.85, 0.85)}
      roughness={0.94}
      metalness={0.03}
      envMapIntensity={0.22}
    />
  );
}

/** Clean matte cyclorama — no grain maps (those tiled into visible stripes). */
function StudioMaterial({ color }: { color: string }) {
  return (
    <meshStandardMaterial
      color={color}
      roughness={0.92}
      metalness={0}
      envMapIntensity={0.12}
    />
  );
}

function PropMesh({ prop }: { prop: SceneProp }) {
  const scale = asScale(prop.scale);
  const rot = prop.rotation;
  const pos = prop.position;
  const clay = prop.color ?? '#d8cfc4';
  const seed = prop.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);

  return (
    <group
      position={[pos.x, pos.y, pos.z]}
      rotation={[
        THREE.MathUtils.degToRad(rot.x),
        THREE.MathUtils.degToRad(rot.y),
        THREE.MathUtils.degToRad(rot.z),
      ]}
      scale={scale}
    >
      {prop.kind === 'clay_sphere' && (
        <mesh castShadow receiveShadow>
          <sphereGeometry args={[0.55, 64, 64]} />
          <ClayMaterial color={clay} seed={seed} />
        </mesh>
      )}
      {prop.kind === 'clay_cube' && (
        <RoundedBox args={[0.9, 0.9, 0.9]} radius={0.12} smoothness={6} castShadow receiveShadow>
          <ClayMaterial color={clay} seed={seed} />
        </RoundedBox>
      )}
      {prop.kind === 'clay_cylinder' && (
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.42, 0.42, 0.95, 64]} />
          <ClayMaterial color={clay} seed={seed} />
        </mesh>
      )}
      {prop.kind === 'clay_torus' && (
        <mesh castShadow receiveShadow rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.48, 0.17, 48, 72]} />
          <ClayMaterial color={clay} seed={seed} />
        </mesh>
      )}
      {prop.kind === 'concrete_wall' && (
        <group position={[0, 1.25, 0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[3.8, 2.7, 0.22]} />
            <ConcreteMaterial tint="#8f8a80" seed={seed} />
          </mesh>
          <mesh position={[0, -1.32, 0.02]} castShadow receiveShadow>
            <boxGeometry args={[3.85, 0.06, 0.28]} />
            <ConcreteMaterial tint="#7e796f" seed={seed + 3} />
          </mesh>
        </group>
      )}
      {prop.kind === 'concrete_slab' && (
        <group>
          <mesh receiveShadow castShadow>
            <boxGeometry args={[4.4, 0.14, 3.4]} />
            <ConcreteMaterial tint="#a8a297" seed={seed} />
          </mesh>
          <mesh position={[0, -0.09, 0]} receiveShadow>
            <boxGeometry args={[4.35, 0.04, 3.35]} />
            <meshStandardMaterial color="#6e6962" roughness={1} metalness={0} />
          </mesh>
        </group>
      )}
      {prop.kind === 'pedestal' && (
        <group>
          <RoundedBox args={[1.28, 0.22, 1.28]} radius={0.02} smoothness={3} position={[0, 0.11, 0]} castShadow receiveShadow>
            <ConcreteMaterial tint="#9b968c" seed={seed} />
          </RoundedBox>
          <RoundedBox args={[1.02, 0.55, 1.02]} radius={0.025} smoothness={3} position={[0, 0.5, 0]} castShadow receiveShadow>
            <ConcreteMaterial tint="#8f8a80" seed={seed + 2} />
          </RoundedBox>
          <RoundedBox args={[1.18, 0.1, 1.18]} radius={0.02} smoothness={2} position={[0, 0.82, 0]} castShadow receiveShadow>
            <ConcreteMaterial tint="#a8a298" seed={seed + 4} />
          </RoundedBox>
        </group>
      )}
      {prop.kind === 'studio_backdrop' && (
        <StudioBackdrop color={prop.color ?? '#f7f7f5'} />
      )}
    </group>
  );
}

/** Seamless white cyclorama — infinite-looking floor + soft cove + back wall */
function StudioBackdrop({ color }: { color: string }) {
  const cove = useMemo(() => {
    const shape = new THREE.Shape();
    const r = 1.15;
    shape.moveTo(0, 0);
    shape.absarc(0, r, r, -Math.PI / 2, 0, false);
    shape.lineTo(0, 0);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 9,
      bevelEnabled: false,
      steps: 1,
      curveSegments: 48,
    });
    geo.rotateY(-Math.PI / 2);
    geo.translate(4.5, 0, -1.05);
    return geo;
  }, []);

  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 1.35]} receiveShadow>
        <planeGeometry args={[9, 6.5]} />
        <StudioMaterial color={color} />
      </mesh>
      {/* Back wall */}
      <mesh position={[0, 2.7, -1.05]} receiveShadow>
        <planeGeometry args={[9, 5.5]} />
        <StudioMaterial color={color} />
      </mesh>
      {/* Soft cove join */}
      <mesh geometry={cove} receiveShadow>
        <StudioMaterial color={color} />
      </mesh>
    </group>
  );
}

export default function SceneProps({ props }: { props: SceneProp[] }) {
  if (!props.length) return null;
  return (
    <group>
      {props.map((prop) => (
        <PropMesh key={prop.id} prop={prop} />
      ))}
    </group>
  );
}
