/**
 * Short-lived recovery OTPs (file-backed).
 */
import { randomInt, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const otpPath =
  process.env.LICENSE_OTP_PATH ||
  join(dirname(fileURLToPath(import.meta.url)), 'data/recover-otps.json');

const TTL_MS = Number(process.env.RECOVER_OTP_TTL_MS || 15 * 60 * 1000);
const MAX_ATTEMPTS = 5;

function readAll() {
  if (!existsSync(otpPath)) return { codes: {} };
  try {
    return JSON.parse(readFileSync(otpPath, 'utf8'));
  } catch {
    return { codes: {} };
  }
}

function writeAll(data) {
  mkdirSync(dirname(otpPath), { recursive: true });
  writeFileSync(otpPath, `${JSON.stringify(data, null, 2)}\n`);
}

/** @param {string} email */
function keyFor(email) {
  return email.trim().toLowerCase();
}

/** @param {string} code */
function hashCode(code) {
  return createHash('sha256').update(String(code)).digest('hex');
}

/**
 * @param {string} email
 * @param {{ orderId: string, tier: string }} meta
 * @returns {{ code: string, expiresAt: string }}
 */
export function createOtp(email, meta) {
  const code = String(randomInt(100000, 999999));
  const data = readAll();
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  data.codes[keyFor(email)] = {
    hash: hashCode(code),
    orderId: meta.orderId,
    tier: meta.tier,
    expiresAt,
    attempts: 0,
  };
  writeAll(data);
  return { code, expiresAt };
}

/**
 * @param {string} email
 * @param {string} code
 * @returns {{ ok: true, orderId: string, tier: string } | { ok: false, error: string }}
 */
export function consumeOtp(email, code) {
  const data = readAll();
  const entry = data.codes[keyFor(email)];
  if (!entry) return { ok: false, error: 'No active code — request a new one.' };
  if (Date.parse(entry.expiresAt) < Date.now()) {
    delete data.codes[keyFor(email)];
    writeAll(data);
    return { ok: false, error: 'Code expired — request a new one.' };
  }
  entry.attempts = (entry.attempts || 0) + 1;
  if (entry.attempts > MAX_ATTEMPTS) {
    delete data.codes[keyFor(email)];
    writeAll(data);
    return { ok: false, error: 'Too many attempts — request a new code.' };
  }
  if (entry.hash !== hashCode(String(code).trim())) {
    writeAll(data);
    return { ok: false, error: 'Incorrect code.' };
  }
  delete data.codes[keyFor(email)];
  writeAll(data);
  return { ok: true, orderId: entry.orderId, tier: entry.tier };
}
