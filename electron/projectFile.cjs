const zlib = require('node:zlib');

const MAGIC = Buffer.from('MKUP');
const VERSION = 1;

function isMockupBinary(buf) {
  return Buffer.isBuffer(buf)
    && buf.length >= 5
    && buf[0] === MAGIC[0]
    && buf[1] === MAGIC[1]
    && buf[2] === MAGIC[2]
    && buf[3] === MAGIC[3];
}

function encodeProjectFile(jsonText) {
  if (typeof jsonText !== 'string' || !jsonText) {
    throw new Error('Invalid project contents');
  }
  const compressed = zlib.gzipSync(Buffer.from(jsonText, 'utf8'), { level: 6 });
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), compressed]);
}

function decodeProjectFile(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (isMockupBinary(bytes)) {
    const version = bytes[4];
    if (version !== VERSION) {
      throw new Error(`Unsupported Mockup Studio file version (${version}).`);
    }
    return zlib.gunzipSync(bytes.subarray(5)).toString('utf8');
  }
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '').trim();
  if (!text.startsWith('{')) {
    throw new Error('This is not a valid Mockup Studio project.');
  }
  return text;
}

function isProjectFileName(name) {
  const lower = String(name || '').toLowerCase();
  return lower.endsWith('.mockup') || lower.endsWith('.mockup.json');
}

function stripProjectExtension(name) {
  return String(name || '')
    .replace(/\.mockup\.json$/i, '')
    .replace(/\.mockup$/i, '');
}

module.exports = {
  VERSION,
  encodeProjectFile,
  decodeProjectFile,
  isMockupBinary,
  isProjectFileName,
  stripProjectExtension,
};
