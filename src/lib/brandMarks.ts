import type * as THREE from 'three';

/**
 * Detect manufacturer logo / wordmark nodes and materials so they can be
 * hidden in the studio, thumbs, and exports (Rotato-style).
 *
 * Conservative matching: avoid hashed Sketchfab names that accidentally
 * contain substrings like "jbl" / "sony".
 */
export function isBrandLogoName(name: string | undefined | null): boolean {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return false;

  // Exact manufacturer mark nodes (not device roots like "Apple HomeView").
  if (/^(?:apple|samsung|google)$/i.test(trimmed)) return true;

  // Explicit logo / wordmark / emblem naming.
  if (
    /(?:^|[_\s.-])(?:apple\s*)?logo(?:$|[_\s.-])/i.test(trimmed)
    || /apple[\s_-]*logo/i.test(trimmed)
    || /(?:^|[_\s.-])(?:samsung|google|g)\s*logo(?:$|[_\s.-])/i.test(trimmed)
    || /base\s*color\s*logo/i.test(trimmed)
    || /(?:^|[_\s.-])(?:wordmark|emblem|brand[\s_-]?mark)(?:$|[_\s.-])/i.test(trimmed)
    || /^logo(?:[._]\d+)?$/i.test(trimmed)
    || /^logo_/i.test(trimmed)
  ) {
    return true;
  }

  // Common brand logo materials / meshes with a clear logo token.
  if (
    /jbl[\s_-]*logo/i.test(trimmed)
    || /button[\s_-]*logo/i.test(trimmed)
    || /^google(?:\.\d+)?$/i.test(trimmed)
  ) {
    return true;
  }

  return false;
}

function materialNamesOn(obj: THREE.Object3D): string[] {
  const mesh = obj as THREE.Mesh;
  if (!mesh.isMesh || !mesh.material) return [];
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return mats.map((mat) => (mat?.name ?? '').trim()).filter(Boolean);
}

/** True when the object or any of its materials looks like a brand mark. */
export function isBrandLogoObject(obj: THREE.Object3D): boolean {
  if (isBrandLogoName(obj.name)) return true;
  return materialNamesOn(obj).some((name) => isBrandLogoName(name));
}

/**
 * Hide manufacturer logos on a cloned scene graph.
 * Does not dispose geometry — visibility only, safe for exports and thumbs.
 */
export function hideBrandMarks(
  root: THREE.Object3D,
  options?: {
    /** Extra exact node / mesh names from the device library. */
    hideNodes?: readonly string[];
  },
): void {
  const hidden = new Set(options?.hideNodes ?? []);
  root.traverse((obj) => {
    if (hidden.has(obj.name) || isBrandLogoObject(obj)) {
      obj.visible = false;
    }
  });
}
