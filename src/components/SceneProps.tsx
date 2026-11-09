import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { accentPair, useAccentTheme } from '../lib/accentTheme';
import {
  TONE_ALUMINUM,
  TONE_CLAY,
  TONE_CONCRETE,
  TONE_CONCRETE_DARK,
  TONE_CONCRETE_SHADE,
  TONE_CONCRETE_SLAB,
  TONE_GRANITE,
  TONE_LIMESTONE,
  TONE_STAGE,
} from '../lib/referenceTones';
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
  const [accentTheme, , accentColor] = useAccentTheme();
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
      emissive={selected ? accentPair(accentTheme, accentColor).soft : '#000000'}
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
      sheenColor={TONE_LIMESTONE}
    />
  );
}

function HonedStone({ maps }: { maps: MaterialMaps }) {
  return (
    <meshPhysicalMaterial
      color="#ffffff"
      map={maps.map}
      roughnessMap={maps.roughnessMap}
      normalMap={maps.normalMap}
      normalScale={STONE_NORMAL_SCALE}
      roughness={0.58}
      metalness={0.02}
      clearcoat={0.12}
      clearcoatRoughness={0.4}
      envMapIntensity={0.42}
    />
  );
}

/** Original honed-stone cylinder. No third-party mesh. */
function StonePlinth({ seed, tint }: { seed: number; tint: string }) {
  const maps = useMemo(() => makeStoneMaps(tint, seed), [tint, seed]);
  return (
    <group>
      <mesh position={[0, 0.07, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.08, 1.16, 0.14, 72]} />
        <HonedStone maps={maps} />
      </mesh>
      <mesh position={[0, 0.48, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.76, 0.84, 0.66, 72]} />
        <HonedStone maps={maps} />
      </mesh>
      <mesh position={[0, 0.84, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.86, 0.86, 0.045, 72]} />
        <HonedStone maps={maps} />
      </mesh>
    </group>
  );
}

/** Thin brushed disc. Original geometry, coloured by the prop tint. */
function MetalDisc({ tint }: { tint: string }) {
  return (
    <mesh castShadow receiveShadow>
      <cylinderGeometry args={[1.2, 1.2, 0.035, 80]} />
      <meshPhysicalMaterial
        color={tint}
        metalness={1}
        roughness={0.16}
        envMapIntensity={1.3}
        clearcoat={0.2}
        clearcoatRoughness={0.18}
      />
    </mesh>
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

function StageSet({ tint, selected = false }: { tint: string; selected?: boolean }) {
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
          envMapIntensity={selected ? 0.42 : 0.28}
          emissive={selected ? '#ffffff' : '#000000'}
          emissiveIntensity={selected ? 0.05 : 0}
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
          envMapIntensity={selected ? 0.78 : 0.62}
          emissive={selected ? '#ffffff' : '#000000'}
          emissiveIntensity={selected ? 0.06 : 0}
        />
      </RoundedBox>
    </group>
  );
}

function ConcreteMaterial({ tint = TONE_CONCRETE, seed = 1 }: { tint?: string; seed?: number }) {
  const maps = useMemo(() => makeConcreteMaps(tint, seed), [tint, seed]);
  return (
    <meshStandardMaterial
      color="#ffffff"
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
 * `uv` tiles paper maps in world units; `shade` (uv2.x) blends floor → wall colour.
 */
export function createCycloramaGeometry() {
  // Wide + deep floor so the front lip stays out of typical product framing —
  // a short floor reads as a hard horizontal line and clips the PCSS cast.
  const width = 22;
  const radius = 2.05;
  const centerZ = 0.15;
  const floorFront = 10;
  const wallTop = 5.8;
  /** World metres per paper-texture repeat — keeps grain readable at studio scale. */
  const tile = 1.15;
  const profile: { z: number; y: number; shade: number; length: number }[] = [];

  const floorSteps = 10;
  for (let i = 0; i <= floorSteps; i += 1) {
    const t = i / floorSteps;
    const z = floorFront + (centerZ - floorFront) * t;
    const length = (floorFront - z);
    profile.push({ z, y: 0, shade: 0, length });
  }

  const arcSteps = 36;
  const floorLen = floorFront - centerZ;
  for (let i = 1; i <= arcSteps; i += 1) {
    const t = i / arcSteps;
    const angle = -Math.PI / 2 - (Math.PI / 2) * t;
    profile.push({
      z: centerZ + Math.cos(angle) * radius,
      y: radius + Math.sin(angle) * radius,
      shade: t,
      length: floorLen + radius * (Math.PI / 2) * t,
    });
  }

  const wallZ = centerZ - radius;
  const coveLen = floorLen + radius * (Math.PI / 2);
  const wallSteps = 12;
  for (let i = 1; i <= wallSteps; i += 1) {
    const t = i / wallSteps;
    const y = radius + (wallTop - radius) * t;
    profile.push({
      z: wallZ,
      y,
      shade: 1,
      length: coveLen + (y - radius),
    });
  }

  const xSegs = 36;
  const cols = xSegs + 1;
  const rows = profile.length;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const shades = new Float32Array(cols * rows);
  const colors = new Float32Array(cols * rows * 3);
  profile.forEach((point, row) => {
    for (let col = 0; col < cols; col += 1) {
      const vertex = col * rows + row;
      const index = vertex * 3;
      const x = (col / xSegs - 0.5) * width;
      positions[index] = x;
      positions[index + 1] = point.y;
      positions[index + 2] = point.z;
      uvs[vertex * 2] = (x + width / 2) / tile;
      uvs[vertex * 2 + 1] = point.length / tile;
      shades[vertex] = point.shade;
      colors[index] = 1;
      colors[index + 1] = 1;
      colors[index + 2] = 1;
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
  geometry.setAttribute('shade', new THREE.BufferAttribute(shades, 1));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makePaperMaps(seed = 11): MaterialMaps & { bumpMap: THREE.CanvasTexture } {
  const size = 512;
  const rand = mulberry32(seed * 9049 + 41);
  const n1 = makeNoiseField(size, 56, rand);
  const n2 = makeNoiseField(size, 18, rand);
  const n3 = makeNoiseField(size, 5, rand);

  const albedo = new ImageData(size, size);
  const rough = new ImageData(size, size);
  const bump = new ImageData(size, size);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const idx = i * 4;
      const soft = fbm(n1, x, y, 4);
      const mid = fbm(n2, x * 1.15, y * 1.15, 3);
      const fiber = n3(x * 1.8, y);
      // Directional pulp streaks (paper grain)
      const streak = n2(x * 0.35, y * 3.4);
      const pulp = (fiber - 0.5) * 0.55 + (streak - 0.5) * 0.35;

      // Keep grain near pure white so #ffffff backdrops stay white under ACES.
      const tone = (soft - 0.5) * 4 + (mid - 0.5) * 2.5 + pulp * 5;
      albedo.data[idx] = Math.max(0, Math.min(255, 252 + tone));
      albedo.data[idx + 1] = Math.max(0, Math.min(255, 252 + tone * 0.98));
      albedo.data[idx + 2] = Math.max(0, Math.min(255, 252 + tone * 0.96));
      albedo.data[idx + 3] = 255;

      height[i] = soft * 0.45 + mid * 0.3 + fiber * 0.35 + streak * 0.2;
      const hByte = Math.max(0, Math.min(255, Math.floor(height[i] * 255)));
      bump.data[idx] = bump.data[idx + 1] = bump.data[idx + 2] = hByte;
      bump.data[idx + 3] = 255;

      const rv = Math.floor(168 + fiber * 55 + soft * 25);
      rough.data[idx] = rough.data[idx + 1] = rough.data[idx + 2] = Math.max(0, Math.min(255, rv));
      rough.data[idx + 3] = 255;
    }
  }

  // Sparse pressed flecks — like cotton paper inclusions
  for (let k = 0; k < 420; k += 1) {
    const cx = Math.floor(rand() * size);
    const cy = Math.floor(rand() * size);
    const rad = 1 + Math.floor(rand() * 2.5);
    const lift = rand() > 0.55 ? 10 : -14;
    for (let oy = -rad; oy <= rad; oy += 1) {
      for (let ox = -rad; ox <= rad; ox += 1) {
        if (ox * ox + oy * oy > rad * rad) continue;
        const x = (cx + ox + size) % size;
        const y = (cy + oy + size) % size;
        const i = y * size + x;
        const idx = i * 4;
        const fall = 1 - Math.hypot(ox, oy) / (rad + 0.01);
        const d = lift * fall;
        albedo.data[idx] = Math.max(0, Math.min(255, albedo.data[idx] + d));
        albedo.data[idx + 1] = Math.max(0, Math.min(255, albedo.data[idx + 1] + d * 0.95));
        albedo.data[idx + 2] = Math.max(0, Math.min(255, albedo.data[idx + 2] + d * 0.9));
        height[i] += fall * (lift > 0 ? 0.08 : -0.06);
        const hByte = Math.max(0, Math.min(255, Math.floor(height[i] * 255)));
        bump.data[idx] = bump.data[idx + 1] = bump.data[idx + 2] = hByte;
      }
    }
  }

  return {
    map: texFromImageData(albedo, { srgb: true, repeat: 1 }),
    roughnessMap: texFromImageData(rough, { srgb: false, repeat: 1 }),
    normalMap: texFromImageData(heightToNormal(height, size, 2.6), { srgb: false, repeat: 1 }),
    bumpMap: texFromImageData(bump, { srgb: false, repeat: 1 }),
  };
}

/** Bump when albedo recipe changes so HMR / reloads don't keep a dirty grey map. */
const PAPER_MAPS_VERSION = 2;
let paperMapsCache: { version: number; maps: MaterialMaps & { bumpMap: THREE.CanvasTexture } } | null = null;
function getPaperMaps() {
  if (!paperMapsCache || paperMapsCache.version !== PAPER_MAPS_VERSION) {
    paperMapsCache = { version: PAPER_MAPS_VERSION, maps: makePaperMaps() };
  }
  return paperMapsCache.maps;
}

export type CycloramaContactPoint = {
  x: number;
  z: number;
  /** Half-extent of the contact silhouette along its yaw. */
  radiusX: number;
  /** Half-extent of the contact silhouette across its yaw. */
  radiusZ: number;
  /** Penumbra past the silhouette, in world units. */
  blur: number;
  /** Radians about Y. The card stays flat; only yaw turns it. */
  yaw: number;
  /** 0–1. Falls off as the device lifts off the floor. */
  weight: number;
};

/** Soft product contact baked into paper colour — climbs floor → cove without a shadow map. */
function applyCycloramaVertexColors(
  geometry: THREE.BufferGeometry,
  wallHex: string,
  floorHex: string,
  contactPoints: CycloramaContactPoint[] = [],
  contactStrength = 0,
  selectTintHex: string | null = null,
) {
  const shade = geometry.getAttribute('shade') as THREE.BufferAttribute | undefined;
  const color = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!shade || !color || !position) return;
  const wall = new THREE.Color(wallHex);
  const floor = new THREE.Color(floorHex);
  const mixed = new THREE.Color();
  const strength = THREE.MathUtils.clamp(contactStrength, 0, 1);
  // Selected backdrop: wash the sweep toward the accent so a tap reads on the canvas,
  // matching the emissive tint props get when picked.
  const selectTint = selectTintHex ? new THREE.Color(selectTintHex) : null;
  for (let i = 0; i < shade.count; i += 1) {
    const shadeV = shade.getX(i);
    const t = THREE.MathUtils.smoothstep(shadeV, 0.02, 0.92);
    mixed.copy(floor).lerp(wall, t);
    // Soft crease in the cove — keep it subtle so white sets don't go grey.
    const crease = Math.exp(-(((shadeV - 0.36) / 0.14) ** 2)) * 0.04;
    mixed.multiplyScalar(1 - crease);

    if (strength > 0.01 && contactPoints.length > 0) {
      // Floor + cove get the blob; fade before the upper wall so it doesn't stain the seamless.
      const heightFade = 1 - THREE.MathUtils.smoothstep(shadeV, 0.12, 0.72);
      if (heightFade > 0.01) {
        const vx = position.getX(i);
        const vz = position.getZ(i);
        let occ = 0;
        for (const point of contactPoints) {
          const dx = vx - point.x;
          const dz = vz - point.z;
          const cos = Math.cos(point.yaw || 0);
          const sin = Math.sin(point.yaw || 0);
          const lx = dx * cos - dz * sin;
          const lz = dx * sin + dz * cos;
          // Wide and faint so the coarse paper mesh only pools light,
          // while the floor card draws the actual silhouette.
          const sigmaX = Math.max(0.2, ((point.radiusX ?? 0.4) + (point.blur ?? 0.2)) * 2.1);
          const sigmaZ = Math.max(0.2, ((point.radiusZ ?? 0.2) + (point.blur ?? 0.2)) * 2.1);
          const rx = lx / sigmaX;
          const rz = lz / sigmaZ;
          occ += Math.exp(-(rx * rx + rz * rz) * 1.15) * (point.weight ?? 1);
        }
        mixed.multiplyScalar(1 - Math.min(1, occ) * heightFade * strength * 0.28);
      }
    }

    if (selectTint) mixed.lerp(selectTint, 0.16);

    color.setXYZ(i, mixed.r, mixed.g, mixed.b);
  }
  color.needsUpdate = true;
}

/** Invisible PCSS receiver that shares the paper mesh — darkens floor, cove, and
 *  wall without a coplanar catcher plate (those stripe the seamless). */
function CycloramaShadowOverlay({
  geometry,
  opacity,
  color,
}: {
  geometry: THREE.BufferGeometry;
  opacity: number;
  color: string;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    target.layers.set(1);
    target.raycast = () => null;
  }, []);
  if (opacity < 0.008) return null;
  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      layers={1}
      receiveShadow
      castShadow={false}
      renderOrder={2}
      userData={{ isStudioBackdrop: true, studioShadowCatcher: true }}
    >
      <shadowMaterial
        transparent
        opacity={THREE.MathUtils.clamp(opacity, 0, 0.88)}
        color={color}
        depthWrite={false}
        toneMapped={false}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-4}
      />
    </mesh>
  );
}

/** Paper cyclorama used by the Soft Studio look and the studio backdrop prop.
 *  Unlit vertex colours keep the seamless flat; a ShadowMaterial overlay of the
 *  same sweep receives the key PCSS so casts land on floor, cove, and wall. */
export function CycloramaBackdrop({
  color,
  floor,
  selected = false,
  onSelect,
  contactPoints = [],
  contactStrength = 0,
  shadowOpacity = 0,
  shadowColor = '#1a1c22',
}: {
  color: string;
  floor?: string;
  selected?: boolean;
  onSelect?: () => void;
  contactPoints?: CycloramaContactPoint[];
  contactStrength?: number;
  /** ShadowMaterial overlay opacity (0 hides the receiver). */
  shadowOpacity?: number;
  shadowSoftness?: number;
  lightPosition?: Vec3;
  lightTarget?: Vec3;
  shadowColor?: string;
}) {
  const geometry = useMemo(() => createCycloramaGeometry(), []);
  const [accentTheme, , accentColor] = useAccentTheme();
  const selectTint = selected ? accentPair(accentTheme, accentColor).soft : null;
  const floorColor = floor ?? color;
  const contactKey = contactPoints
    .map((point) => {
      const n = (value: number | undefined) => (
        typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '0.00'
      );
      return [n(point.x), n(point.z), n(point.radiusX), n(point.radiusZ), n(point.blur), n(point.yaw), n(point.weight)].join(':');
    })
    .join('|');

  useEffect(() => {
    applyCycloramaVertexColors(geometry, color, floorColor, contactPoints, contactStrength, selectTint);
  }, [geometry, color, floorColor, contactKey, contactPoints, contactStrength, selectTint]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group>
      <mesh
        geometry={geometry}
        layers={1}
        receiveShadow={false}
        castShadow={false}
        userData={{ isStudioBackdrop: true }}
        onClick={(event) => {
          event.stopPropagation();
          onSelect?.();
        }}
        onPointerDown={(event) => {
          // Claim the tap so orbit / device grab don't steal backdrop colour edits.
          if (event.button === 0) event.stopPropagation();
        }}
      >
        {/* Unlit paper — wrap lights must not wash the overlay stain. */}
        <meshBasicMaterial vertexColors toneMapped={false} />
      </mesh>
      <CycloramaShadowOverlay
        geometry={geometry}
        opacity={shadowOpacity}
        color={shadowColor}
      />
    </group>
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

const MOVABLE_PROP_KINDS = new Set<SceneProp['kind']>([
  'clay_sphere', 'clay_cube', 'clay_cylinder', 'clay_torus', 'clay_helix',
  'clay_cone', 'clay_pyramid', 'pedestal', 'stone_plinth', 'metal_disc', 'rock',
  'stage', 'concrete_slab',
]);

function PropMesh({
  prop,
  selected = false,
  onSelect,
  grabRegistry,
  onGizmoTargets,
  gizmoDraggingRef,
  backdropFloor,
  backdropShadowOpacity = 0.45,
  backdropShadowSoftness = 4.2,
  backdropLightPosition,
  backdropLightTarget,
  backdropShadowColor = '#0a0b0e',
}: {
  prop: SceneProp;
  selected?: boolean;
  onSelect?: (id: string) => void;
  grabRegistry?: MutableRefObject<Map<string, THREE.Object3D>>;
  onGizmoTargets?: (propId: string, targets: { position: THREE.Object3D; rotation: THREE.Object3D } | null) => void;
  gizmoDraggingRef?: MutableRefObject<boolean>;
  /** Floor stop for studio cyclorama props — matches the sky gradient edge. */
  backdropFloor?: string;
  backdropShadowOpacity?: number;
  backdropShadowSoftness?: number;
  backdropLightPosition?: Vec3;
  backdropLightTarget?: Vec3;
  backdropShadowColor?: string;
}) {
  const scale = asScale(prop.scale);
  const rot = prop.rotation;
  const pos = prop.position;
  const clay = prop.color ?? TONE_CLAY;
  const seed = prop.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const positionRef = useRef<THREE.Group>(null);
  const rotationRef = useRef<THREE.Group>(null);
  const scaleRef = useRef<THREE.Group>(null);
  const movable = MOVABLE_PROP_KINDS.has(prop.kind);

  useLayoutEffect(() => {
    const group = positionRef.current;
    const pivot = rotationRef.current;
    const registry = grabRegistry?.current;
    if (!group || !registry || !movable) return undefined;
    group.userData.propGrabId = prop.id;
    group.userData.rotationPivot = pivot ?? null;
    registry.set(prop.id, group);
    return () => {
      if (registry.get(prop.id) === group) registry.delete(prop.id);
      if (group.userData.rotationPivot === pivot) group.userData.rotationPivot = null;
    };
  }, [grabRegistry, prop.id, movable]);

  useLayoutEffect(() => {
    const position = positionRef.current;
    const rotation = rotationRef.current;
    const scaleGroup = scaleRef.current;
    if (!position || !rotation) return;
    if (scaleGroup) scaleGroup.scale.set(scale[0], scale[1], scale[2]);
    // While the gizmo is dragging, TransformControls owns the pose — don't fight it.
    if (gizmoDraggingRef?.current) return;
    position.position.set(pos.x, pos.y, pos.z);
    rotation.position.set(0, 0, 0);
    rotation.scale.setScalar(1);
    rotation.rotation.set(
      THREE.MathUtils.degToRad(rot.x),
      THREE.MathUtils.degToRad(rot.y),
      THREE.MathUtils.degToRad(rot.z),
    );
  }, [pos.x, pos.y, pos.z, rot.x, rot.y, rot.z, scale[0], scale[1], scale[2], gizmoDraggingRef]);

  useLayoutEffect(() => {
    if (!selected || !movable || !onGizmoTargets) return undefined;
    const position = positionRef.current;
    const rotation = rotationRef.current;
    if (position && rotation) onGizmoTargets(prop.id, { position, rotation });
    return () => onGizmoTargets(prop.id, null);
  }, [selected, movable, onGizmoTargets, prop.id]);

  return (
    <group
      ref={positionRef}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(prop.id);
      }}
    >
      <group ref={rotationRef}>
        <group ref={scaleRef}>
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
            <ConcreteMaterial tint={TONE_CONCRETE} seed={seed} />
          </mesh>
          <mesh position={[0, -1.32, 0.02]} castShadow receiveShadow>
            <boxGeometry args={[3.85, 0.06, 0.28]} />
            <ConcreteMaterial tint={TONE_CONCRETE_DARK} seed={seed + 3} />
          </mesh>
        </group>
      )}
      {prop.kind === 'concrete_slab' && (
        <group>
          <mesh receiveShadow castShadow>
            <boxGeometry args={[4.4, 0.14, 3.4]} />
            <ConcreteMaterial tint={TONE_CONCRETE_SLAB} seed={seed} />
          </mesh>
          <mesh position={[0, -0.09, 0]} receiveShadow>
            <boxGeometry args={[4.35, 0.04, 3.35]} />
            <meshStandardMaterial color={TONE_CONCRETE_SHADE} roughness={1} metalness={0} />
          </mesh>
        </group>
      )}
      {prop.kind === 'pedestal' && (
        <group>
          <RoundedBox args={[1.28, 0.22, 1.28]} radius={0.02} smoothness={3} position={[0, 0.11, 0]} castShadow receiveShadow>
            <ConcreteMaterial tint={TONE_CONCRETE} seed={seed} />
          </RoundedBox>
          <RoundedBox args={[1.02, 0.55, 1.02]} radius={0.025} smoothness={3} position={[0, 0.5, 0]} castShadow receiveShadow>
            <ConcreteMaterial tint={TONE_CONCRETE_DARK} seed={seed + 2} />
          </RoundedBox>
          <RoundedBox args={[1.18, 0.1, 1.18]} radius={0.02} smoothness={2} position={[0, 0.82, 0]} castShadow receiveShadow>
            <ConcreteMaterial tint={TONE_CONCRETE_SLAB} seed={seed + 4} />
          </RoundedBox>
        </group>
      )}
      {prop.kind === 'stone_plinth' && (
        <StonePlinth seed={seed} tint={prop.color ?? TONE_LIMESTONE} />
      )}
      {prop.kind === 'metal_disc' && (
        <MetalDisc tint={prop.color ?? TONE_ALUMINUM} />
      )}
      {prop.kind === 'studio_backdrop' && (
        <StudioBackdrop
          color={prop.color ?? '#ffffff'}
          floor={backdropFloor}
          selected={selected}
          onSelect={() => onSelect?.(prop.id)}
          shadowOpacity={backdropShadowOpacity}
          shadowSoftness={backdropShadowSoftness}
          lightPosition={backdropLightPosition}
          lightTarget={backdropLightTarget}
          shadowColor={backdropShadowColor}
        />
      )}
      {prop.kind === 'rock' && (
        <RockMesh seed={seed} tint={prop.color ?? TONE_GRANITE} />
      )}
      {prop.kind === 'stage' && (
        <StageSet tint={prop.color ?? TONE_STAGE} selected={selected} />
      )}
        </group>
      </group>
    </group>
  );
}

/** Seamless paper cyclorama — floor sweeping up into the back wall. */
function StudioBackdrop({
  color,
  floor,
  selected = false,
  onSelect,
  shadowOpacity = 0.45,
  shadowSoftness = 4.2,
  lightPosition,
  lightTarget,
  shadowColor = '#0a0b0e',
}: {
  color: string;
  floor?: string;
  selected?: boolean;
  onSelect?: () => void;
  shadowOpacity?: number;
  shadowSoftness?: number;
  lightPosition?: Vec3;
  lightTarget?: Vec3;
  shadowColor?: string;
}) {
  return (
    <CycloramaBackdrop
      color={color}
      floor={floor}
      selected={selected}
      onSelect={onSelect}
      shadowOpacity={shadowOpacity}
      shadowSoftness={shadowSoftness}
      lightPosition={lightPosition}
      lightTarget={lightTarget}
      shadowColor={shadowColor}
    />
  );
}

export default function SceneProps({
  props,
  selectedId = null,
  onSelect,
  grabRegistry,
  onGizmoTargets,
  gizmoDraggingRef,
  backdropFloor,
  backdropShadowOpacity = 0.45,
  backdropShadowSoftness = 4.2,
  backdropLightPosition,
  backdropLightTarget,
  backdropShadowColor = '#0a0b0e',
}: {
  props: SceneProp[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  grabRegistry?: MutableRefObject<Map<string, THREE.Object3D>>;
  onGizmoTargets?: (propId: string, targets: { position: THREE.Object3D; rotation: THREE.Object3D } | null) => void;
  gizmoDraggingRef?: MutableRefObject<boolean>;
  backdropFloor?: string;
  backdropShadowOpacity?: number;
  backdropShadowSoftness?: number;
  backdropLightPosition?: Vec3;
  backdropLightTarget?: Vec3;
  backdropShadowColor?: string;
}) {
  if (!props.length) return null;
  return (
    <group>
      {props.map((prop) => (
        <PropMesh
          key={prop.id}
          prop={prop}
          selected={prop.id === selectedId}
          onSelect={onSelect}
          grabRegistry={grabRegistry}
          onGizmoTargets={onGizmoTargets}
          gizmoDraggingRef={gizmoDraggingRef}
          backdropFloor={backdropFloor}
          backdropShadowOpacity={backdropShadowOpacity}
          backdropShadowSoftness={backdropShadowSoftness}
          backdropLightPosition={backdropLightPosition}
          backdropLightTarget={backdropLightTarget}
          backdropShadowColor={backdropShadowColor}
        />
      ))}
    </group>
  );
}
