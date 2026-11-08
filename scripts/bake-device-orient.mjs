/**
 * Bake each device GLB into a canonical rest pose:
 *   - upright (height ≈ Y)
 *   - screen facing +Z when a screen exists
 *   - geometric center at origin
 * Then print devices.ts rot replacements → [0, 0, 0].
 *
 * Usage: node scripts/bake-device-orient.mjs [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Blob } from 'node:buffer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

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

const dry = process.argv.includes('--dry');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const devicesPath = path.join(projectRoot, 'src/lib/devices.ts');
const source = fs.readFileSync(devicesPath, 'utf8');

const entries = [];
const blockRe =
  /\{\s*id:\s*'([^']+)'[\s\S]*?url:\s*'([^']+)'[\s\S]*?screenMat:\s*'([^']+)'[\s\S]*?rot:\s*\[([^\]]+)\]/g;
let m;
while ((m = blockRe.exec(source))) {
  const rot = m[4].split(',').map((s) => s.trim()).map((e) => {
    if (e === '0') return 0;
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${e});`)();
  });
  entries.push({ id: m[1], url: m[2], screenMat: m[3], rot });
}

const CANDIDATES = [];
for (const x of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
  for (const y of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    for (const z of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      CANDIDATES.push([x, y, z]);
    }
  }
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
    const soft = mats.some(
      (mat) => mat && /screen|display|oled|lcd|wallpaper|watch face/i.test(mat.name || '') && !/glass/i.test(mat.name || ''),
    );
    if (!hit && !soft) return;
    if (screenMatName && !hit && soft) {
      // Prefer exact screen mat elsewhere; still allow soft if nothing else sampled later
    }
    const use = hit || soft;
    if (!use) return;
    const geo = mesh.geometry;
    if (!geo?.getAttribute('normal') || !geo.getAttribute('position')) return;
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
      let i0;
      let i1;
      let i2;
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

function classifyCategory(id) {
  if (/ipad|tablet|homeview|imac/.test(id)) return 'tablet';
  if (/macbook|laptop/.test(id)) return 'laptop';
  if (/watch|chronograph|rolex/.test(id)) return 'watch';
  if (/airpods|mdr_|skullcandy|jbl_|headphone/.test(id)) return 'headphones';
  if (/vision_pro|spatial/.test(id)) return 'spatial';
  return 'phone';
}

function scorePose(size, normal, category) {
  let score = 0;
  if (normal) {
    score += normal.z * 4;
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
    else score -= 2;
  } else if (category === 'laptop') {
    if (size.y < size.x && size.y < size.z * 1.5) score += 1.5;
    if (thinnest !== 'y' && size.y < Math.max(size.x, size.z)) score += 0.5;
  } else if (category === 'headphones' || category === 'spatial') {
    if (tallest === 'y' || dims[1].a === 'y') score += 2;
    else score -= 1;
  }
  return score;
}

/** Freeze world transforms into each mesh geometry; leave identity local transforms. */
function bakeWorldTransforms(root) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((obj) => {
    if (/** @type {THREE.Mesh} */ (obj).isMesh) meshes.push(obj);
  });
  for (const mesh of meshes) {
    mesh.geometry = mesh.geometry.clone();
    mesh.geometry.applyMatrix4(mesh.matrixWorld);
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrix();
  }
  // Clear intermediate node transforms so only geometry carries pose.
  root.traverse((obj) => {
    if (obj === root) return;
    if (/** @type {THREE.Mesh} */ (obj).isMesh) return;
    obj.position.set(0, 0, 0);
    obj.rotation.set(0, 0, 0);
    obj.scale.set(1, 1, 1);
    obj.updateMatrix();
  });
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.traverse((obj) => {
    const mesh = /** @type {THREE.Mesh} */ (obj);
    if (!mesh.isMesh) return;
    mesh.geometry.translate(-center.x, -center.y, -center.z);
  });
  root.updateMatrixWorld(true);
}

function exportGlb(root) {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      root,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(Buffer.from(result));
        else reject(new Error('Expected binary GLB'));
      },
      reject,
      { binary: true, onlyVisible: false },
    );
  });
}

const report = [];

for (const entry of entries) {
  if (!entry.url) continue;
  const file = path.join(projectRoot, 'public', entry.url.replace(/^\.\//, ''));
  if (!fs.existsSync(file)) {
    report.push({ id: entry.id, error: 'missing' });
    continue;
  }

  const gltf = await loadGltf(file);
  const category = classifyCategory(entry.id);
  let best = { rot: entry.rot, score: -Infinity };

  for (const cand of CANDIDATES) {
    const r = gltf.scene.clone(true);
    r.rotation.set(cand[0], cand[1], cand[2]);
    r.updateMatrixWorld(true);
    const s = bboxSize(r);
    const n = screenNormal(r, entry.screenMat);
    const sc = scorePose(s, n, category);
    if (sc > best.score) best = { rot: cand, score: sc, size: s, normal: n };
  }

  // Prefer current rot when it's already near-best (keeps intentional yaw).
  {
    const cur = gltf.scene.clone(true);
    cur.rotation.set(entry.rot[0], entry.rot[1], entry.rot[2]);
    cur.updateMatrixWorld(true);
    const curScore = scorePose(bboxSize(cur), screenNormal(cur, entry.screenMat), category);
    if (curScore >= best.score - 0.35) best = { ...best, rot: entry.rot, score: curScore };
  }

  const scene = gltf.scene.clone(true);
  scene.rotation.set(best.rot[0], best.rot[1], best.rot[2]);
  scene.updateMatrixWorld(true);
  bakeWorldTransforms(scene);

  const afterSize = bboxSize(scene);
  const afterNormal = screenNormal(scene, entry.screenMat);

  if (!dry) {
    const buf = await exportGlb(scene);
    fs.writeFileSync(file, buf);
  }

  report.push({
    id: entry.id,
    bakedRot: best.rot.map((v) => +v.toFixed(4)),
    size: [afterSize.x, afterSize.y, afterSize.z].map((v) => +v.toFixed(3)),
    normal: afterNormal
      ? [afterNormal.x, afterNormal.y, afterNormal.z].map((v) => +v.toFixed(3))
      : null,
    bytes: dry ? null : fs.statSync(file).size,
  });
  console.log(
    `${dry ? '[dry] ' : ''}${entry.id}: bake ${best.rot.map((v) => v.toFixed(3)).join(',')} → identity  n=${
      afterNormal ? afterNormal.z.toFixed(2) : 'n/a'
    }`,
  );
}

// Zero every rot: [ ... ] that belongs to a DEVICE_MODELS gltf entry we touched.
if (!dry) {
  let next = source;
  for (const entry of entries) {
    // Replace the first rot array after this id occurrence inside DEVICE_MODELS.
    const idToken = `id: '${entry.id}'`;
    const idAt = next.indexOf(idToken);
    if (idAt < 0) continue;
    const rotAt = next.indexOf('rot: [', idAt);
    if (rotAt < 0 || rotAt - idAt > 1200) continue;
    const rotEnd = next.indexOf(']', rotAt);
    next = `${next.slice(0, rotAt)}rot: [0, 0, 0]${next.slice(rotEnd + 1)}`;
  }
  fs.writeFileSync(devicesPath, next);
  console.log('\nUpdated devices.ts → all baked devices use rot: [0, 0, 0]');
}

console.log(`\nDone. ${report.length} models ${dry ? 'analyzed' : 'baked'}.`);
