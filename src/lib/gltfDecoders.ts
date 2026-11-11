/**
 * Ensure GLTFLoader meshopt (and optional Draco) decoders are ready before the
 * first compressed model parse. drei's useGLTF enables Meshopt by default, but
 * MeshoptDecoder().ready must resolve or EXT_meshopt_compression throws mid-load.
 */
import { MeshoptDecoder } from 'three-stdlib';

let readyPromise: Promise<void> | null = null;

export function ensureGltfDecoders(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const decoder = typeof MeshoptDecoder === 'function'
      ? MeshoptDecoder()
      : MeshoptDecoder;
    const ready = (decoder as { ready?: Promise<unknown> } | null)?.ready;
    if (ready) await ready;
  })().catch((error) => {
    // Allow retry on next call if wasm init failed once.
    readyPromise = null;
    throw error;
  });
  return readyPromise;
}

/** Fire-and-forget warm so the first card tap does not pay wasm compile. */
export function warmGltfDecoders(): void {
  void ensureGltfDecoders().catch(() => undefined);
}
