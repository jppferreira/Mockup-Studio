import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
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
  aoMap?: THREE.CanvasTexture;
};

const STONE_NORMAL_SCALE = new THREE.Vector2(1.35, 1.35);
const STAGE_NORMAL_SCALE = new THREE.Vector2(0.62, 0.62);

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

function ClayMaterial({ color, seed = 1, selected = false }: { color: string; seed?: number; selected?: boolean }) {
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
      emissive={selected ? '#c5f2b6' : '#000000'}
      emissiveIntensity={selected ? 0.22 : 0}
      sheen={0.85}
      sheenRoughness={0.62}
      sheenColor={color}
      clearcoat={0.06}
      clearcoatRoughness={0.75}
      envMapIntensity={0.4}
    />
  );
}

function makeStoneMaps(tint: string, seed = 1): MaterialMaps {
  const size = 512;
  const rand = mulberry32(seed * 4099 + 11);
  const n1 = makeNoiseField(size, 72, rand);
  const n2 = makeNoiseField(size, 18, rand);
  const n3 = makeNoiseField(size, 6, rand);
  const [br, bg, bb] = parseRgb(tint);

  const albedo = new ImageData(size, size);
  const rough = new ImageData(size, size);
  const ao = new ImageData(size, size);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const idx = i * 4;
      const macro = fbm(n1, x, y, 3);
      const mid = fbm(n2, x * 1.4, y * 1.1, 3);
      const grit = n3(x, y);
      const vein = Math.abs(fbm(n2, x * 0.65 + 40, y * 1.8, 4) - 0.5);
      const crack = vein < 0.035 ? (0.035 - vein) / 0.035 : 0;
      const pit = Math.pow(Math.max(0, 0.62 - mid), 1.8);
      const tone = (macro - 0.5) * 46 + (mid - 0.5) * 28 + (grit - 0.5) * 16 - crack * 70 - pit * 24;

      albedo.data[idx] = Math.max(0, Math.min(255, br + tone));
      albedo.data[idx + 1] = Math.max(0, Math.min(255, bg + tone * 0.92));
      albedo.data[idx + 2] = Math.max(0, Math.min(255, bb + tone * 0.78));
      albedo.data[idx + 3] = 255;

      height[i] = macro * 0.45 + mid * 0.28 + grit * 0.18 - crack * 0.85 - pit * 0.35;
      const cavity = Math.min(1, crack * 0.85 + pit * 0.55 + (1 - mid) * 0.08);
      const aoV = Math.floor(255 * (1 - cavity * 0.72));
      ao.data[idx] = ao.data[idx + 1] = ao.data[idx + 2] = aoV;
      ao.data[idx + 3] = 255;

      const rv = Math.floor(168 + grit * 50 + crack * 40 - pit * 20);
      rough.data[idx] = rough.data[idx + 1] = rough.data[idx + 2] = Math.max(0, Math.min(255, rv));
      rough.data[idx + 3] = 255;
    }
  }

  return {
    map: texFromImageData(albedo, { srgb: true, repeat: 1 }),
    roughnessMap: texFromImageData(rough, { srgb: false, repeat: 1 }),
    normalMap: texFromImageData(heightToNormal(height, size, 4.4), { srgb: false, repeat: 1 }),
    aoMap: texFromImageData(ao, { srgb: false, repeat: 1 }),
  };
}

function makeStageMaps(tint: string): MaterialMaps {
  const size = 512;
  const rand = mulberry32(tint.split('').reduce((sum, char) => sum + char.charCodeAt(0), 19));
  const grain = makeNoiseField(size, 10, rand);
  const broad = makeNoiseField(size, 64, rand);

  const albedo = new ImageData(size, size);
  const rough = new ImageData(size, size);
  const ao = new ImageData(size, size);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const idx = i * 4;
      const board = fbm(grain, x * 3.2, y * 0.45, 3);
      const scuff = fbm(broad, x, y, 3);
      const streak = Math.sin(y * 0.42 + board * 6) * 0.5 + 0.5;
      const tone = (board - 0.5) * 22 + (scuff - 0.5) * 16 + (streak - 0.5) * 10;

      albedo.data[idx] = Math.max(0, Math.min(255, 214 + tone));
      albedo.data[idx + 1] = Math.max(0, Math.min(255, 210 + tone * 0.96));
      albedo.data[idx + 2] = Math.max(0, Math.min(255, 204 + tone * 0.9));
      albedo.data[idx + 3] = 255;

      height[i] = board * 0.35 + streak * 0.2 + scuff * 0.15;
      const rv = Math.floor(118 + (1 - streak) * 40 + scuff * 28);
      rough.data[idx] = rough.data[idx + 1] = rough.data[idx + 2] = Math.max(0, Math.min(255, rv));
      rough.data[idx + 3] = 255;
      const aoV = Math.floor(232 + scuff * 18);
      ao.data[idx] = ao.data[idx + 1] = ao.data[idx + 2] = Math.max(0, Math.min(255, aoV));
      ao.data[idx + 3] = 255;
    }
  }

  return {
    map: texFromImageData(albedo, { srgb: true, repeat: 1 }),
    roughnessMap: texFromImageData(rough, { srgb: false, repeat: 1 }),
    normalMap: texFromImageData(heightToNormal(height, size, 2.2), { srgb: false, repeat: 1 }),
    aoMap: texFromImageData(ao, { srgb: false, repeat: 1 }),
  };
}

function makeRockGeometry(seed: number) {
  const geo = new THREE.IcosahedronGeometry(0.46, 3);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();
  const squashY = 0.68 + (seed % 5) * 0.045;
  for (let i = 0; i < pos.count; i += 1) {
    vertex.fromBufferAttribute(pos, i);
    const n = vertex.clone().normalize();
    const warp = Math.sin(n.x * 2.6 + seed) * Math.cos(n.z * 2.2 + seed * 0.37);
    const chip = Math.sin(n.y * 7.2 + n.x * 4.4 + seed) * Math.sin(n.z * 5.8 + seed * 0.2);
    const ridge = Math.pow(Math.abs(Math.sin(n.x * 3.4 + n.y * 5.1 + seed)), 3);
    const radius = 0.46 * (0.84 + warp * 0.24 + chip * 0.08 - ridge * 0.09);
    vertex.set(
      n.x * radius * (1.08 + warp * 0.12),
      n.y * radius * squashY,
      n.z * radius * (0.92 + chip * 0.08),
    );
    if (vertex.y < -0.06) vertex.y = -0.06 + (vertex.y + 0.06) * 0.2;
    pos.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    vertex.fromBufferAttribute(pos, i);
    const len = vertex.length() || 1;
    const nx = vertex.x / len;
    const ny = THREE.MathUtils.clamp(vertex.y / len, -1, 1);
    const nz = vertex.z / len;
    uv.setXY(
      i,
      (0.5 + Math.atan2(nz, nx) / (Math.PI * 2)) * 1.7,
      (0.5 - Math.asin(ny) / Math.PI) * 1.7,
    );
  }
  uv.needsUpdate = true;
  geo.computeBoundingBox();
  geo.translate(0, -(geo.boundingBox?.min.y ?? 0), 0);
  geo.setAttribute('uv2', uv);
  return geo;
}

function assignUv2(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const uv = mesh.geometry.getAttribute('uv');
    if (uv && !mesh.geometry.getAttribute('uv2')) mesh.geometry.setAttribute('uv2', uv);
  });
}

function StoneMaterial({ maps, roughness }: { maps: MaterialMaps; roughness: number }) {
  return (
    <meshPhysicalMaterial
      color="#ffffff"
      map={maps.map}
      roughnessMap={maps.roughnessMap}
      normalMap={maps.normalMap}
      aoMap={maps.aoMap}
      aoMapIntensity={1.2}
      normalScale={STONE_NORMAL_SCALE}
      roughness={roughness}
      metalness={0.03}
      envMapIntensity={0.46}
      sheen={0.18}
      sheenRoughness={0.72}
      sheenColor="#c7beb2"
    />
  );
}

function RockMesh({ seed, tint }: { seed: number; tint: string }) {
  const geometry = useMemo(() => makeRockGeometry(seed), [seed]);
  const maps = useMemo(() => makeStoneMaps(tint, seed), [tint, seed]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <StoneMaterial maps={maps} roughness={0.78} />
    </mesh>
  );
}

function StageSet({ tint }: { tint: string }) {
  const maps = useMemo(() => makeStageMaps(tint), [tint]);
  const [r, g, b] = parseRgb(tint);
  const deck = `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
  const base = `#${[r, g, b].map((channel) => Math.round(channel * 0.48).toString(16).padStart(2, '0')).join('')}`;
  const group = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    if (group.current) assignUv2(group.current);
  }, [maps]);

  return (
    <group ref={group}>
      <RoundedBox args={[3.7, 0.16, 2.05]} radius={0.02} smoothness={3} position={[0, 0.08, 0]} castShadow receiveShadow>
        <meshPhysicalMaterial
          color={base}
          map={maps.map}
          roughnessMap={maps.roughnessMap}
          normalMap={maps.normalMap}
          aoMap={maps.aoMap}
          aoMapIntensity={0.65}
          normalScale={STAGE_NORMAL_SCALE}
          roughness={0.74}
          metalness={0.02}
          envMapIntensity={0.28}
        />
      </RoundedBox>
      <RoundedBox args={[3.22, 0.1, 1.58]} radius={0.028} smoothness={4} position={[0, 0.2, 0]} castShadow receiveShadow>
        <meshPhysicalMaterial
          color={deck}
          map={maps.map}
          roughnessMap={maps.roughnessMap}
          normalMap={maps.normalMap}
          aoMap={maps.aoMap}
          aoMapIntensity={0.85}
          normalScale={STAGE_NORMAL_SCALE}
          roughness={0.46}
          metalness={0.04}
          clearcoat={0.12}
          clearcoatRoughness={0.42}
          envMapIntensity={0.62}
        />
      </RoundedBox>
    </group>
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

/**
 * One seamless paper sweep: floor, cove, and wall.
 * Shade is stored in uv.y (0 = floor, 1 = wall) for the backdrop shader.
 */
export function createCycloramaGeometry() {
  const width = 12;
  const radius = 2.05;
  const centerZ = 0.15;
  const floorFront = 3.2;
  const wallTop = 5.8;
  const profile: { z: number; y: number; shade: number }[] = [];

  const floorSteps = 8;
  for (let i = 0; i <= floorSteps; i += 1) {
    const t = i / floorSteps;
    profile.push({
      z: floorFront + (centerZ - floorFront) * t,
      y: 0,
      shade: 0,
    });
  }

  const arcSteps = 32;
  for (let i = 1; i <= arcSteps; i += 1) {
    const t = i / arcSteps;
    const angle = -Math.PI / 2 - (Math.PI / 2) * t;
    profile.push({
      z: centerZ + Math.cos(angle) * radius,
      y: radius + Math.sin(angle) * radius,
      shade: t,
    });
  }

  const wallZ = centerZ - radius;
  const wallSteps = 10;
  for (let i = 1; i <= wallSteps; i += 1) {
    const t = i / wallSteps;
    profile.push({
      z: wallZ,
      y: radius + (wallTop - radius) * t,
      shade: 1,
    });
  }

  const xSegs = 1;
  const cols = xSegs + 1;
  const rows = profile.length;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  profile.forEach((point, row) => {
    for (let col = 0; col < cols; col += 1) {
      const vertex = col * rows + row;
      const index = vertex * 3;
      positions[index] = (col / xSegs - 0.5) * width;
      positions[index + 1] = point.y;
      positions[index + 2] = point.z;
      uvs[vertex * 2] = col / xSegs;
      uvs[vertex * 2 + 1] = point.shade;
    }
  });

  const indices: number[] = [];
  for (let col = 0; col < xSegs; col += 1) {
    for (let row = 0; row < rows - 1; row += 1) {
      const a = col * rows + row;
      const b = (col + 1) * rows + row;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const CYCLORAMA_VERT = /* glsl */`
varying float vShade;
void main() {
  vShade = uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CYCLORAMA_FRAG = /* glsl */`
uniform vec3 uWall;
uniform vec3 uFloor;
varying float vShade;
void main() {
  float t = smoothstep(0.02, 0.92, vShade);
  vec3 col = mix(uFloor, uWall, t);
  float crease = exp(-pow((vShade - 0.36) / 0.14, 2.0));
  col *= 1.0 - crease * 0.2;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** Paper cyclorama used by the Soft Studio look and the studio backdrop prop. */
export function CycloramaBackdrop({ color, floor }: { color: string; floor?: string }) {
  const geometry = useMemo(() => createCycloramaGeometry(), []);
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uWall: { value: new THREE.Color(color) },
      uFloor: { value: new THREE.Color(floor ?? color) },
    },
    vertexShader: CYCLORAMA_VERT,
    fragmentShader: CYCLORAMA_FRAG,
    toneMapped: false,
    lights: false,
  }), []);

  useEffect(() => {
    material.uniforms.uWall.value.set(color);
    material.uniforms.uFloor.value.set(floor ?? color);
  }, [material, color, floor]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh geometry={geometry} material={material} layers={1} receiveShadow raycast={() => null} />
  );
}

function ClayHelix({ color, seed, selected = false }: { color: string; seed: number; selected?: boolean }) {
  const geometry = useMemo(() => {
    const points = Array.from({ length: 96 }, (_, index) => {
      const t = index / 95;
      const angle = t * Math.PI * 7;
      return new THREE.Vector3(Math.cos(angle) * 0.26, t * 1.15 - 0.55, Math.sin(angle) * 0.26);
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 120, 0.055, 10, false);
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh castShadow receiveShadow geometry={geometry}>
      <ClayMaterial color={color} seed={seed} selected={selected} />
    </mesh>
  );
}

function PropMesh({ prop, selected = false, onSelect }: { prop: SceneProp; selected?: boolean; onSelect?: (id: string) => void }) {
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
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(prop.id);
      }}
    >
      {prop.kind === 'clay_sphere' && (
        <mesh castShadow receiveShadow>
          <sphereGeometry args={[0.55, 64, 64]} />
          <ClayMaterial color={clay} seed={seed} selected={selected} />
        </mesh>
      )}
      {prop.kind === 'clay_cube' && (
        <RoundedBox args={[0.9, 0.9, 0.9]} radius={0.12} smoothness={6} castShadow receiveShadow>
          <ClayMaterial color={clay} seed={seed} selected={selected} />
        </RoundedBox>
      )}
      {prop.kind === 'clay_cylinder' && (
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.42, 0.42, 0.95, 64]} />
          <ClayMaterial color={clay} seed={seed} selected={selected} />
        </mesh>
      )}
      {prop.kind === 'clay_torus' && (
        <mesh castShadow receiveShadow rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.48, 0.17, 48, 72]} />
          <ClayMaterial color={clay} seed={seed} selected={selected} />
        </mesh>
      )}
      {prop.kind === 'clay_cone' && (
        <mesh castShadow receiveShadow position={[0, 0.42, 0]}>
          <coneGeometry args={[0.46, 0.9, 48]} />
          <ClayMaterial color={clay} seed={seed} selected={selected} />
        </mesh>
      )}
      {prop.kind === 'clay_pyramid' && (
        <mesh castShadow receiveShadow position={[0, 0.4, 0]}>
          <coneGeometry args={[0.55, 0.86, 4]} />
          <ClayMaterial color={clay} seed={seed} selected={selected} />
        </mesh>
      )}
      {prop.kind === 'clay_helix' && (
        <ClayHelix color={clay} seed={seed} selected={selected} />
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
      {prop.kind === 'rock' && (
        <RockMesh seed={seed} tint={prop.color ?? '#8a8478'} />
      )}
      {prop.kind === 'stage' && (
        <StageSet tint={prop.color ?? '#2c2926'} />
      )}
    </group>
  );
}

/** Seamless paper cyclorama — floor sweeping up into the back wall. */
function StudioBackdrop({ color }: { color: string }) {
  return <CycloramaBackdrop color={color} />;
}

export default function SceneProps({
  props,
  selectedId = null,
  onSelect,
}: {
  props: SceneProp[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  if (!props.length) return null;
  return (
    <group>
      {props.map((prop) => (
        <PropMesh key={prop.id} prop={prop} selected={prop.id === selectedId} onSelect={onSelect} />
      ))}
    </group>
  );
}
