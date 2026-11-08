import * as THREE from 'three';

/** How a laptop lid / foldable hinge opens in model space. */
export type DeviceLidConfig =
  | {
      /** Rotate named nodes around local X between closed (0) and openAngle. */
      mode: 'node';
      nodes: string[];
      /** Open angle in radians when the file is authored closed (e.g. Timblewee). */
      openAngle?: number;
    }
  | {
      /**
       * Baked-open lids: wrap parts in a hinge group at the back edge.
       * Open = hinge.rotation.x 0; closed = closeAngle.
       */
      mode: 'hinge';
      /** Explicit node names to attach (lid assemblies). */
      nodes?: string[];
      /**
       * Also attach parents of meshes whose Y-center is above this fraction
       * of the model height (catches small lid bits like camera LEDs).
       */
      autoAbove?: number;
      /** Hinge X rotation when fully closed (radians). */
      closeAngle: number;
      /** Which lid-box Z extreme is the hinge edge. */
      hingeZ?: 'min' | 'max';
      /** Reparent screenMat meshes onto the hinge (default false). */
      includeScreen?: boolean;
    }
  | {
      /**
       * Book-style foldable: one wing swings around the spine.
       * Authored open/flat; lidOpen 1 = open, 0 = closed.
       */
      mode: 'fold';
      /** Moving wing parts (half of the device). */
      wing: string[];
      /**
       * Meshes that span the hinge (inner screen / glass). Split at the
       * plane so each half can ride with its wing.
       */
      splitSpans?: string[];
      /** Which side of the fold plane moves. Default: min (negative axis). */
      wingSide?: 'min' | 'max';
      /** Fold axis in model space. Default: y (book hinge). */
      axis?: 'x' | 'y' | 'z';
      /** Wing rotation when fully closed (radians). */
      closeAngle: number;
      /** Override hinge plane along the fold axis. Default: model center. */
      plane?: number;
    };

export type LidRig =
  | {
      mode: 'node';
      parts: Array<{ object: THREE.Object3D; openAngle: number }>;
    }
  | {
      mode: 'hinge';
      hinge: THREE.Group;
      closeAngle: number;
    }
  | {
      mode: 'fold';
      hinge: THREE.Group;
      closeAngle: number;
      axis: 'x' | 'y' | 'z';
    };

const HINGE_NAME = '__lidHinge';
const FOLD_HINGE_NAME = '__foldHinge';

export function lidControlLabel(config: DeviceLidConfig | undefined): string {
  if (!config) return 'Lid';
  return config.mode === 'fold' ? 'Fold' : 'Lid';
}

function collectAutoLidParents(root: THREE.Object3D, autoAbove: number): THREE.Object3D[] {
  root.updateMatrixWorld(true);
  const whole = new THREE.Box3().setFromObject(root);
  const height = Math.max(1e-6, whole.max.y - whole.min.y);
  const parents = new Set<THREE.Object3D>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.parent) return;
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const ry = (center.y - whole.min.y) / height;
    if (ry >= autoAbove) parents.add(mesh.parent);
  });
  return [...parents];
}

function isAncestorOf(ancestor: THREE.Object3D, node: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = node.parent;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parent;
  }
  return false;
}

function lowestCommonAncestor(objects: THREE.Object3D[]): THREE.Object3D | null {
  if (!objects.length) return null;
  const ancestors = (obj: THREE.Object3D) => {
    const list: THREE.Object3D[] = [];
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      list.push(cur);
      cur = cur.parent;
    }
    return list;
  };
  let shared = ancestors(objects[0]);
  for (let i = 1; i < objects.length; i += 1) {
    const set = new Set(ancestors(objects[i]));
    shared = shared.filter((node) => set.has(node));
  }
  return shared[0] ?? null;
}

/** Keep deepest lid roots only — never attach an ancestor of another selected root. */
function pruneLidRoots(lidRoots: THREE.Object3D[]): THREE.Object3D[] {
  return lidRoots.filter(
    (obj) => !lidRoots.some((other) => other !== obj && isAncestorOf(obj, other)),
  );
}

function collectScreenMeshes(root: THREE.Object3D, screenMat: string, lidRoots: THREE.Object3D[]): THREE.Object3D[] {
  const extras: THREE.Object3D[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!mats.some((mat) => mat && mat.name === screenMat)) return;
    let underLid = false;
    for (const lid of lidRoots) {
      let cur: THREE.Object3D | null = mesh;
      while (cur) {
        if (cur === lid) {
          underLid = true;
          break;
        }
        cur = cur.parent;
      }
      if (underLid) break;
    }
    if (!underLid) extras.push(mesh);
  });
  return extras;
}

function axisIndex(axis: 'x' | 'y' | 'z'): 0 | 1 | 2 {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
}

/** Planar UVs in local XY so a later split keeps continuous screenshot mapping. */
function bakePlanarUvXY(mesh: THREE.Mesh) {
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  if (!pos) return;
  let uv = geo.getAttribute('uv') as THREE.BufferAttribute | null;
  if (!uv || uv.count !== pos.count) {
    uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
    geo.setAttribute('uv', uv);
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  for (let i = 0; i < pos.count; i += 1) {
    uv.setXY(i, (pos.getX(i) - minX) / spanX, (pos.getY(i) - minY) / spanY);
  }
  uv.needsUpdate = true;
  mesh.userData.foldPreserveUv = true;
}

function extractHalfGeometry(
  source: THREE.BufferGeometry,
  axis: 'x' | 'y' | 'z',
  plane: number,
  keep: 'min' | 'max',
): THREE.BufferGeometry | null {
  const pos = source.getAttribute('position');
  if (!pos) return null;
  const ax = axisIndex(axis);
  const index = source.getIndex();
  const triCount = index ? index.count / 3 : pos.count / 3;
  const vert = (tri: number, corner: number) => (
    index ? index.getX(tri * 3 + corner) : tri * 3 + corner
  );

  const keptTris: number[] = [];
  for (let tri = 0; tri < triCount; tri += 1) {
    const i0 = vert(tri, 0);
    const i1 = vert(tri, 1);
    const i2 = vert(tri, 2);
    const cx = (pos.getComponent(i0, ax) + pos.getComponent(i1, ax) + pos.getComponent(i2, ax)) / 3;
    const onMin = cx < plane;
    if ((keep === 'min' && onMin) || (keep === 'max' && !onMin)) {
      keptTris.push(i0, i1, i2);
    }
  }
  if (!keptTris.length) return null;

  const remap = new Map<number, number>();
  const nextIndex: number[] = [];
  for (const src of keptTris) {
    let dst = remap.get(src);
    if (dst === undefined) {
      dst = remap.size;
      remap.set(src, dst);
    }
    nextIndex.push(dst);
  }

  const out = new THREE.BufferGeometry();
  const attrNames = Object.keys(source.attributes);
  for (const name of attrNames) {
    const attr = source.getAttribute(name);
    if (!attr) continue;
    const itemSize = attr.itemSize;
    const array = new Float32Array(remap.size * itemSize);
    for (const [src, dst] of remap) {
      for (let k = 0; k < itemSize; k += 1) {
        array[dst * itemSize + k] = attr.getComponent(src, k);
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  }
  out.setIndex(nextIndex);
  out.computeVertexNormals();
  return out;
}

/**
 * Split a spanning mesh at the fold plane. Returns the wing-side half
 * (attached to the hinge) and leaves the fixed half in place.
 */
function splitSpanForWing(
  mesh: THREE.Mesh,
  axis: 'x' | 'y' | 'z',
  plane: number,
  wingSide: 'min' | 'max',
): THREE.Mesh | null {
  bakePlanarUvXY(mesh);
  const fixedSide = wingSide === 'min' ? 'max' : 'min';
  const wingGeo = extractHalfGeometry(mesh.geometry, axis, plane, wingSide);
  const fixedGeo = extractHalfGeometry(mesh.geometry, axis, plane, fixedSide);
  if (!wingGeo || !fixedGeo) {
    wingGeo?.dispose();
    fixedGeo?.dispose();
    return null;
  }

  const wingMesh = mesh.clone();
  wingMesh.geometry = wingGeo;
  wingMesh.name = `${mesh.name}__fold_${wingSide}`;
  wingMesh.userData.foldPreserveUv = true;
  wingMesh.material = mesh.material;
  mesh.geometry.dispose();
  mesh.geometry = fixedGeo;
  mesh.name = `${mesh.name}__fold_${fixedSide}`;
  mesh.userData.foldPreserveUv = true;
  mesh.parent?.add(wingMesh);
  wingMesh.position.copy(mesh.position);
  wingMesh.quaternion.copy(mesh.quaternion);
  wingMesh.scale.copy(mesh.scale);
  return wingMesh;
}

function setupFoldRig(root: THREE.Object3D, config: Extract<DeviceLidConfig, { mode: 'fold' }>): LidRig | null {
  const axis = config.axis ?? 'y';
  const wingSide = config.wingSide ?? 'min';
  const ax = axisIndex(axis);

  const wingParts = config.wing
    .map((name) => root.getObjectByName(name))
    .filter((obj): obj is THREE.Object3D => Boolean(obj));
  if (!wingParts.length) return null;

  root.updateMatrixWorld(true);
  const whole = new THREE.Box3().setFromObject(root);
  if (whole.isEmpty()) return null;
  const plane = typeof config.plane === 'number'
    ? config.plane
    : (whole.min.getComponent(ax) + whole.max.getComponent(ax)) * 0.5;

  const wingExtras: THREE.Object3D[] = [];
  for (const name of config.splitSpans ?? []) {
    const obj = root.getObjectByName(name);
    const mesh = obj as THREE.Mesh | null;
    if (!mesh?.isMesh) continue;
    const wingHalf = splitSpanForWing(mesh, axis, plane, wingSide);
    if (wingHalf) wingExtras.push(wingHalf);
  }

  const attach = pruneLidRoots([...wingParts, ...wingExtras]);
  const hingeParent = root;
  const existing = hingeParent.children.find((child) => child.name === FOLD_HINGE_NAME);
  if (existing) existing.removeFromParent();

  const hinge = new THREE.Group();
  hinge.name = FOLD_HINGE_NAME;
  hingeParent.add(hinge);
  hingeParent.updateMatrixWorld(true);

  const hingeWorld = new THREE.Vector3().copy(whole.getCenter(new THREE.Vector3()));
  hingeWorld.setComponent(ax, plane);
  // Keep the hinge on the mid-thickness of the device along Z for book folds.
  if (axis === 'y') {
    hingeWorld.z = (whole.min.z + whole.max.z) * 0.5;
  }
  const inv = new THREE.Matrix4().copy(hingeParent.matrixWorld).invert();
  hinge.position.copy(hingeWorld).applyMatrix4(inv);
  hinge.updateMatrixWorld(true);

  for (const obj of attach) {
    if (obj === hinge || obj === hingeParent) continue;
    if (isAncestorOf(obj, hinge)) continue;
    hinge.attach(obj);
  }

  return {
    mode: 'fold',
    hinge,
    closeAngle: config.closeAngle,
    axis,
  };
}

/** Build a lid / fold rig once after cloning a GLB. */
export function setupLidRig(
  root: THREE.Object3D,
  config: DeviceLidConfig,
  screenMat: string,
): LidRig | null {
  if (config.mode === 'node') {
    const parts: Array<{ object: THREE.Object3D; openAngle: number }> = [];
    for (const name of config.nodes) {
      const object = root.getObjectByName(name);
      if (!object) continue;
      const authored = object.rotation.x;
      const openAngle = Math.abs(authored) > 0.15
        ? authored
        : (config.openAngle ?? -Math.PI * 0.6);
      parts.push({ object, openAngle });
    }
    return parts.length ? { mode: 'node', parts } : null;
  }

  if (config.mode === 'fold') {
    return setupFoldRig(root, config);
  }

  const named = (config.nodes ?? [])
    .map((name) => root.getObjectByName(name))
    .filter((obj): obj is THREE.Object3D => Boolean(obj));
  const auto = typeof config.autoAbove === 'number'
    ? collectAutoLidParents(root, config.autoAbove)
    : [];
  // Drop ancestors of other lid roots so we never reparent a node that owns the rest.
  const lidRoots = pruneLidRoots([...new Set([...named, ...auto])]);
  if (!lidRoots.length) return null;

  root.updateMatrixWorld(true);
  const lidBox = new THREE.Box3();
  for (const lid of lidRoots) lidBox.expandByObject(lid);
  if (lidBox.isEmpty()) return null;

  const hingeZ = (config.hingeZ ?? 'max') === 'min' ? lidBox.min.z : lidBox.max.z;
  const hingeWorld = new THREE.Vector3(
    (lidBox.min.x + lidBox.max.x) * 0.5,
    lidBox.min.y + (lidBox.max.y - lidBox.min.y) * 0.02,
    hingeZ,
  );

  // Prefer LCA of lid parts, but never hinge under the clone root — attaching
  // broad auto picks there easily cycles the scene graph (blank UI).
  const lca = lowestCommonAncestor(lidRoots);
  const hingeParent = (lca && lca !== root ? lca : lidRoots[0].parent);
  if (!hingeParent || hingeParent === root) return null;

  const existing = hingeParent.children.find((child) => child.name === HINGE_NAME);
  if (existing) existing.removeFromParent();

  const hinge = new THREE.Group();
  hinge.name = HINGE_NAME;
  hinge.userData.exportHide = false;
  hingeParent.add(hinge);
  hingeParent.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(hingeParent.matrixWorld).invert();
  hinge.position.copy(hingeWorld).applyMatrix4(inv);
  hinge.updateMatrixWorld(true);

  const extras = config.includeScreen ? collectScreenMeshes(root, screenMat, lidRoots) : [];
  for (const obj of [...lidRoots, ...extras]) {
    // Never attach the hinge parent / ancestors — that creates a cyclic scene graph
    // and blows the stack on the next traverse (blank UI).
    if (obj === hinge || obj === hingeParent) continue;
    if (isAncestorOf(obj, hinge)) continue;
    hinge.attach(obj);
  }

  return {
    mode: 'hinge',
    hinge,
    closeAngle: config.closeAngle,
  };
}

/** Apply 0 (closed) → 1 (open) to a previously built rig. */
export function applyLidOpen(rig: LidRig, lidOpen: number) {
  const open = Math.min(1, Math.max(0, lidOpen));
  if (rig.mode === 'node') {
    for (const part of rig.parts) {
      part.object.rotation.x = part.openAngle * open;
    }
    return;
  }
  const angle = rig.closeAngle * (1 - open);
  if (rig.mode === 'fold') {
    rig.hinge.rotation.x = 0;
    rig.hinge.rotation.y = 0;
    rig.hinge.rotation.z = 0;
    if (rig.axis === 'x') rig.hinge.rotation.x = angle;
    else if (rig.axis === 'y') rig.hinge.rotation.y = angle;
    else rig.hinge.rotation.z = angle;
    return;
  }
  rig.hinge.rotation.x = angle;
}
