import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';
import {
  convertBumpMapsForGltf,
  extractSceneLights,
  stripSceneHelpers,
} from './materialFidelity';
import type { SceneLight } from '../types';

/** File-picker filter: one mesh, plus the textures and sidecar files that belong with it. */
export const CUSTOM_MODEL_ACCEPT = [
  '.glb', '.gltf', '.fbx', '.obj', '.dae', '.c4d', '.blend', '.max', '.ma', '.mb',
  '.mtl', '.bin',
  '.png', '.jpg', '.jpeg', '.webp', '.tga', '.bmp', '.gif',
  'model/gltf-binary', 'model/gltf+json',
].join(',');

const MESH_EXT = new Set(['glb', 'gltf', 'fbx', 'obj', 'dae']);
const MESH_RANK: Record<string, number> = { glb: 0, gltf: 1, fbx: 2, dae: 3, obj: 4 };
/** DCC scene formats we accept in the picker but cannot parse in-app (except .blend on desktop). */
const DCC_EXT = new Set(['c4d', 'blend', 'max', 'ma', 'mb']);
const TEXTURE_EXT = /\.(png|jpe?g|webp|tga|bmp|gif|tif|tiff|exr|dds|hdr|ktx2)$/i;
const UNSUPPORTED_TEXTURE = /\.(tif|tiff|exr|dds|hdr|ktx2)$/i;

export interface BundledMesh {
  /** glTF binary, with textures packed in. */
  buffer: ArrayBuffer;
  /** Original mesh filename, for the library label. */
  sourceName: string;
  format: 'GLB' | 'glTF' | 'FBX' | 'DAE' | 'OBJ' | 'Blender';
  /** Lights pulled from Spline / Blender scenes before helpers are stripped. */
  sceneLights?: SceneLight[];
}

/** Desktop shell can shell out to a local Blender install. */
function canConvertBlend(): boolean {
  return typeof window !== 'undefined' && typeof window.mockupDesktop?.convertBlend === 'function';
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x2000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out.buffer;
}

async function convertBlendViaDesktop(file: File): Promise<ArrayBuffer> {
  const api = window.mockupDesktop?.convertBlend;
  if (!api) throw dccError('blend');
  const dataBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
  const result = await api({ fileName: file.name, dataBase64 });
  if (!result.ok) throw new Error(result.error || 'Could not convert this .blend file.');
  return base64ToBytes(result.dataBase64);
}

function extensionOf(file: File): string {
  const match = file.name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? '';
}

function stemOf(name: string): string {
  return name.replace(/\.[^.]+$/, '').toLowerCase();
}

function decodePath(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function normalizePath(raw: string): string {
  let value = decodePath(raw.trim()).replace(/\\/g, '/');
  value = value.replace(/^file:\/\//i, '');
  value = value.replace(/^[a-z]:\//i, '');
  value = value.replace(/^(\.\/)+/, '');
  return value.toLowerCase();
}

function basenameOf(raw: string): string {
  const path = normalizePath(raw).split('?')[0].split('#')[0];
  return path.split('/').filter(Boolean).pop() ?? '';
}

function pathTails(path: string): string[] {
  const parts = normalizePath(path).split('?')[0].split('#')[0].split('/').filter(Boolean);
  const tails: string[] = [];
  for (let i = 0; i < parts.length; i += 1) tails.push(parts.slice(i).join('/'));
  return tails;
}

function lookupFile(files: File[], ref: string): File | undefined {
  const norm = normalizePath(ref).split('?')[0].split('#')[0];
  const base = basenameOf(ref);
  const byRel = files.find((file) => {
    const rel = normalizePath(file.webkitRelativePath || '');
    return Boolean(rel) && (rel === norm || rel.endsWith(`/${norm}`));
  });
  if (byRel) return byRel;
  return files.find((file) => file.name.toLowerCase() === base);
}

function missingRefs(refs: string[], files: File[]): string[] {
  const missing: string[] = [];
  for (const ref of refs) {
    if (!ref || ref.startsWith('data:') || ref.startsWith('blob:')) continue;
    const base = basenameOf(ref);
    if (!base.includes('.')) continue;
    if (!lookupFile(files, ref)) missing.push(base);
  }
  return [...new Set(missing)];
}

function throwMissing(names: string[]) {
  const unique = [...new Set(names.map(basenameOf).filter(Boolean))];
  const unsupported = unique.filter((name) => UNSUPPORTED_TEXTURE.test(name));
  if (unsupported.length) {
    const list = unsupported.slice(0, 4).join(', ');
    throw new Error(`Unsupported texture format (${list}). Use PNG, JPEG, or WebP.`);
  }
  const list = unique.slice(0, 4).join(', ');
  const extra = unique.length > 4 ? ` (+${unique.length - 4} more)` : '';
  throw new Error(`Missing ${list}${extra}. Select those files together with the model, or import the export folder.`);
}

const DCC_LABEL: Record<string, string> = {
  c4d: 'Cinema 4D (.c4d)',
  blend: 'Blender (.blend)',
  max: '3ds Max (.max)',
  ma: 'Maya (.ma)',
  mb: 'Maya (.mb)',
};

function dccError(ext: string): Error {
  const label = DCC_LABEL[ext] ?? `.${ext}`;
  if (ext === 'blend') {
    return new Error(
      'Blender (.blend) needs the desktop app with Blender installed. Export glTF (.glb) instead, or open this drop in mokstudio for Mac.',
    );
  }
  return new Error(
    `${label} can’t be opened here yet. In Cinema 4D / Blender / Maya / Max, export glTF (.glb) or FBX, keep the textures beside it, then import that export (or the whole folder).`,
  );
}

function firstDccExt(files: File[]): string | undefined {
  for (const file of files) {
    const ext = extensionOf(file);
    if (DCC_EXT.has(ext)) return ext;
  }
  return undefined;
}

function meshRankOf(file: File): number {
  const ext = extensionOf(file);
  if (ext === 'blend') return 5;
  return MESH_RANK[ext] ?? 9;
}

function isMeshCandidate(file: File): boolean {
  const ext = extensionOf(file);
  if (MESH_EXT.has(ext)) return true;
  return ext === 'blend' && canConvertBlend();
}

/**
 * Distinct mesh files in a picker/drop selection (one preferred format per stem).
 * Texture / sidecar files are ignored here — pair them with {@link filesForMeshBundle}.
 */
export function listMeshFiles(files: File[]): File[] {
  const byStem = new Map<string, File[]>();
  for (const file of files) {
    if (!isMeshCandidate(file)) continue;
    const stem = stemOf(file.name);
    const group = byStem.get(stem) ?? [];
    group.push(file);
    byStem.set(stem, group);
  }
  if (!byStem.size) {
    const blends = files.filter((file) => extensionOf(file) === 'blend');
    if (blends.length) throw dccError('blend');
    const dcc = firstDccExt(files);
    if (dcc) throw dccError(dcc);
    throw new Error('Choose a .glb, .gltf, .fbx, .dae, .obj, .blend, or .c4d file.');
  }
  return [...byStem.values()].map((group) => (
    [...group].sort((a, b) => meshRankOf(a) - meshRankOf(b))[0]
  ));
}

/** One mesh plus shared textures/sidecars — other mesh files in the selection are left out. */
export function filesForMeshBundle(all: File[], mesh: File): File[] {
  const otherMeshes = new Set(
    all.filter((file) => file !== mesh && isMeshCandidate(file)),
  );
  return all.filter((file) => !otherMeshes.has(file));
}

function pickMeshFile(files: File[]): File {
  const meshes = listMeshFiles(files);
  if (meshes.length === 1) return meshes[0];
  throw new Error('Import one model at a time. Texture images can be selected with it.');
}

function formatOf(file: File): BundledMesh['format'] {
  switch (extensionOf(file)) {
    case 'glb': return 'GLB';
    case 'gltf': return 'glTF';
    case 'fbx': return 'FBX';
    case 'dae': return 'DAE';
    case 'blend': return 'Blender';
    default: return 'OBJ';
  }
}

const SIDECAR_EXT = new Set(['mtl', 'bin', 'png', 'jpg', 'jpeg', 'webp', 'tga', 'bmp', 'gif']);

export interface MeshDropOffer {
  files: File[];
  meshName: string;
  format: string;
  textureCount: number;
  /** How many distinct models are in this drop (1+). */
  meshCount: number;
  /** Set when the drop should be explained instead of extracted. */
  error: string | null;
}

function dccFormatLabel(ext: string): string {
  if (ext === 'c4d') return 'Cinema 4D';
  if (ext === 'blend') return 'Blender';
  if (ext === 'max') return '3ds Max';
  if (ext === 'ma' || ext === 'mb') return 'Maya';
  return 'Model';
}

/** A mesh drop is worth a prompt. Image-only drops stay screenshots. */
export function meshDropOffer(files: File[]): MeshDropOffer | null {
  const hasMesh = files.some((file) => MESH_EXT.has(extensionOf(file)) || DCC_EXT.has(extensionOf(file)));
  if (!hasMesh) return null;
  try {
    const meshes = listMeshFiles(files);
    const meshSet = new Set(meshes);
    const textureCount = files.filter((file) => (
      !meshSet.has(file) && SIDECAR_EXT.has(extensionOf(file))
    )).length;
    if (meshes.length === 1) {
      return {
        files,
        meshName: meshes[0].name,
        format: formatOf(meshes[0]),
        textureCount,
        meshCount: 1,
        error: null,
      };
    }
    return {
      files,
      meshName: meshes.map((file) => file.name).join(', '),
      format: 'Multiple',
      textureCount,
      meshCount: meshes.length,
      error: null,
    };
  } catch (error) {
    const named = files.find((file) => MESH_EXT.has(extensionOf(file)) || DCC_EXT.has(extensionOf(file)));
    const ext = named ? extensionOf(named) : '';
    return {
      files,
      meshName: named?.name ?? 'Model',
      format: dccFormatLabel(ext),
      textureCount: 0,
      meshCount: 0,
      error: error instanceof Error ? error.message : 'Could not read this drop.',
    };
  }
}

function readDroppedEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file((file) => resolve([file]), () => resolve([]));
    });
  }
  if (!entry.isDirectory) return Promise.resolve([]);
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  return new Promise((resolve) => {
    const gathered: FileSystemEntry[] = [];
    const pump = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          void Promise.all(gathered.map((child) => readDroppedEntry(child))).then((groups) => {
            resolve(groups.flat());
          });
          return;
        }
        gathered.push(...batch);
        pump();
      }, () => resolve([]));
    };
    pump();
  });
}

/** Files from a drop, including everything inside a dropped folder. */
export async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const entries: FileSystemEntry[] = [];
  for (const item of dataTransfer.items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (!entries.length) return [...dataTransfer.files];
  const groups = await Promise.all(entries.map((entry) => readDroppedEntry(entry)));
  const files = groups.flat();
  return files.length ? files : [...dataTransfer.files];
}

interface AssetIndex {
  resolve(url: string): string;
  revoke(): void;
}

function createAssetIndex(files: File[]): AssetIndex {
  const byKey = new Map<string, string>();
  const urls: string[] = [];
  for (const file of files) {
    const url = URL.createObjectURL(file);
    urls.push(url);
    const keys = new Set<string>([file.name.toLowerCase()]);
    if (file.webkitRelativePath) keys.add(normalizePath(file.webkitRelativePath));
    for (const key of keys) {
      if (!byKey.has(key)) byKey.set(key, url);
    }
  }
  return {
    resolve(url: string) {
      if (!url || url.startsWith('blob:') || url.startsWith('data:')) return url;
      for (const tail of pathTails(url)) {
        const hit = byKey.get(tail);
        if (hit) return hit;
      }
      return url;
    },
    revoke() {
      for (const url of urls) URL.revokeObjectURL(url);
    },
  };
}

function readableAssetName(url: string): string {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return '';
  return basenameOf(url);
}

function waitForLoads(manager: THREE.LoadingManager, work: () => void): Promise<string[]> {
  const missing: string[] = [];
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Timed out while reading textures.')), 30000);
    manager.onError = (url) => {
      const name = readableAssetName(url);
      if (name) missing.push(name);
    };
    manager.onLoad = () => {
      window.clearTimeout(timer);
      resolve(missing);
    };
    try {
      work();
    } catch (error) {
      window.clearTimeout(timer);
      reject(error);
      return;
    }
    manager.itemStart('mesh-bundle');
    manager.itemEnd('mesh-bundle');
  });
}

function prepareMaterials(root: THREE.Object3D) {
  const converted = new Map<THREE.Material, THREE.Material>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = list.map((mat) => {
      if (!mat) return mat;
      const cached = converted.get(mat);
      if (cached) return cached;
      const standard = mat as THREE.MeshStandardMaterial;
      const basic = mat as THREE.MeshBasicMaterial;
      const physical = mat as THREE.MeshPhysicalMaterial;
      if (
        standard.isMeshStandardMaterial
        || physical.isMeshPhysicalMaterial
        || basic.isMeshBasicMaterial
      ) {
        converted.set(mat, mat);
        return mat;
      }
      const src = mat as THREE.MeshPhongMaterial;
      const copy = new THREE.MeshStandardMaterial({
        name: src.name,
        color: src.color,
        map: src.map,
        normalMap: src.normalMap,
        bumpMap: src.bumpMap,
        bumpScale: typeof src.bumpScale === 'number' ? src.bumpScale : 1,
        displacementMap: src.displacementMap,
        displacementScale: typeof src.displacementScale === 'number' ? src.displacementScale : 1,
        displacementBias: typeof src.displacementBias === 'number' ? src.displacementBias : 0,
        emissive: src.emissive,
        emissiveMap: src.emissiveMap,
        emissiveIntensity: typeof src.emissiveIntensity === 'number' ? src.emissiveIntensity : 1,
        aoMap: src.aoMap,
        aoMapIntensity: typeof src.aoMapIntensity === 'number' ? src.aoMapIntensity : 1,
        lightMap: src.lightMap,
        lightMapIntensity: typeof src.lightMapIntensity === 'number' ? src.lightMapIntensity : 1,
        alphaMap: src.alphaMap,
        envMap: src.envMap,
        envMapIntensity: 1,
        transparent: src.transparent,
        opacity: src.opacity,
        side: src.side,
        alphaTest: src.alphaTest,
        depthWrite: src.depthWrite,
        depthTest: src.depthTest,
        metalness: 0,
        roughness: Math.min(1, Math.max(0.04, 1 - (typeof src.shininess === 'number' ? src.shininess / 100 : 0.35))),
        vertexColors: src.vertexColors,
        wireframe: src.wireframe,
        flatShading: src.flatShading,
      });
      if (src.normalScale?.clone) copy.normalScale = src.normalScale.clone();
      copy.userData = { ...src.userData };
      converted.set(mat, copy);
      return copy;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
  });
  // Bake bump → normal so detail survives GLB packing (glTF has no bump slot).
  convertBumpMapsForGltf(root);
}

function meshCount(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) count += 1;
  });
  return count;
}

function disposeRoot(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      materials.add(mat);
      for (const value of Object.values(mat)) {
        const texture = value as THREE.Texture;
        if (texture?.isTexture) textures.add(texture);
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

async function exportGlb(root: THREE.Object3D, format: BundledMesh['format']): Promise<ArrayBuffer> {
  const clips = (root as THREE.Object3D & { animations?: THREE.AnimationClip[] }).animations ?? [];
  const exporter = new GLTFExporter();
  try {
    const result = await exporter.parseAsync(root, {
      binary: true,
      onlyVisible: false,
      maxTextureSize: 4096,
      animations: clips,
    });
    if (!(result instanceof ArrayBuffer)) {
      throw new Error('Could not pack this model.');
    }
    return result;
  } catch (error) {
    console.warn('[mesh import]', error);
    throw new Error(`Could not read this ${format} file.`);
  }
}

function gltfExternalRefs(json: { buffers?: { uri?: string }[]; images?: { uri?: string }[] }): string[] {
  const refs: string[] = [];
  for (const buffer of json.buffers ?? []) {
    if (typeof buffer.uri === 'string') refs.push(buffer.uri);
  }
  for (const image of json.images ?? []) {
    if (typeof image.uri === 'string') refs.push(image.uri);
  }
  return refs;
}

function daeTextureRefs(xml: string): string[] {
  const refs: string[] = [];
  const pattern = /<init_from>\s*([^<]+?)\s*<\/init_from>/gi;
  let match = pattern.exec(xml);
  while (match) {
    const value = match[1].trim();
    if (TEXTURE_EXT.test(value) || value.includes('/') || value.includes('\\')) refs.push(value);
    match = pattern.exec(xml);
  }
  return refs;
}

async function bundleExternalGltf(file: File, files: File[]): Promise<ArrayBuffer> {
  const text = await file.text();
  let json: { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error('This .gltf file is not valid.');
  }
  const refs = gltfExternalRefs(json);
  const missing = missingRefs(refs, files);
  if (missing.length) throwMissing(missing);
  if (!refs.length) {
    return await file.arrayBuffer();
  }

  const urls: string[] = [];
  const rewrite = (uri: string | undefined) => {
    if (!uri || uri.startsWith('data:') || uri.startsWith('blob:')) return uri;
    const match = lookupFile(files, uri);
    if (!match) return uri;
    const url = URL.createObjectURL(match);
    urls.push(url);
    return url;
  };
  for (const buffer of json.buffers ?? []) buffer.uri = rewrite(buffer.uri);
  for (const image of json.images ?? []) image.uri = rewrite(image.uri);

  const loader = new GLTFLoader();
  let scene: THREE.Object3D | null = null;
  try {
    const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) => {
      loader.parse(JSON.stringify(json), '', (parsed) => resolve(parsed), (error) => {
        reject(error instanceof Error ? error : new Error('Could not read this glTF file.'));
      });
    });
    gltf.scene.animations = gltf.animations;
    scene = holdRootTransform(gltf.scene);
    if (!meshCount(scene)) throw new Error('This file has no mesh.');
    return await exportGlb(scene, 'glTF');
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
    if (scene) disposeRoot(scene);
  }
}

/** Keep axis correction on a child. The viewer overwrites the GLB root rotation. */
function holdRootTransform(root: THREE.Object3D): THREE.Group {
  const wrapper = new THREE.Group();
  const clips = (root as THREE.Object3D & { animations?: THREE.AnimationClip[] }).animations ?? [];
  wrapper.add(root);
  wrapper.animations = clips;
  return wrapper;
}

async function bundleConverted(
  format: BundledMesh['format'],
  files: File[],
  parse: (manager: THREE.LoadingManager) => THREE.Object3D,
  options?: { keepLights?: boolean },
): Promise<{ buffer: ArrayBuffer; sceneLights: SceneLight[] }> {
  const index = createAssetIndex(files);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => index.resolve(url));
  manager.addHandler(/\.tga$/i, new TGALoader(manager));
  let root: THREE.Object3D | null = null;
  let exportRoot: THREE.Object3D | null = null;
  try {
    const missing = await waitForLoads(manager, () => {
      root = parse(manager);
    });
    if (!root) throw new Error(`Could not read this ${format} file.`);
    if (missing.length) throwMissing(missing);
    const sceneLights = options?.keepLights ? extractSceneLights(root) : [];
    stripSceneHelpers(root);
    if (!meshCount(root)) throw new Error('This file has no mesh.');
    prepareMaterials(root);
    exportRoot = holdRootTransform(root);
    const buffer = await exportGlb(exportRoot, format);
    return { buffer, sceneLights };
  } finally {
    index.revoke();
    if (exportRoot) disposeRoot(exportRoot);
    else if (root) disposeRoot(root);
  }
}

async function refinePackedGlb(
  buffer: ArrayBuffer,
  options?: { keepLights?: boolean },
): Promise<{ buffer: ArrayBuffer; sceneLights: SceneLight[] }> {
  if (!options?.keepLights) return { buffer, sceneLights: [] };

  const loader = new GLTFLoader();
  let root: THREE.Object3D | null = null;
  try {
    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
      loader.parse(buffer.slice(0), '', (parsed) => resolve(parsed), (error) => {
        reject(error instanceof Error ? error : new Error('Could not read this GLB.'));
      });
    });
    root = gltf.scene;
    const sceneLights = extractSceneLights(root);
    stripSceneHelpers(root);
    prepareMaterials(root);
    if (!meshCount(root)) throw new Error('This file has no mesh.');
    const packed = await exportGlb(holdRootTransform(root), 'GLB');
    return { buffer: packed, sceneLights };
  } finally {
    if (root) disposeRoot(root);
  }
}

/**
 * Pack a mesh plus any selected textures into one GLB buffer.
 * A self-contained .glb or .gltf is stored as-is. FBX, DAE, OBJ, and
 * glTF files that point at external images are converted so the viewer
 * can keep using a single GLB. On desktop, .blend is converted via a
 * local Blender install first.
 *
 * Pass `{ keepLights: true }` for Spline / Blender scene sets so luminaires
 * become editable studio lights instead of being discarded.
 */
export async function bundleMeshFiles(
  files: File[],
  options?: { keepLights?: boolean },
): Promise<BundledMesh> {
  if (!files.length) throw new Error('Choose a model file.');
  const mesh = pickMeshFile(files);
  const format = formatOf(mesh);
  const keepLights = options?.keepLights === true;

  if (format === 'Blender') {
    const converted = await convertBlendViaDesktop(mesh);
    const refined = await refinePackedGlb(converted, { keepLights: true });
    return {
      buffer: refined.buffer,
      sourceName: mesh.name,
      format,
      sceneLights: refined.sceneLights.length ? refined.sceneLights : undefined,
    };
  }

  if (format === 'GLB') {
    const buffer = await mesh.arrayBuffer();
    if (buffer.byteLength < 4) throw new Error('This .glb file is not valid.');
    const magic = new Uint8Array(buffer, 0, 4);
    const isGlb = magic[0] === 0x67 && magic[1] === 0x6c && magic[2] === 0x54 && magic[3] === 0x46;
    if (!isGlb) throw new Error('This .glb file is not valid.');
    const refined = await refinePackedGlb(buffer, { keepLights });
    return {
      buffer: refined.buffer,
      sourceName: mesh.name,
      format,
      sceneLights: refined.sceneLights.length ? refined.sceneLights : undefined,
    };
  }
  if (format === 'glTF') {
    const buffer = await bundleExternalGltf(mesh, files);
    const refined = await refinePackedGlb(buffer, { keepLights });
    return {
      buffer: refined.buffer,
      sourceName: mesh.name,
      format,
      sceneLights: refined.sceneLights.length ? refined.sceneLights : undefined,
    };
  }
  if (format === 'FBX') {
    const fbxBuffer = await mesh.arrayBuffer();
    const packed = await bundleConverted(
      format,
      files,
      (manager) => new FBXLoader(manager).parse(fbxBuffer, ''),
      { keepLights },
    );
    return {
      buffer: packed.buffer,
      sourceName: mesh.name,
      format,
      sceneLights: packed.sceneLights.length ? packed.sceneLights : undefined,
    };
  }
  if (format === 'DAE') {
    const daeText = await mesh.text();
    const missing = missingRefs(daeTextureRefs(daeText), files);
    if (missing.length) throwMissing(missing);
    const packed = await bundleConverted(format, files, (manager) => {
      const parsed = new ColladaLoader(manager).parse(daeText, '');
      if (!parsed?.scene) throw new Error('This DAE file is not valid.');
      return parsed.scene;
    }, { keepLights });
    return {
      buffer: packed.buffer,
      sourceName: mesh.name,
      format,
      sceneLights: packed.sceneLights.length ? packed.sceneLights : undefined,
    };
  }
  const objText = await mesh.text();
  const mtllib = objText.match(/^\s*mtllib\s+(.+)$/im)?.[1]?.trim();
  let mtlText = '';
  if (mtllib) {
    const mtlFile = lookupFile(files, mtllib);
    if (!mtlFile) {
      throw new Error(`This OBJ uses “${basenameOf(mtllib)}”. Select that file and its textures too.`);
    }
    mtlText = await mtlFile.text();
  }
  const packed = await bundleConverted('OBJ', files, (manager) => {
    const objLoader = new OBJLoader(manager);
    if (mtlText) {
      const materials = new MTLLoader(manager).parse(mtlText, '');
      materials.preload();
      objLoader.setMaterials(materials);
    }
    return objLoader.parse(objText);
  }, { keepLights });
  return {
    buffer: packed.buffer,
    sourceName: mesh.name,
    format,
    sceneLights: packed.sceneLights.length ? packed.sceneLights : undefined,
  };
}
