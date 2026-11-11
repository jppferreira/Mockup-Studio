/**
 * Mesh drop / picker helpers with no Three.js dependency.
 * Heavy GLB/FBX bundling stays in meshBundle.ts (loaded on demand).
 */
export const CUSTOM_MODEL_ACCEPT = [
  '.glb', '.gltf', '.fbx', '.obj', '.dae', '.c4d', '.blend', '.max', '.ma', '.mb',
  '.mtl', '.bin',
  '.png', '.jpg', '.jpeg', '.webp', '.tga', '.bmp', '.gif',
  'model/gltf-binary', 'model/gltf+json',
].join(',');

const MESH_EXT = new Set(['glb', 'gltf', 'fbx', 'obj', 'dae']);
const MESH_RANK: Record<string, number> = { glb: 0, gltf: 1, fbx: 2, dae: 3, obj: 4 };
const DCC_EXT = new Set(['c4d', 'blend', 'max', 'ma', 'mb']);
const SIDECAR_EXT = new Set(['mtl', 'bin', 'png', 'jpg', 'jpeg', 'webp', 'tga', 'bmp', 'gif']);

function canConvertBlend(): boolean {
  return typeof window !== 'undefined' && typeof window.mockupDesktop?.convertBlend === 'function';
}

function extensionOf(file: File): string {
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : '';
}

function stemOf(name: string): string {
  return name.replace(/\.[^.]+$/, '').toLowerCase();
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

export function filesForMeshBundle(all: File[], mesh: File): File[] {
  const otherMeshes = new Set(
    all.filter((file) => file !== mesh && isMeshCandidate(file)),
  );
  return all.filter((file) => !otherMeshes.has(file));
}

function formatOf(file: File): string {
  switch (extensionOf(file)) {
    case 'glb': return 'GLB';
    case 'gltf': return 'glTF';
    case 'fbx': return 'FBX';
    case 'dae': return 'DAE';
    case 'blend': return 'Blender';
    default: return 'OBJ';
  }
}

export interface MeshDropOffer {
  files: File[];
  meshName: string;
  format: string;
  textureCount: number;
  meshCount: number;
  error: string | null;
}

function dccFormatLabel(ext: string): string {
  if (ext === 'c4d') return 'Cinema 4D';
  if (ext === 'blend') return 'Blender';
  if (ext === 'max') return '3ds Max';
  if (ext === 'ma' || ext === 'mb') return 'Maya';
  return 'Model';
}

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
