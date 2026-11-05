import * as THREE from 'three';

/** How a laptop lid opens in model space. */
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
    };

const HINGE_NAME = '__lidHinge';

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

/** Build a lid rig once after cloning a GLB. */
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
  rig.hinge.rotation.x = rig.closeAngle * (1 - open);
}
