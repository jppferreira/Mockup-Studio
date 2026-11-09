/** mokstudio project container: MKUP + version + gzip(JSON). */

export const MOCKUP_EXTENSION = 'mockup';
export const MOCKUP_LEGACY_EXTENSION = 'mockup.json';
export const MOCKUP_MIME = 'application/x-mockup-studio';
export const MOCKUP_VERSION = 1;

const MAGIC = new TextEncoder().encode('MKUP');

function isMagic(bytes: Uint8Array) {
  return bytes.length >= 5
    && bytes[0] === MAGIC[0]
    && bytes[1] === MAGIC[1]
    && bytes[2] === MAGIC[2]
    && bytes[3] === MAGIC[3];
}

async function gzipBytes(input: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('Compression is not available in this browser.');
  }
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipBytes(input: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Decompression is not available in this browser.');
  }
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Pack project JSON into a proprietary `.mockup` binary. */
export async function encodeMockupFile(jsonText: string): Promise<Uint8Array> {
  const compressed = await gzipBytes(new TextEncoder().encode(jsonText));
  const out = new Uint8Array(5 + compressed.length);
  out.set(MAGIC, 0);
  out[4] = MOCKUP_VERSION;
  out.set(compressed, 5);
  return out;
}

/** Decode `.mockup` binary or legacy plain JSON into a JSON string. */
export async function decodeMockupFile(bytes: Uint8Array): Promise<string> {
  if (isMagic(bytes)) {
    const version = bytes[4];
    if (version !== MOCKUP_VERSION) {
      throw new Error(`Unsupported mokstudio file version (${version}).`);
    }
    const jsonBytes = await gunzipBytes(bytes.subarray(5));
    return new TextDecoder().decode(jsonBytes);
  }
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '').trim();
  if (!text.startsWith('{')) {
    throw new Error('This is not a valid mokstudio project.');
  }
  return text;
}

export async function readProjectFileContents(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return decodeMockupFile(bytes);
}

export function isProjectFileName(name: string) {
  const lower = name.toLowerCase();
  return lower.endsWith('.mockup') || lower.endsWith('.mockup.json') || lower.endsWith('.json');
}

export function mockupDownloadName(baseName: string) {
  return `${baseName}.${MOCKUP_EXTENSION}`;
}
