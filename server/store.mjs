/**
 * Simple file-backed idempotency store for issued licenses.
 * Replace with Postgres/KV in production if you prefer.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataPath =
  process.env.LICENSE_STORE_PATH ||
  join(dirname(fileURLToPath(import.meta.url)), 'data/issued-licenses.json');

function readAll() {
  if (!existsSync(dataPath)) return { orders: {} };
  try {
    return JSON.parse(readFileSync(dataPath, 'utf8'));
  } catch {
    return { orders: {} };
  }
}

function writeAll(data) {
  mkdirSync(dirname(dataPath), { recursive: true });
  writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * @param {string} orderId
 * @returns {object | null}
 */
export function findByOrderId(orderId) {
  const data = readAll();
  return data.orders[orderId] ?? null;
}

/**
 * @param {string} email
 * @returns {object[]} newest first
 */
export function findByEmail(email) {
  const needle = email.trim().toLowerCase();
  const data = readAll();
  return Object.values(data.orders)
    .filter((row) => String(row.email || '').toLowerCase() === needle)
    .sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || '')));
}

/**
 * @param {{
 *   orderId: string,
 *   email: string,
 *   tier: string,
 *   key: string,
 *   provider: string,
 *   emailedAt?: string | null,
 * }} record
 */
export function saveIssued(record) {
  const data = readAll();
  data.orders[record.orderId] = {
    ...record,
    issuedAt: record.issuedAt ?? new Date().toISOString(),
  };
  writeAll(data);
  return data.orders[record.orderId];
}

/**
 * Replace the live key for an order; keep previous keys for audit.
 * @param {string} orderId
 * @param {{ key: string, tier?: string }} next
 */
export function reissueKey(orderId, next) {
  const data = readAll();
  const existing = data.orders[orderId];
  if (!existing) return null;
  const previousKeys = Array.isArray(existing.previousKeys) ? existing.previousKeys : [];
  if (existing.key) {
    previousKeys.push({
      key: existing.key,
      replacedAt: new Date().toISOString(),
    });
  }
  data.orders[orderId] = {
    ...existing,
    key: next.key,
    tier: next.tier || existing.tier,
    previousKeys,
    reissuedAt: new Date().toISOString(),
    emailedAt: new Date().toISOString(),
  };
  writeAll(data);
  return data.orders[orderId];
}

export function storePath() {
  return dataPath;
}
