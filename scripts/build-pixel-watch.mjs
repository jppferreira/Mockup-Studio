/**
 * Builds public/models/pixel_watch.glb — 41mm Pixel Watch 5.
 * Screen faces +Z, 12 o'clock is +Y, crown is +X. Units are millimetres.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import * as THREE from 'three';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'public/models/pixel_watch.glb');
const previewDir = path.join(root, 'scripts/.pixel-preview');

const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  a: ['00000', '00000', '01110', '00001', '01111', '10001', '01111'],
  c: ['00000', '00000', '01110', '10000', '10000', '10000', '01110'],
  e: ['00000', '00000', '01110', '10001', '11111', '10000', '01110'],
  g: ['00000', '00000', '01111', '10001', '01111', '00001', '01110'],
  h: ['10000', '10000', '10110', '11001', '10001', '10001', '10001'],
  i: ['00100', '00000', '01100', '00100', '00100', '00100', '01110'],
  k: ['10000', '10000', '10010', '10100', '11000', '10100', '10010'],
  l: ['01100', '00100', '00100', '00100', '00100', '00100', '01110'],
  m: ['00000', '00000', '11010', '10101', '10101', '10101', '10101'],
  n: ['00000', '00000', '10110', '11001', '10001', '10001', '10001'],
  o: ['00000', '00000', '01110', '10001', '10001', '10001', '01110'],
  p: ['00000', '00000', '11110', '10001', '11110', '10000', '10000'],
  r: ['00000', '00000', '10110', '11001', '10000', '10000', '10000'],
  s: ['00000', '00000', '01111', '10000', '01110', '00001', '11110'],
  t: ['00100', '00100', '11111', '00100', '00100', '00100', '00011'],
  u: ['00000', '00000', '10001', '10001', '10001', '10011', '01101'],
  x: ['00000', '00000', '10001', '01010', '00100', '01010', '10001'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  ' ': ['000', '000', '000', '000', '000', '000', '000'],
};

function srgbToLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearColor(hex) {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createImage(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

function plot(img, x, y, color, alpha = 255) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= img.width || py >= img.height) return;
  const i = (py * img.width + px) * 4;
  const srcA = alpha / 255;
  const dstA = img.data[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  for (let c = 0; c < 3; c += 1) {
    img.data[i + c] = Math.round((color[c] * srcA + img.data[i + c] * dstA * (1 - srcA)) / outA);
  }
  img.data[i + 3] = Math.round(outA * 255);
}

function fill(img, color) {
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = color[0];
    img.data[i + 1] = color[1];
    img.data[i + 2] = color[2];
    img.data[i + 3] = color[3] ?? 255;
  }
}

function stamp(img, ch, px, py, scale, upX, upY, color) {
  const rows = FONT[ch];
  if (!rows) return;
  const gh = rows.length;
  const gw = rows[0].length;
  const rightX = -upY;
  const rightY = upX;
  const downX = -upX;
  const downY = -upY;
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      if (rows[gy][gx] !== '1') continue;
      const lx = (gx - (gw - 1) / 2) * scale;
      const ly = (gy - (gh - 1) / 2) * scale;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const ox = lx + sx - scale / 2;
          const oy = ly + sy - scale / 2;
          plot(img, px + ox * rightX + oy * downX, py + ox * rightY + oy * downY, color);
        }
      }
    }
  }
}

function textWidth(text, scale) {
  let width = 0;
  for (const ch of text) width += ((FONT[ch]?.[0].length ?? 3) + 1) * scale;
  return width;
}

function drawArcText(img, text, radius, angle, scale, color) {
  const cx = img.width / 2;
  const cy = img.height / 2;
  const total = textWidth(text, scale);
  let cursor = total / 2;
  for (const ch of text) {
    const gw = (FONT[ch]?.[0].length ?? 3) + 1;
    const adv = gw * scale;
    cursor -= adv / 2;
    const a = angle + cursor / radius;
    const px = cx + Math.cos(a) * radius;
    const py = cy - Math.sin(a) * radius;
    stamp(img, ch, px, py, scale, Math.cos(a), -Math.sin(a), color);
    cursor -= adv / 2;
  }
}

function drawStraight(img, text, x, y, scale, color) {
  let cursor = x;
  for (const ch of text) {
    const gw = (FONT[ch]?.[0].length ?? 3) + 1;
    stamp(img, ch, cursor + (gw * scale) / 2, y, scale, 0, -1, color);
    cursor += gw * scale;
  }
}

function smooth(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function makeFace() {
  const w = 1024;
  const img = createImage(w, w);
  fill(img, [0, 0, 0, 255]);
  const cx = w * 0.5;
  const cy = w * 0.52;
  for (let y = 0; y < w; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = (x - cx) / w;
      const dy = (y - cy) / w;
      const ang = Math.atan2(dy, dx);
      const r = Math.hypot(dx * 1.02, dy * 0.94);
      const warp = Math.sin(ang * 3 + r * 14) * 0.018 + Math.sin(ang * 7 - r * 9) * 0.008;
      const ridge = Math.sin((r + warp) * 86 + Math.sin(ang * 2) * 0.7);
      const ridge2 = Math.sin((r * 1.35 - warp) * 54 + ang * 2);
      const band = smooth(1 - Math.abs(ridge));
      const fine = smooth(1 - Math.abs(ridge2)) * 0.45;
      const falloff = smooth((0.46 - r) / 0.34) * smooth((r - 0.02) / 0.12);
      const violet = 0.22 + band * 0.78 + fine * 0.25;
      const streakDir = ang + 2.35;
      const streakAngle = ((streakDir + Math.PI) % (Math.PI * 2)) - Math.PI;
      const streak = Math.exp(-(streakAngle ** 2) * 3.2)
        * Math.exp(-((r - 0.22) ** 2) / 0.03);
      const glow = Math.exp(-((dx + 0.08) ** 2) / 0.02 - ((dy + 0.06) ** 2) / 0.018);
      let red = (18 + violet * 70 + glow * 40) * falloff + streak * 150;
      let green = (6 + violet * 18 + glow * 16) * falloff + streak * 55;
      let blue = (28 + violet * 110 + glow * 70) * falloff + streak * 210;
      const i = (y * w + x) * 4;
      img.data[i] = Math.max(img.data[i], Math.min(255, red));
      img.data[i + 1] = Math.max(img.data[i + 1], Math.min(255, green));
      img.data[i + 2] = Math.max(img.data[i + 2], Math.min(255, blue));
    }
  }
  // Four-point sparkle, lower-left of centre, matching the reference face.
  const sx = w * 0.40;
  const sy = w * 0.64;
  for (let y = -48; y <= 48; y += 1) {
    for (let x = -48; x <= 48; x += 1) {
      const armH = Math.exp(-Math.abs(x) / 7) * Math.exp(-(y * y) / 18);
      const armV = Math.exp(-Math.abs(y) / 10) * Math.exp(-(x * x) / 14);
      const core = Math.exp(-(x * x + y * y) / 20);
      const v = Math.min(1, armH * 0.85 + armV * 0.55 + core);
      if (v < 0.03) continue;
      plot(img, sx + x, sy + y, [230, 210, 255], Math.round(v * 255));
    }
  }
  // Small complication mark, upper left.
  for (let y = -8; y <= 8; y += 1) {
    for (let x = -16; x <= 16; x += 1) {
      const d = Math.hypot(x / 16, y / 7);
      if (d < 1) plot(img, w * 0.30 + x, w * 0.30 + y, [236, 236, 242], 230);
    }
  }
  return img;
}

function makeBackPlate() {
  const w = 1024;
  const img = createImage(w, w);
  const cx = w / 2;
  const cy = w / 2;
  for (let y = 0; y < w; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy) / (w * 0.5);
      const shade = r < 1 ? 28 + (1 - r) * 22 : 0;
      const i = (y * w + x) * 4;
      img.data[i] = shade;
      img.data[i + 1] = shade;
      img.data[i + 2] = shade + 2;
      img.data[i + 3] = r < 1 ? 255 : 0;
    }
  }
  const ink = [176, 180, 186];
  const faint = [120, 124, 130];
  drawArcText(img, 'Google', 430, Math.PI / 2, 5, ink);
  drawArcText(img, 'SpO2', 438, 2.15, 4, ink);
  drawArcText(img, 'Sleep tracking', 430, Math.PI, 4, ink);
  drawArcText(img, 'Pixel Watch 5', 424, 0.42, 4, ink);
  drawArcText(img, '41mm', 438, -0.22, 4, ink);
  drawArcText(img, 'Heart Rate Sensor', 418, -0.85, 4, ink);
  drawArcText(img, 'UWB', 440, -Math.PI / 2, 4, ink);
  drawArcText(img, 'ECG', 250, Math.PI + 0.55, 3, faint);
  // Faint seating ring around the optical cluster.
  for (let y = 0; y < w; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const r = Math.hypot(x - cx, y - cy);
      if (Math.abs(r - 168) < 1.4 || Math.abs(r - 292) < 1.1) {
        plot(img, x, y, [90, 92, 98], 180);
      }
    }
  }
  return img;
}

function makeEngraving() {
  const img = createImage(768, 320);
  const ink = [188, 192, 198];
  drawStraight(img, 'Stainless', 70, 110, 7, ink);
  drawStraight(img, 'IP68', 250, 230, 7, ink);
  return img;
}

function makeBandTexture() {
  const w = 256;
  const img = createImage(w, w);
  for (let y = 0; y < w; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const n = Math.sin(x * 12.7) * Math.sin(y * 9.3) * 6 + Math.sin((x + y) * 3.1) * 4;
      const v = Math.max(0, Math.min(255, 32 + n));
      const i = (y * w + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v + 1;
      img.data[i + 3] = 255;
    }
  }
  return img;
}

function hash(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function makeBandRoughness() {
  const w = 256;
  const img = createImage(w, w);
  for (let y = 0; y < w; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const n = hash(x, y);
      const rough = Math.round(170 + n * 50);
      const i = (y * w + x) * 4;
      img.data[i] = 0;
      img.data[i + 1] = rough;
      img.data[i + 2] = 0;
      img.data[i + 3] = 255;
    }
  }
  return img;
}

function flipCircleUv(geo) {
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i += 1) uv.setY(i, 1 - uv.getY(i));
  uv.needsUpdate = true;
}

function profileRadius(z) {
  const samples = [
    [-6.2, 8],
    [-5.3, 16.6],
    [-4.1, 19.15],
    [-2.2, 20.35],
    [0.2, 20.55],
    [2.2, 20.15],
    [3.7, 18.85],
    [4.7, 17.3],
  ];
  if (z <= samples[0][0]) return samples[0][1];
  if (z >= samples[samples.length - 1][0]) return samples[samples.length - 1][1];
  for (let i = 0; i < samples.length - 1; i += 1) {
    const [z0, r0] = samples[i];
    const [z1, r1] = samples[i + 1];
    if (z >= z0 && z <= z1) return r0 + ((z - z0) / (z1 - z0)) * (r1 - r0);
  }
  return 20;
}

function latheAroundZ(profile, segments) {
  const rings = profile.length;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const normals2 = [];
  for (let j = 0; j < rings; j += 1) {
    const prev = profile[Math.max(0, j - 1)];
    const next = profile[Math.min(rings - 1, j + 1)];
    let nr = next.z - prev.z;
    let nz = -(next.r - prev.r);
    const len = Math.hypot(nr, nz) || 1;
    nr /= len;
    nz /= len;
    if (profile[j].r < 0.05) {
      nr = 0;
      nz = j === 0 ? -1 : 1;
    }
    normals2.push({ nr, nz });
  }
  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments;
    const theta = u * Math.PI * 2 + Math.PI;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    for (let j = 0; j < rings; j += 1) {
      const p = profile[j];
      const n = normals2[j];
      positions.push(p.r * cos, p.r * sin, p.z);
      normals.push(n.nr * cos, n.nr * sin, n.nz);
      uvs.push(u, j / (rings - 1));
    }
  }
  for (let i = 0; i < segments; i += 1) {
    for (let j = 0; j < rings - 1; j += 1) {
      const a = i * rings + j;
      const b = a + rings;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return bufferFrom(positions, normals, uvs, indices);
}

function bufferFrom(positions, normals, uvs, indices) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function pillSection(width, thickness, radius, seg) {
  const hw = width / 2;
  const hh = thickness / 2;
  const r = Math.min(radius, hw, hh);
  const straight = hw - r;
  const pts = [];
  const add = (x, y, nx, ny) => pts.push({ x, y, nx, ny });
  for (let i = 0; i <= seg; i += 1) {
    const a = -Math.PI / 2 + Math.PI * (i / seg);
    add(straight + Math.cos(a) * r, Math.sin(a) * r, Math.cos(a), Math.sin(a));
  }
  for (let i = 0; i <= seg; i += 1) {
    const a = Math.PI / 2 + Math.PI * (i / seg);
    add(-straight + Math.cos(a) * r, Math.sin(a) * r, Math.cos(a), Math.sin(a));
  }
  return pts;
}

function frameAt(curve, t, mode) {
  const tt = Math.min(0.997, Math.max(0.003, t));
  const p = curve.getPointAt(tt);
  const tangent = curve.getTangentAt(tt).normalize();
  const widthDir = new THREE.Vector3();
  const thickDir = new THREE.Vector3();
  if (mode === 'flatZ') {
    thickDir.set(0, 0, 1).addScaledVector(tangent, -tangent.z);
    if (thickDir.lengthSq() < 1e-4) thickDir.set(0, 1, 0);
    thickDir.normalize();
    widthDir.crossVectors(thickDir, tangent).normalize();
    if (widthDir.x < 0) {
      widthDir.negate();
      thickDir.negate();
    }
  } else {
    widthDir.set(1, 0, 0).addScaledVector(tangent, -tangent.x);
    if (widthDir.lengthSq() < 1e-4) widthDir.set(0, 1, 0).addScaledVector(tangent, -tangent.y);
    widthDir.normalize();
    if (widthDir.x < 0) widthDir.negate();
    thickDir.crossVectors(tangent, widthDir).normalize();
    const outward = p.clone().sub(new THREE.Vector3(0, 0, -32));
    if (thickDir.dot(outward) < 0) thickDir.negate();
  }
  return { p, tangent, widthDir, thickDir };
}

function buildSweep(curve, steps, width, thickness, radius, mode, widthFn = () => 1) {
  const sectionCount = pillSection(width, thickness, radius, 5).length;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const frame = frameAt(curve, t, mode);
    const section = pillSection(width * widthFn(t), thickness * (0.85 + 0.15 * widthFn(t)), radius, 5);
    section.forEach((sp, k) => {
      const pos = frame.p.clone()
        .addScaledVector(frame.widthDir, sp.x)
        .addScaledVector(frame.thickDir, sp.y);
      const nor = frame.widthDir.clone().multiplyScalar(sp.nx).addScaledVector(frame.thickDir, sp.ny).normalize();
      positions.push(pos.x, pos.y, pos.z);
      normals.push(nor.x, nor.y, nor.z);
      uvs.push(t * 4, k / sectionCount);
    });
  }
  for (let i = 0; i < steps; i += 1) {
    for (let k = 0; k < sectionCount; k += 1) {
      const a = i * sectionCount + k;
      const b = a + sectionCount;
      const a2 = i * sectionCount + ((k + 1) % sectionCount);
      const b2 = a2 + sectionCount;
      indices.push(a, b, a2, b, b2, a2);
    }
  }
  const geo = bufferFrom(positions, normals, uvs, indices);
  geo.computeVertexNormals();
  return geo;
}

function buildCrown() {
  const ridges = 56;
  const around = ridges * 4;
  const rings = 18;
  const x0 = 19.55;
  const length = 2.85;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const samples = [];
  for (let i = 0; i <= rings; i += 1) {
    const t = i / rings;
    const belly = Math.sin(Math.PI * Math.min(1, t / 0.82));
    const cap = t > 0.78 ? Math.cos(((t - 0.78) / 0.22) * (Math.PI / 2)) : 1;
    const base = t < 0.08 ? 0.78 + 0.22 * (t / 0.08) : 1;
    samples.push({ t, belly, cap, base });
  }
  for (let j = 0; j <= around; j += 1) {
    const theta = (j / around) * Math.PI * 2;
    const knurl = Math.sin(theta * ridges);
    for (let i = 0; i <= rings; i += 1) {
      const s = samples[i];
      const knurlAmp = s.t > 0.12 && s.t < 0.8 ? 0.11 * knurl : 0;
      const radius = (2.05 + s.belly * 1.22 + knurlAmp) * s.base * s.cap;
      const x = x0 + s.t * length;
      const y = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;
      positions.push(x, y, z);
      const dr = (s.t > 0.12 && s.t < 0.8 ? 0 : 0) + (s.cap < 1 ? -1.4 : 0.15);
      const nx = dr;
      const ny = Math.cos(theta);
      const nz = Math.sin(theta);
      const nl = Math.hypot(nx, ny, nz) || 1;
      normals.push(nx / nl, ny / nl, nz / nl);
      uvs.push(j / around, s.t);
    }
  }
  const stride = rings + 1;
  for (let j = 0; j < around; j += 1) {
    for (let i = 0; i < rings; i += 1) {
      const a = j * stride + i;
      const b = a + stride;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = bufferFrom(positions, normals, uvs, indices);
  geo.computeVertexNormals();
  return geo;
}

function buildEngraving() {
  const y0 = -4.2;
  const y1 = 5.4;
  const z0 = -3.5;
  const z1 = -0.35;
  const rows = 24;
  const cols = 48;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let iy = 0; iy <= cols; iy += 1) {
    const v = iy / cols;
    const y = y0 + (y1 - y0) * v;
    for (let iz = 0; iz <= rows; iz += 1) {
      const u = iz / rows;
      const z = z0 + (z1 - z0) * u;
      const radius = profileRadius(z);
      const x = Math.sqrt(Math.max(0.2, radius * radius - y * y)) + 0.12;
      positions.push(x, y, z);
      normals.push(1, 0, 0);
      uvs.push(v, u);
    }
  }
  const stride = rows + 1;
  for (let iy = 0; iy < cols; iy += 1) {
    for (let iz = 0; iz < rows; iz += 1) {
      const a = iy * stride + iz;
      indices.push(a, a + 1, a + stride, a + stride, a + 1, a + stride + 1);
    }
  }
  const geo = bufferFrom(positions, normals, uvs, indices);
  geo.computeVertexNormals();
  return geo;
}

function sphericalCap(opening, height, segments) {
  const R = (opening * opening + height * height) / (2 * height);
  const steps = 20;
  const profile = [];
  for (let i = 0; i <= steps; i += 1) {
    const r = opening * (1 - i / steps);
    const z = Math.sqrt(Math.max(0, R * R - r * r)) - (R - height);
    profile.push({ r, z });
  }
  return latheAroundZ(profile, segments);
}

function placeHole(frame, rx, ry) {
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 7.2, bevelEnabled: false, curveSegments: 14 });
  geo.translate(0, 0, -3.6);
  const basis = new THREE.Matrix4().makeBasis(frame.widthDir, frame.tangent, frame.thickDir);
  basis.setPosition(frame.p);
  geo.applyMatrix4(basis);
  geo.computeVertexNormals();
  return geo;
}

function tubeRing(width, height, tube, facing) {
  const pts = [];
  const segs = 56;
  for (let i = 0; i <= segs; i += 1) {
    const a = (i / segs) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * width * 0.5, Math.sin(a) * height * 0.5, 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true);
  const geo = new THREE.TubeGeometry(curve, 64, tube, 8, true);
  if (facing) geo.applyMatrix4(facing);
  return geo;
}

const parts = [];

function add(geo, material) {
  parts.push({ geo, material });
}

function build() {
  const caseProfile = [
    { r: 0, z: -6.22 },
    { r: 7.2, z: -6.12 },
    { r: 13.4, z: -5.72 },
    { r: 16.9, z: -5.15 },
    { r: 19.15, z: -3.9 },
    { r: 20.35, z: -2.15 },
    { r: 20.58, z: 0.25 },
    { r: 20.2, z: 2.25 },
    { r: 18.85, z: 3.75 },
    { r: 17.25, z: 4.72 },
    { r: 16.72, z: 4.48 },
    { r: 16.55, z: 4.28 },
    { r: 6, z: 4.16 },
    { r: 0, z: 4.14 },
  ];
  add(latheAroundZ(caseProfile, 128), 'Case');

  const screen = new THREE.CircleGeometry(16.48, 96);
  flipCircleUv(screen);
  screen.translate(0, 0, 4.4);
  add(screen, 'Screen');

  const glass = sphericalCap(16.42, 1.22, 96);
  glass.translate(0, 0, 4.46);
  add(glass, 'Screen Glass');

  const back = new THREE.CircleGeometry(16.85, 96);
  flipCircleUv(back);
  back.rotateY(Math.PI);
  back.translate(0, 0, -6.02);
  add(back, 'BackPlate');

  add(buildCrown(), 'Crown');

  const button = new THREE.CapsuleGeometry(1.58, 4.4, 6, 16);
  button.rotateX(Math.PI / 2);
  button.translate(19.85, 7.15, 0.35);
  add(button, 'Case');

  const mic = new THREE.CylinderGeometry(0.62, 0.62, 1.4, 16);
  mic.rotateZ(Math.PI / 2);
  mic.translate(19.15, -6.7, -0.35);
  add(mic, 'Mic');

  add(buildEngraving(), 'Engraving');

  const loop = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 11, 0.4),
    new THREE.Vector3(0, 19.2, -1.6),
    new THREE.Vector3(0, 34, -8),
    new THREE.Vector3(0, 46, -24),
    new THREE.Vector3(0, 42, -46),
    new THREE.Vector3(0, 22, -60),
    new THREE.Vector3(0, 0, -66),
    new THREE.Vector3(0, -22, -60),
    new THREE.Vector3(0, -42, -46),
    new THREE.Vector3(0, -46, -24),
    new THREE.Vector3(0, -34, -8),
    new THREE.Vector3(0, -19.2, -1.6),
    new THREE.Vector3(0, -11, 0.4),
  ], false, 'catmullrom', 0.45);
  add(buildSweep(loop, 180, 22.5, 5.15, 2.35, 'radial'), 'Band');

  const tip = new THREE.CatmullRomCurve3([
    new THREE.Vector3(2.4, 16, -30),
    new THREE.Vector3(2.2, 30, -40),
    new THREE.Vector3(1.4, 42, -50),
  ]);
  add(buildSweep(tip, 40, 18, 4.4, 2, 'radial', (t) => 1 - t * 0.62), 'Band');

  const tail = new THREE.CatmullRomCurve3([
    new THREE.Vector3(6, -15, -2),
    new THREE.Vector3(18, -24, -6),
    new THREE.Vector3(25.5, -6, -7),
    new THREE.Vector3(25.5, 12, -9),
    new THREE.Vector3(20, 28, -18),
    new THREE.Vector3(8, 40, -32),
  ]);
  add(buildSweep(tail, 90, 20, 4.7, 2.15, 'flatZ'), 'Band');

  for (const t of [0.30, 0.40, 0.50, 0.60]) {
    add(placeHole(frameAt(tail, t, 'flatZ'), 2.15, 3.55), 'BandHole');
  }

  const buckleFrame = frameAt(tail, 0.16, 'flatZ');
  const buckle = tubeRing(13.5, 8.2, 1.15, new THREE.Matrix4().makeBasis(
    buckleFrame.widthDir,
    buckleFrame.tangent,
    buckleFrame.thickDir,
  ).setPosition(buckleFrame.p));
  add(buckle, 'Case');

  const pinFrame = frameAt(tail, 0.2, 'flatZ');
  const pin = new THREE.CapsuleGeometry(1.15, 6.4, 4, 12);
  pin.rotateZ(Math.PI / 2);
  const pinMatrix = new THREE.Matrix4().makeBasis(pinFrame.widthDir, pinFrame.tangent, pinFrame.thickDir);
  pinMatrix.setPosition(pinFrame.p.clone().addScaledVector(pinFrame.thickDir, 1.1));
  pin.applyMatrix4(pinMatrix);
  add(pin, 'Crown');

  const keeperFrame = frameAt(tail, 0.74, 'flatZ');
  const keeper = tubeRing(11, 7.2, 1.25, new THREE.Matrix4().makeBasis(
    keeperFrame.widthDir,
    keeperFrame.tangent,
    keeperFrame.thickDir,
  ).setPosition(keeperFrame.p));
  add(keeper, 'Case');

  const logo = new THREE.TorusGeometry(2.15, 0.42, 8, 28, Math.PI * 1.45);
  const bar = new THREE.BoxGeometry(2.1, 0.72, 0.7);
  bar.translate(0.7, 0.15, 0);
  logo.rotateZ(0.4);
  const logoGroup = new THREE.Group();
  const logoMesh = new THREE.Mesh(logo);
  const barMesh = new THREE.Mesh(bar);
  logoGroup.add(logoMesh, barMesh);
  logoGroup.position.copy(keeperFrame.p.clone().addScaledVector(keeperFrame.thickDir, 0.9));
  logoGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    keeperFrame.widthDir,
    keeperFrame.tangent,
    keeperFrame.thickDir,
  ));
  logoGroup.updateMatrix();
  logo.applyMatrix4(logoGroup.matrix);
  bar.applyMatrix4(logoGroup.matrix);
  add(logo, 'Logo');
  add(bar, 'Logo');

  const sensorZ = -6.55;
  const sensorOffsets = [[3.5, 3.5], [3.5, -3.5], [-3.5, 3.5], [-3.5, -3.5]];
  for (const [sx, sy] of sensorOffsets) {
    const bowl = new THREE.SphereGeometry(2.05, 28, 16);
    bowl.scale(1, 1, 0.42);
    bowl.translate(sx, sy, sensorZ);
    add(bowl, 'Sensor');
    const pupil = new THREE.SphereGeometry(0.72, 16, 10);
    pupil.scale(1, 1, 0.5);
    pupil.translate(sx, sy, sensorZ - 0.55);
    add(pupil, 'Mic');
  }

  const ring = new THREE.TorusGeometry(8.4, 0.16, 8, 64);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, 0, -6.2);
  add(ring, 'Electrode');

  function electrode(yRot, scaleX) {
    const arc = new THREE.TorusGeometry(10.4, 0.62, 8, 40, 0.95);
    arc.rotateX(Math.PI / 2);
    arc.rotateZ(yRot);
    arc.scale(scaleX, 1, 1);
    arc.translate(0, 0, -6.48);
    return arc;
  }
  add(electrode(Math.PI, 1), 'Electrode');
  add(electrode(0, 1), 'Electrode');
  add(electrode(-Math.PI / 2, 0.72), 'Electrode');
}

function exportGLB(meshes, materials, images) {
  const binParts = [];
  let binLength = 0;
  const bufferViews = [];
  const accessors = [];
  const gltfMeshes = [];
  const nodes = [];

  function align(size) {
    const pad = (4 - (binLength % 4)) % 4;
    if (pad) {
      binParts.push(Buffer.alloc(pad));
      binLength += pad;
    }
    return size;
  }

  function pushBuffer(data) {
    align(4);
    const offset = binLength;
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    binParts.push(buf);
    binLength += buf.length;
    const view = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length });
    return view;
  }

  const imageDefs = images.map((image) => {
    const view = pushBuffer(image.png);
    bufferViews[view].byteOffset = bufferViews[view].byteOffset || 0;
    return { bufferView: view, mimeType: 'image/png' };
  });

  const textures = images.map((_, index) => ({
    sampler: images[index].wrap === 'repeat' ? 1 : 0,
    source: index,
  }));

  function pushAccessor(array, type, componentType, count, size, normalized = false) {
    const view = pushBuffer(array);
    const accessor = { bufferView: view, componentType, count, type };
    if (normalized) accessor.normalized = true;
    if (type === 'VEC3' && componentType === 5126) {
      let min = [Infinity, Infinity, Infinity];
      let max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < count; i += 1) {
        for (let k = 0; k < 3; k += 1) {
          const v = array[i * 3 + k];
          min[k] = Math.min(min[k], v);
          max[k] = Math.max(max[k], v);
        }
      }
      accessor.min = min;
      accessor.max = max;
    }
    accessors.push(accessor);
    return accessors.length - 1;
  }

  meshes.forEach((mesh, meshIndex) => {
    const geo = mesh.geo;
    const pos = geo.getAttribute('position');
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const nor = geo.getAttribute('normal');
    let uv = geo.getAttribute('uv');
    if (!uv) {
      const generated = new Float32Array(pos.count * 2);
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(generated, 2));
      uv = geo.getAttribute('uv');
    }
    let index = geo.getIndex();
    if (!index) {
      console.warn('non-indexed mesh', mesh.material);
      const generated = pos.count > 65535 ? new Uint32Array(pos.count) : new Uint16Array(pos.count);
      for (let i = 0; i < pos.count; i += 1) generated[i] = i;
      geo.setIndex(new THREE.BufferAttribute(generated, 1));
      index = geo.getIndex();
    }
    const posArray = new Float32Array(pos.count * 3);
    const norArray = new Float32Array(nor.count * 3);
    const uvArray = new Float32Array(uv.count * 2);
    for (let i = 0; i < pos.count; i += 1) {
      posArray[i * 3] = pos.getX(i);
      posArray[i * 3 + 1] = pos.getY(i);
      posArray[i * 3 + 2] = pos.getZ(i);
      norArray[i * 3] = nor.getX(i);
      norArray[i * 3 + 1] = nor.getY(i);
      norArray[i * 3 + 2] = nor.getZ(i);
      uvArray[i * 2] = uv.getX(i);
      uvArray[i * 2 + 1] = uv.getY(i);
    }
    const idxArray = index.array instanceof Uint32Array || pos.count > 65535
      ? new Uint32Array(index.count)
      : new Uint16Array(index.count);
    for (let i = 0; i < index.count; i += 1) idxArray[i] = index.getX(i);
    const primitive = {
      attributes: {
        POSITION: pushAccessor(posArray, 'VEC3', 5126, pos.count),
        NORMAL: pushAccessor(norArray, 'VEC3', 5126, nor.count),
        TEXCOORD_0: pushAccessor(uvArray, 'VEC2', 5126, uv.count),
      },
      indices: pushAccessor(idxArray, 'SCALAR', idxArray instanceof Uint32Array ? 5125 : 5123, idxArray.length),
      material: materials.findIndex((material) => material.name === mesh.material),
    };
    gltfMeshes.push({ name: mesh.material, primitives: [primitive] });
    nodes.push({ name: `${mesh.material} ${meshIndex}`, mesh: meshIndex });
  });

  const materialDefs = materials.map((material) => {
    const def = {
      name: material.name,
      pbrMetallicRoughness: {
        baseColorFactor: [...material.color, material.opacity ?? 1],
        metallicFactor: material.metalness,
        roughnessFactor: material.roughness,
      },
      doubleSided: Boolean(material.doubleSided),
    };
    if (material.baseColor !== undefined) {
      def.pbrMetallicRoughness.baseColorTexture = { index: material.baseColor };
    }
    if (material.roughnessMap !== undefined) {
      def.pbrMetallicRoughness.metallicRoughnessTexture = { index: material.roughnessMap };
    }
    if (material.emissive) {
      def.emissiveFactor = material.emissive;
      def.extensions = def.extensions || {};
      def.extensions.KHR_materials_emissive_strength = { emissiveStrength: material.emissiveStrength ?? 1 };
    }
    if (material.emissiveMap !== undefined) def.emissiveTexture = { index: material.emissiveMap };
    if (material.alpha) def.alphaMode = material.alpha;
    if (material.clearcoat) {
      def.extensions = def.extensions || {};
      def.extensions.KHR_materials_clearcoat = {
        clearcoatFactor: material.clearcoat,
        clearcoatRoughnessFactor: material.clearcoatRoughness ?? 0.3,
      };
    }
    return def;
  });

  const json = {
    asset: { version: '2.0', generator: 'mockup-studio-pixel-watch' },
    extensionsUsed: ['KHR_materials_clearcoat', 'KHR_materials_emissive_strength'],
    scene: 0,
    scenes: [{ name: 'Pixel Watch 5', nodes: [nodes.length] }],
    nodes: [...nodes, { name: 'PixelWatch', children: nodes.map((_, index) => index) }],
    meshes: gltfMeshes,
    materials: materialDefs,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
    images: imageDefs,
    textures,
    samplers: [
      { magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 },
      { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 },
    ],
  };

  let jsonBuf = Buffer.from(JSON.stringify(json));
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const binBuf = Buffer.concat(binParts);
  const binPad = (4 - (binBuf.length % 4)) % 4;
  const binPadded = binPad ? Buffer.concat([binBuf, Buffer.alloc(binPad)]) : binBuf;
  const total = 12 + 8 + jsonBuf.length + 8 + binPadded.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binPadded]);
}

build();

const face = makeFace();
const backPlate = makeBackPlate();
const engraving = makeEngraving();
const bandTex = makeBandTexture();
const bandRough = makeBandRoughness();
fs.mkdirSync(previewDir, { recursive: true });
fs.writeFileSync(path.join(previewDir, 'face.png'), encodePNG(face.width, face.height, face.data));
fs.writeFileSync(path.join(previewDir, 'back.png'), encodePNG(backPlate.width, backPlate.height, backPlate.data));
fs.writeFileSync(path.join(previewDir, 'engraving.png'), encodePNG(engraving.width, engraving.height, engraving.data));

const images = [
  { png: encodePNG(face.width, face.height, face.data), wrap: 'clamp' },
  { png: encodePNG(backPlate.width, backPlate.height, backPlate.data), wrap: 'clamp' },
  { png: encodePNG(engraving.width, engraving.height, engraving.data), wrap: 'clamp' },
  { png: encodePNG(bandTex.width, bandTex.height, bandTex.data), wrap: 'repeat' },
  { png: encodePNG(bandRough.width, bandRough.height, bandRough.data), wrap: 'repeat' },
];

const materials = [
  { name: 'Case', color: [...linearColor('#2b2b2e'), 1].slice(0, 3), metalness: 0.18, roughness: 0.46, clearcoat: 0.22, clearcoatRoughness: 0.42 },
  { name: 'Band', color: [1, 1, 1], metalness: 0, roughness: 1, baseColor: 3, roughnessMap: 4 },
  { name: 'BandHole', color: linearColor('#050505'), metalness: 0, roughness: 1 },
  { name: 'Crown', color: linearColor('#c5c8cc'), metalness: 0.92, roughness: 0.28, clearcoat: 0.45, clearcoatRoughness: 0.22 },
  { name: 'Mic', color: linearColor('#070708'), metalness: 0.05, roughness: 0.7 },
  { name: 'Screen', color: [0, 0, 0], metalness: 0, roughness: 1, emissive: [1, 1, 1], emissiveMap: 0, emissiveStrength: 1 },
  { name: 'Screen Glass', color: [1, 1, 1], metalness: 0, roughness: 0.04, opacity: 0.18, alpha: 'BLEND', clearcoat: 1, clearcoatRoughness: 0.08 },
  { name: 'BackPlate', color: [1, 1, 1], metalness: 0.35, roughness: 0.28, baseColor: 1, clearcoat: 0.72, clearcoatRoughness: 0.18 },
  { name: 'Engraving', color: [1, 1, 1], metalness: 0.4, roughness: 0.35, baseColor: 2, alpha: 'BLEND', doubleSided: true },
  { name: 'Sensor', color: linearColor('#1a1c20'), metalness: 0.25, roughness: 0.16, clearcoat: 0.8, clearcoatRoughness: 0.12 },
  { name: 'Electrode', color: linearColor('#b7bcc2'), metalness: 0.86, roughness: 0.32, clearcoat: 0.35, clearcoatRoughness: 0.25 },
  { name: 'Logo', color: linearColor('#d5d7db'), metalness: 0.7, roughness: 0.3 },
];

const glb = exportGLB(parts, materials, images);
fs.writeFileSync(outFile, glb);
const jsonLength = glb.readUInt32LE(12);
const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
console.log(`wrote ${outFile} (${(glb.length / 1024 / 1024).toFixed(2)} MB, ${json.meshes.length} meshes, ${json.materials.length} materials)`);
