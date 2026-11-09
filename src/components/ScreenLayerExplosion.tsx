import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ScreenLayerPlate } from '../types';

type ScreenFrame = {
  center: THREE.Vector3;
  width: number;
  height: number;
  quaternion: THREE.Quaternion;
};

function isScreenishName(name: string): boolean {
  const lower = (name || '').toLowerCase().trim();
  if (!lower || /glass/.test(lower)) return false;
  return (
    /^(fold_)?screen([._-]?\d+)?$/.test(lower)
    || /^(display|oled|lcd|cover.?screen|procedural.?screen)([._-]?\d+)?$/.test(lower)
    || /screen|display|oled|lcd/.test(lower)
  );
}

function isScreenishMaterial(name: string): boolean {
  const lower = (name || '').toLowerCase().trim();
  if (!lower || /glass/.test(lower)) return false;
  return /^(screen|display|oled|lcd|cover.?screen|procedural.?screen)([._-]?\d+)?$/.test(lower)
    || (/screen|display|oled|lcd/.test(lower) && !/graphite|body|bezel|frame/.test(lower));
}

/** Prefer true display meshes under the device host. */
function collectScreenMeshes(host: THREE.Object3D): THREE.Mesh[] {
  const named: THREE.Mesh[] = [];
  const byMat: THREE.Mesh[] = [];
  host.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible || !mesh.geometry) return;
    if (mesh.userData?.exportHide || mesh.userData?.isGizmoHandle) return;
    if (isScreenishName(mesh.name)) {
      named.push(mesh);
      return;
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (mats.some((mat) => mat && isScreenishMaterial(mat.name || ''))) {
      byMat.push(mesh);
    }
  });
  return named.length ? named : byMat;
}

/**
 * Measure the display panel in host-local space so explosion planes sit on the glass.
 * Falls back to a phone-ish rectangle centered on the host when no screen mesh is found.
 */
function measureScreenFrame(host: THREE.Object3D): ScreenFrame {
  host.updateWorldMatrix(true, true);
  const meshes = collectScreenMeshes(host);
  const inv = host.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const corner = new THREE.Vector3();
  let has = false;

  for (const mesh of meshes) {
    const geo = mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const local = geo.boundingBox;
    if (!local || local.isEmpty()) continue;
    const min = local.min;
    const max = local.max;
    for (let ix = 0; ix < 2; ix += 1) {
      for (let iy = 0; iy < 2; iy += 1) {
        for (let iz = 0; iz < 2; iz += 1) {
          corner.set(
            ix ? max.x : min.x,
            iy ? max.y : min.y,
            iz ? max.z : min.z,
          ).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
          if (!has) {
            box.set(corner.clone(), corner.clone());
            has = true;
          } else {
            box.expandByPoint(corner);
          }
        }
      }
    }
  }

  if (!has) {
    // Fitted devices are ~3 tall; a phone screen is slightly smaller than the body.
    return {
      center: new THREE.Vector3(0, 0, 0.08),
      width: 1.35,
      height: 2.75,
      quaternion: new THREE.Quaternion(),
    };
  }

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // Sit plates on the front face (+Z after studio fit).
  center.z = box.max.z + 0.004;
  const width = Math.max(size.x, 0.2);
  const height = Math.max(size.y, 0.2);
  return {
    center,
    width,
    height,
    quaternion: new THREE.Quaternion(),
  };
}

function LayerPlateMesh({
  dataUrl,
  width,
  height,
  position,
  renderOrder,
}: {
  dataUrl: string;
  width: number;
  height: number;
  position: [number, number, number];
  renderOrder: number;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const [map, setMap] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.load(
      dataUrl,
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.needsUpdate = true;
        setMap(tex);
        invalidate();
      },
      undefined,
      () => {
        if (!cancelled) setMap(null);
      },
    );
    return () => {
      cancelled = true;
      setMap((current) => {
        current?.dispose();
        return null;
      });
    };
  }, [dataUrl, invalidate]);

  const material = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      metalness: 0,
      roughness: 0.55,
      clearcoat: 0.15,
      clearcoatRoughness: 0.4,
      envMapIntensity: 0.15,
    });
    return mat;
  }, []);

  useEffect(() => {
    material.map = map;
    material.needsUpdate = true;
    invalidate();
  }, [material, map, invalidate]);

  useEffect(() => () => material.dispose(), [material]);

  if (!map) return null;

  return (
    <mesh
      position={position}
      renderOrder={renderOrder}
      castShadow
      receiveShadow={false}
      material={material}
    >
      <planeGeometry args={[width, height]} />
    </mesh>
  );
}

/**
 * Rotato-style UI layer explosion: top-level plates lift off the device glass along +Z.
 * Amount 0 keeps them coincident with the screen; 1 spreads them into a depth stack.
 */
export default function ScreenLayerExplosion({
  host,
  layers,
  amount,
}: {
  host: THREE.Object3D | null;
  layers: ScreenLayerPlate[];
  amount: number;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const [frame, setFrame] = useState<ScreenFrame | null>(null);
  const clamped = Math.min(1, Math.max(0, amount));

  useLayoutEffect(() => {
    if (!host || layers.length < 2) {
      setFrame(null);
      return;
    }
    // Wait one frame so GLTF / procedural screens have finished fitting.
    const id = requestAnimationFrame(() => {
      try {
        setFrame(measureScreenFrame(host));
        invalidate();
      } catch {
        setFrame(null);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [host, layers, invalidate]);

  if (!host || !frame || layers.length < 2 || clamped < 0.001) return null;

  // Spread grows with plate count so tall stacks still read as exploded.
  // Bottom plate stays on the device screenshot; upper plates peel off like Rotato.
  const gap = (0.055 + clamped * 0.22) * (0.85 + Math.min(layers.length, 10) * 0.04);
  const upper = layers.slice(1);

  return (
    <group
      position={[frame.center.x, frame.center.y, frame.center.z]}
      quaternion={frame.quaternion}
    >
      {upper.map((plate, index) => {
        const step = index + 1;
        const lift = step * gap;
        return (
          <LayerPlateMesh
            key={plate.id}
            dataUrl={plate.dataUrl}
            width={frame.width}
            height={frame.height}
            position={[0, 0, lift]}
            renderOrder={40 + step}
          />
        );
      })}
    </group>
  );
}
