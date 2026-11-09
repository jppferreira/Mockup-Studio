/**
 * Find best model-space Euler rot so screens face +Z and devices sit upright.
 * Rewrites `rot: [...]` in src/lib/devices.ts when --write is passed.
 *
 * Usage: node scripts/fix-device-orient.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Blob } from 'node:buffer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

globalThis.self = globalThis;
globalThis.Blob = Blob;
globalThis.HTMLImageElement = class HTMLImageElement {};
globalThis.Image = class Image {
  set src(_v) {
    queueMicrotask(() => this.onload?.());
  }
};
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
THREE.Cache.enabled = false;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const devicesPath = path.join(projectRoot, 'src/lib/devices.ts');
const write = process.argv.includes('--write');
const source = fs.readFileSync(devicesPath, 'utf8');

const modelsStart = source.indexOf('export const DEVICE_MODELS');
const modelsEnd = source.indexOf('\n];', modelsStart);
const modelsSrc = source.slice(modelsStart, modelsEnd + 3);

const entries = [];
const blockRe = /\{\s*id:\s*'([^']+)'[\s\S]*?url:\s*'([^']+)'[\s\S]*?screenMat:\s*'([^']+)'[\s\S]*?rot:\s*\[([^\]]+)\]/g;
let m;
while ((m = blockRe.exec(modelsSrc))) {
  const rot = m[4].split(',').map((s) => Function(`"use strict"; return (${s.trim()});`)());
  entries.push({ id: m[1], url: m[2], screenMat: m[3], rot });
}

function loadGltf(filePath) {
  const loader = new GLTFLoader();
  const buf = fs.readFileSync(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => loader.parse(ab, '', resolve, reject));
}

function classify(id) {
  if (/ipad|tablet/.test(id)) return 'tablet';
  if (/macbook|laptop/.test(id)) return 'laptop';
  if (/watch/.test(id)) return 'watch';
  if (/airpods|mdr_|skullcandy|jbl_|headphone/.test(id)) return 'headphones';
  if (/vision_pro|spatial/.test(id)) return 'spatial';
  return 'phone';
}

/** Collect local-space area-weighted screen normals (before any rot). */
function localScreenNormals(scene, screenMatName) {
  const samples = [];
  scene.updateMatrixWorld(true);

  const preferExact = [];
  const soft = [];
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const exact = mats.some((mat) => mat && mat.name === screenMatName);
    const softHit = mats.some((mat) => mat && /screen|display|oled|lcd|wallpaper|watch face/i.test(mat.name || ''));
    if (!exact && !softHit) return;
    (exact ? preferExact : soft).push(obj);
  });
  const meshes = preferExact.length ? preferExact : soft;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const na = new THREE.Vector3();
  const nb = new THREE.Vector3();
  const nc = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (const mesh of meshes) {
    const geo = mesh.geometry;
    if (!geo?.getAttribute('normal')) continue;
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const idx = geo.index;
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    const step = Math.max(1, Math.floor(triCount / 400));
    for (let t = 0; t < triCount; t += step) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);
      na.fromBufferAttribute(nor, i0);
      nb.fromBufferAttribute(nor, i1);
      nc.fromBufferAttribute(nor, i2);
      // Mesh-local → scene-local (identity rot assumed on scene root)
      n.copy(na).add(nb).add(nc).normalize().transformDirection(mesh.matrixWorld);
      const area = new THREE.Triangle(a, b, c).getArea();
      samples.push({ n: n.clone(), area });
    }
  }
  return samples;
}

function averageNormal(samples, rotMatrix) {
  if (!samples.length) return null;
  const sum = new THREE.Vector3();
  let w = 0;
  const tmp = new THREE.Vector3();
  for (const s of samples) {
    tmp.copy(s.n).applyMatrix3(rotMatrix);
    sum.addScaledVector(tmp, s.area);
    w += s.area;
  }
  return w > 0 ? sum.multiplyScalar(1 / w).normalize() : null;
}

function measureSize(scene, rot) {
  scene.rotation.set(rot[0], rot[1], rot[2]);
  scene.updateMatrixWorld(true);
  const size = new THREE.Vector3();
  new THREE.Box3().setFromObject(scene).getSize(size);
  return size;
}

function scorePose(size, normal, category) {
  if (!normal) return -100;
  const max = Math.max(size.x, size.y, size.z) || 1;
  const faceZ = Math.max(0, normal.z); // only reward facing camera, not back

  if (category === 'phone' || category === 'tablet') {
    // Hard requirements: tallest ≈ Y, thinnest ≈ Z, screen → +Z
    const tallY = size.y >= size.x && size.y >= size.z;
    const thinZ = size.z <= size.x && size.z <= size.y;
    let score = faceZ * 12;
    score += tallY ? 8 : -12;
    score += thinZ ? 6 : -10;
    score += (size.y / max) * 3;
    score -= Math.abs(normal.x) * 2;
    score -= Math.abs(normal.y) * 2;
    return score;
  }
  if (category === 'watch') {
    // Face up toward camera; crown/band vertical on Y when possible
    const tallY = size.y >= size.x * 0.9 && size.y >= size.z * 0.9;
    let score = faceZ * 12;
    score += tallY ? 5 : -4;
    score -= Math.abs(normal.x) * 2;
    return score;
  }
  if (category === 'laptop') {
    // Wide on X, screen toward +Z, not standing on an edge
    const wideX = size.x >= size.y && size.x >= size.z * 0.85;
    let score = faceZ * 10;
    score += wideX ? 5 : -6;
    score -= Math.abs(normal.y) * 2;
    return score;
  }
  // headphones / spatial — face +Z, prefer standing (Y among top dims)
  const standing = size.y >= size.x * 0.85 || size.y >= size.z * 0.85;
  let score = faceZ * 10;
  score += standing ? 4 : -5;
  return score;
}

function exprRot([x, y, z]) {
  const f = (v) => {
    if (Math.abs(v) < 1e-9) return '0';
    if (Math.abs(v - Math.PI) < 1e-9) return 'Math.PI';
    if (Math.abs(v + Math.PI) < 1e-9) return '-Math.PI';
    if (Math.abs(v - Math.PI / 2) < 1e-9) return 'Math.PI / 2';
    if (Math.abs(v + Math.PI / 2) < 1e-9) return '-Math.PI / 2';
    return String(v);
  };
  return `[${f(x)}, ${f(y)}, ${f(z)}]`;
}

function axisLabel(v) {
  if (!v) return 'n/a';
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  if (ax >= ay && ax >= az) return v.x >= 0 ? '+X' : '-X';
  if (ay >= ax && ay >= az) return v.y >= 0 ? '+Y' : '-Y';
  return v.z >= 0 ? '+Z' : '-Z';
}

const PI = Math.PI;
const CANDIDATES = [];
for (const x of [0, PI / 2, -PI / 2, PI]) {
  for (const y of [0, PI / 2, -PI / 2, PI]) {
    for (const z of [0, PI / 2, -PI / 2, PI]) {
      CANDIDATES.push([x, y, z]);
    }
  }
}

const fixes = [];
const report = [];

console.log(`Auditing ${entries.length} devices…`);

for (const entry of entries) {
  const file = path.join(projectRoot, 'public', entry.url.replace(/^\.\//, ''));
  if (!fs.existsSync(file)) {
    report.push({ id: entry.id, error: 'missing' });
    continue;
  }

  process.stdout.write(`  ${entry.id}… `);
  const gltf = await loadGltf(file);
  const scene = gltf.scene;
  scene.rotation.set(0, 0, 0);
  scene.updateMatrixWorld(true);

  const category = classify(entry.id);
  // Capture screen normals in authored (unrotated) scene space once
  scene.rotation.set(0, 0, 0);
  scene.updateMatrixWorld(true);
  const samples = localScreenNormals(scene, entry.screenMat);

  const evalRot = (rot) => {
    const e = new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ');
    const m4 = new THREE.Matrix4().makeRotationFromEuler(e);
    const m3 = new THREE.Matrix3().setFromMatrix4(m4);
    const normal = averageNormal(samples, m3);
    const size = measureSize(scene, rot);
    return { rot, size, normal, score: scorePose(size, normal, category) };
  };

  const current = evalRot(entry.rot);
  let best = current;
  for (const cand of CANDIDATES) {
    const r = evalRot(cand);
    if (r.score > best.score + 0.05) best = r;
  }

  const needsFix = best.score > current.score + 0.4;
  const row = {
    id: entry.id,
    category,
    current: exprRot(entry.rot),
    best: exprRot(best.rot),
    curFace: axisLabel(current.normal),
    bestFace: axisLabel(best.normal),
    curScore: +current.score.toFixed(2),
    bestScore: +best.score.toFixed(2),
    needsFix,
  };
  report.push(row);
  if (needsFix) fixes.push(row);
  console.log(`${row.curFace} score=${row.curScore}${needsFix ? ` → FIX ${row.best} (${row.bestFace})` : ' ok'}`);
}

console.log('\n=== SUMMARY ===');
for (const r of report) {
  if (r.error) {
    console.log(`MISS  ${r.id}`);
    continue;
  }
  const mark = r.needsFix ? 'FIX ' : r.curFace === '+Z' ? 'ok  ' : 'WEAK';
  console.log(`${mark} ${r.id.padEnd(28)} ${String(r.curFace).padEnd(3)} ${r.current} → ${r.best}`);
}

console.log(`\nFixes: ${fixes.length}/${report.length}`);
for (const f of fixes) {
  console.log(`  ${f.id}: ${f.current} → ${f.best}`);
}

if (write && fixes.length) {
  let next = source;
  for (const f of fixes) {
    const idEsc = f.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(id:\\s*'${idEsc}'[\\s\\S]*?rot:\\s*)\\[[^\\]]+\\]`, 'm');
    if (!re.test(next)) {
      console.warn('Could not rewrite', f.id);
      continue;
    }
    next = next.replace(re, `$1${f.best}`);
  }
  fs.writeFileSync(devicesPath, next);
  console.log(`\nWrote ${fixes.length} rot fixes → src/lib/devices.ts`);
} else if (!write) {
  console.log('\n(Dry run — pass --write to apply)');
} else {
  console.log('\nNothing to write.');
}
