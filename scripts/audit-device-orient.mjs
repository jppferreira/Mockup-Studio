/**
 * Audit device GLB orientations vs devices.ts `rot`.
 * Target: after rot, height ≈ Y and screen faces +Z (phones/tablets/watches/laptops).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Blob } from 'node:buffer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Minimal browser polyfills so GLTFLoader can skip textures in Node.
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
const source = fs.readFileSync(devicesPath, 'utf8');

/** Parse DEVICE_MODELS entries: id, screenMat, rot expression, url */
const entries = [];
const blockRe = /\{\s*id:\s*'([^']+)'[\s\S]*?url:\s*'([^']+)'[\s\S]*?screenMat:\s*'([^']+)'[\s\S]*?rot:\s*\[([^\]]+)\]/g;
let m;
while ((m = blockRe.exec(source))) {
  const id = m[1];
  const url = m[2];
  const screenMat = m[3];
  const rotExpr = m[4].split(',').map((s) => s.trim());
  const rot = rotExpr.map((e) => {
    if (e === '0') return 0;
    if (e === 'Math.PI') return Math.PI;
    if (e === 'Math.PI / 2') return Math.PI / 2;
    if (e === '-Math.PI / 2') return -Math.PI / 2;
    if (e === 'Math.PI / 4') return Math.PI / 4;
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${e});`)();
  });
  entries.push({ id, url, screenMat, rot });
}

function loadGltf(filePath) {
  const loader = new GLTFLoader();
  const buf = fs.readFileSync(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => {
    loader.parse(ab, '', resolve, reject);
  });
}

function bboxSize(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  box.getSize(size);
  return size;
}

function screenNormal(root, screenMatName) {
  const normals = [];
  const areas = [];
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    const mesh = /** @type {THREE.Mesh} */ (obj);
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const hit = mats.some((mat) => mat && mat.name === screenMatName);
    if (!hit && !mats.some((mat) => mat && /screen|display|oled|lcd|wallpaper|watch face/i.test(mat.name || ''))) {
      // still allow preferred name only when exact
      if (!hit) return;
    }
    if (!hit && screenMatName) {
      // Prefer exact screenMat; skip soft fallbacks when exact exists elsewhere — still collect soft
    }
    const use =
      hit ||
      mats.some((mat) => mat && /screen|display|oled|lcd|wallpaper|watch face/i.test(mat?.name || ''));
    if (!use) return;
    const geo = mesh.geometry;
    if (!geo) return;
    if (!geo.getAttribute('normal')) return;
    geo.computeBoundingBox();
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const idx = geo.index;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const na = new THREE.Vector3();
    const nb = new THREE.Vector3();
    const nc = new THREE.Vector3();
    const n = new THREE.Vector3();
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    const sample = Math.min(triCount, 400);
    const step = Math.max(1, Math.floor(triCount / sample));
    for (let t = 0; t < triCount; t += step) {
      let i0, i1, i2;
      if (idx) {
        i0 = idx.getX(t * 3);
        i1 = idx.getX(t * 3 + 1);
        i2 = idx.getX(t * 3 + 2);
      } else {
        i0 = t * 3;
        i1 = t * 3 + 1;
        i2 = t * 3 + 2;
      }
      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);
      na.fromBufferAttribute(nor, i0);
      nb.fromBufferAttribute(nor, i1);
      nc.fromBufferAttribute(nor, i2);
      n.copy(na).add(nb).add(nc).normalize();
      n.transformDirection(mesh.matrixWorld);
      const area = b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5;
      normals.push(n.clone());
      areas.push(area);
    }
  });
  if (!normals.length) return null;
  const sum = new THREE.Vector3();
  let w = 0;
  for (let i = 0; i < normals.length; i++) {
    sum.addScaledVector(normals[i], areas[i]);
    w += areas[i];
  }
  if (w <= 0) return null;
  return sum.multiplyScalar(1 / w).normalize();
}

function axisLabel(v) {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  if (ax >= ay && ax >= az) return v.x >= 0 ? '+X' : '-X';
  if (ay >= ax && ay >= az) return v.y >= 0 ? '+Y' : '-Y';
  return v.z >= 0 ? '+Z' : '-Z';
}

function fmt(v) {
  return `[${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}]`;
}

function classifyCategory(id) {
  if (/ipad|tablet/.test(id)) return 'tablet';
  if (/macbook|laptop/.test(id)) return 'laptop';
  if (/watch|chronograph|rolex/.test(id)) return 'watch';
  if (/airpods|mdr_|skullcandy|jbl_|headphone/.test(id)) return 'headphones';
  if (/vision_pro|spatial/.test(id)) return 'spatial';
  return 'phone';
}

/** Candidate Euler triples (radians) commonly needed for device GLBs. */
const CANDIDATES = [];
for (const x of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
  for (const y of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    for (const z of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      CANDIDATES.push([x, y, z]);
    }
  }
}

function scorePose(size, normal, category) {
  // Prefer thin depth on Z for phones/tablets/watches; screen normal → +Z
  // Height should be largest (or near-largest) on Y for phones/watches/tablets.
  // Laptops: depth/height small on Y relative to XZ footprint; screen still +Z-ish.
  let score = 0;
  if (normal) {
    score += normal.z * 4; // face +Z
    score -= Math.abs(normal.x) * 1.5;
    score -= Math.abs(normal.y) * 1.2;
  }
  const dims = [
    { a: 'x', v: size.x },
    { a: 'y', v: size.y },
    { a: 'z', v: size.z },
  ].sort((a, b) => b.v - a.v);
  const tallest = dims[0].a;
  const thinnest = dims[2].a;

  if (category === 'phone' || category === 'tablet' || category === 'watch') {
    if (tallest === 'y') score += 3;
    else score -= 2;
    if (thinnest === 'z') score += 2;
    else if (thinnest === 'x') score -= 1;
    else score -= 2; // thin on Y = lying flat-ish wrong for phone
  } else if (category === 'laptop') {
    // Open laptop: width X large, depth Z medium, height Y smaller than X/Z usually
    if (size.y < size.x && size.y < size.z * 1.5) score += 1.5;
    if (thinnest !== 'y' && size.y < Math.max(size.x, size.z)) score += 0.5;
  } else if (category === 'headphones' || category === 'spatial') {
    // Prefer "standing" — height Y among top two dims
    if (tallest === 'y' || dims[1].a === 'y') score += 2;
    else score -= 1;
  }
  return score;
}

function exprRot([x, y, z]) {
  const f = (v) => {
    if (Math.abs(v) < 1e-9) return '0';
    if (Math.abs(v - Math.PI) < 1e-9) return 'Math.PI';
    if (Math.abs(v + Math.PI) < 1e-9) return '-Math.PI';
    if (Math.abs(v - Math.PI / 2) < 1e-9) return 'Math.PI / 2';
    if (Math.abs(v + Math.PI / 2) < 1e-9) return '-Math.PI / 2';
    if (Math.abs(v - Math.PI / 4) < 1e-9) return 'Math.PI / 4';
    if (Math.abs(v + Math.PI / 4) < 1e-9) return '-Math.PI / 4';
    return String(v);
  };
  return `[${f(x)}, ${f(y)}, ${f(z)}]`;
}

const results = [];

for (const entry of entries) {
  if (!entry.url) {
    results.push({ id: entry.id, skip: 'procedural / no glb url' });
    continue;
  }
  const file = path.join(projectRoot, 'public', entry.url.replace(/^\.\//, ''));
  if (!fs.existsSync(file)) {
    results.push({ id: entry.id, error: 'missing file', file });
    continue;
  }
  const gltf = await loadGltf(file);
  const category = classifyCategory(entry.id);

  // Evaluate current rot
  const currentRoot = gltf.scene.clone(true);
  currentRoot.rotation.set(entry.rot[0], entry.rot[1], entry.rot[2]);
  currentRoot.updateMatrixWorld(true);
  const size = bboxSize(currentRoot);
  const normal = screenNormal(currentRoot, entry.screenMat);

  // Search best candidate from identity scene
  let best = { rot: entry.rot, score: -Infinity, size, normal };
  for (const cand of CANDIDATES) {
    const r = gltf.scene.clone(true);
    r.rotation.set(cand[0], cand[1], cand[2]);
    r.updateMatrixWorld(true);
    const s = bboxSize(r);
    const n = screenNormal(r, entry.screenMat);
    const sc = scorePose(s, n, category);
    if (sc > best.score) best = { rot: cand, score: sc, size: s, normal: n };
  }

  const currentScore = scorePose(size, normal, category);
  const needsFix = best.score > currentScore + 0.4;

  results.push({
    id: entry.id,
    category,
    currentRot: exprRot(entry.rot),
    currentSize: fmt(size),
    currentNormal: normal ? `${fmt(normal)} → ${axisLabel(normal)}` : 'n/a',
    currentScore: currentScore.toFixed(2),
    bestRot: exprRot(best.rot),
    bestSize: fmt(best.size),
    bestNormal: best.normal ? `${fmt(best.normal)} → ${axisLabel(best.normal)}` : 'n/a',
    bestScore: best.score.toFixed(2),
    needsFix,
  });
}

console.log(JSON.stringify(results, null, 2));
console.log('\n=== NEEDS FIX ===');
for (const r of results.filter((x) => x.needsFix)) {
  console.log(`${r.id}: ${r.currentRot} → ${r.bestRot}  (n ${r.currentNormal} → ${r.bestNormal})`);
}
console.log(`\nFixed candidates: ${results.filter((x) => x.needsFix).length}/${results.length}`);
