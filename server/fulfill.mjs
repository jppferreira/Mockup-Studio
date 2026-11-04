import { signLicense, planLabel } from '../scripts/lib/sign-license.mjs';
import { sendLicenseEmail } from './email.mjs';
import { findByOrderId, saveIssued } from './store.mjs';

/**
 * @typedef {'pro' | 'pro_max' | 'update_pass'} LicenseTier
 */

/**
 * Map store variant / price IDs → tier via env.
 * @param {string | number | null | undefined} productId
 * @returns {LicenseTier | null}
 */
export function tierFromProductId(productId) {
  if (productId == null || productId === '') return null;
  const id = String(productId).trim();
  const map = {
    [process.env.LEMON_VARIANT_PRO || '']: 'pro',
    [process.env.LEMON_VARIANT_PRO_MAX || '']: 'pro_max',
    [process.env.LEMON_VARIANT_UPDATE_PASS || '']: 'update_pass',
    [process.env.PADDLE_PRICE_PRO || '']: 'pro',
    [process.env.PADDLE_PRICE_PRO_MAX || '']: 'pro_max',
    [process.env.PADDLE_PRICE_UPDATE_PASS || '']: 'update_pass',
  };
  return /** @type {LicenseTier | null} */ (map[id] ?? null);
}

/**
 * Core fulfillment: idempotent sign + email.
 * @param {{
 *   orderId: string,
 *   email: string,
 *   tier: LicenseTier,
 *   provider: 'lemonsqueezy' | 'paddle' | 'dev',
 * }} input
 */
export async function fulfillPurchase(input) {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return { ok: false, status: 400, error: 'Missing buyer email' };
  }
  if (!input.orderId) {
    return { ok: false, status: 400, error: 'Missing orderId' };
  }

  const existing = findByOrderId(input.orderId);
  if (existing?.key) {
    // Already fulfilled — resend the same key (safe idempotency for webhook retries).
    const mail = await sendLicenseEmail({
      email: existing.email || email,
      tier: existing.tier,
      key: existing.key,
      orderId: input.orderId,
    });
    if (!mail.ok) {
      return { ok: false, status: 502, error: mail.error, duplicate: true };
    }
    return {
      ok: true,
      duplicate: true,
      tier: existing.tier,
      key: existing.key,
      email: existing.email || email,
      dryRun: Boolean(mail.dryRun),
      plan: planLabel(existing.tier),
    };
  }

  let signed;
  try {
    signed = signLicense(input.tier);
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const mail = await sendLicenseEmail({
    email,
    tier: input.tier,
    key: signed.key,
    orderId: input.orderId,
  });
  if (!mail.ok) {
    return { ok: false, status: 502, error: mail.error };
  }

  saveIssued({
    orderId: input.orderId,
    email,
    tier: input.tier,
    key: signed.key,
    provider: input.provider,
    emailedAt: new Date().toISOString(),
  });

  return {
    ok: true,
    duplicate: false,
    tier: input.tier,
    key: signed.key,
    email,
    dryRun: Boolean(mail.dryRun),
    plan: planLabel(input.tier),
  };
}
