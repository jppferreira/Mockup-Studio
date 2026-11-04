import { randomBytes } from 'node:crypto';
import { signLicense } from '../scripts/lib/sign-license.mjs';
import { sendLicenseEmail, sendRecoverCodeEmail } from './email.mjs';
import { createOtp, consumeOtp } from './otp.mjs';
import { findByEmail, findByOrderId, reissueKey } from './store.mjs';

/**
 * Step 1: buyer enters purchase email (+ optional orderId).
 * Always returns a generic success message when possible (limits email enumeration).
 * In dry-run (no RESEND_API_KEY), includes `devCode` for local testing.
 *
 * @param {{ email: string, orderId?: string }} input
 */
export async function requestRecover(input) {
  const email = String(input.email || '')
    .trim()
    .toLowerCase();
  if (!email.includes('@')) {
    return { ok: false, status: 400, error: 'Enter a valid email.' };
  }

  let record = null;
  if (input.orderId) {
    const byId = findByOrderId(String(input.orderId).trim());
    if (byId && String(byId.email || '').toLowerCase() === email) {
      record = byId;
    }
  }
  if (!record) {
    const matches = findByEmail(email);
    record = matches[0] ?? null;
  }

  const generic = {
    ok: true,
    message: 'If we find a purchase for that email, a 6-digit code is on its way. It expires in 15 minutes.',
  };

  if (!record) {
    return generic;
  }

  const { code, expiresAt } = createOtp(email, {
    orderId: record.orderId,
    tier: record.tier,
  });

  const mail = await sendRecoverCodeEmail({ email, code, orderId: record.orderId });
  if (!mail.ok) {
    return { ok: false, status: 502, error: mail.error };
  }

  return {
    ...generic,
    dryRun: Boolean(mail.dryRun),
    /** Only present when Resend is unset — for local QA */
    ...(mail.dryRun ? { devCode: code, expiresAt, orderId: record.orderId } : {}),
  };
}

/**
 * Step 2: buyer submits email + code → fresh signed key emailed.
 * @param {{ email: string, code: string }} input
 */
export async function confirmRecover(input) {
  const email = String(input.email || '')
    .trim()
    .toLowerCase();
  const code = String(input.code || '').trim();
  if (!email.includes('@') || !code) {
    return { ok: false, status: 400, error: 'Email and code are required.' };
  }

  const verified = consumeOtp(email, code);
  if (!verified.ok) {
    return { ok: false, status: 401, error: verified.error };
  }

  const existing = findByOrderId(verified.orderId);
  if (!existing || String(existing.email || '').toLowerCase() !== email) {
    return { ok: false, status: 404, error: 'Purchase not found.' };
  }

  const tier = /** @type {'pro' | 'pro_max' | 'update_pass'} */ (existing.tier);
  if (tier !== 'pro' && tier !== 'pro_max' && tier !== 'update_pass') {
    return { ok: false, status: 500, error: 'Stored tier is invalid.' };
  }

  let signed;
  try {
    signed = signLicense(tier, { nonce: randomBytes(4).toString('hex') });
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const updated = reissueKey(verified.orderId, { key: signed.key, tier });
  if (!updated) {
    return { ok: false, status: 500, error: 'Could not update license record.' };
  }

  const mail = await sendLicenseEmail({
    email,
    tier,
    key: signed.key,
    orderId: verified.orderId,
    reason: 'reissue',
  });
  if (!mail.ok) {
    return { ok: false, status: 502, error: mail.error };
  }

  return {
    ok: true,
    tier,
    orderId: verified.orderId,
    email,
    dryRun: Boolean(mail.dryRun),
    /** Dev convenience — production UI does not need the key in the browser */
    ...(mail.dryRun ? { key: signed.key } : {}),
    message: 'A new license key has been emailed to you. Activate it in the Mac app under License.',
  };
}
