import { createHmac, timingSafeEqual } from 'node:crypto';
import { fulfillPurchase, tierFromProductId } from '../fulfill.mjs';

/**
 * Verify Lemon Squeezy webhook signature (HMAC-SHA256 hex of raw body).
 * @param {Buffer} rawBody
 * @param {string | null} signatureHeader
 * @param {string} secret
 */
export function verifyLemonSignature(rawBody, signatureHeader, secret) {
  if (!secret) return { ok: false, error: 'LEMON_SQUEEZY_WEBHOOK_SECRET not set' };
  if (!signatureHeader) return { ok: false, error: 'Missing X-Signature header' };
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: 'Invalid Lemon Squeezy signature' };
  }
  return { ok: true };
}

/**
 * @param {Buffer} rawBody
 * @param {Record<string, string | string[] | undefined>} headers
 */
export async function handleLemonSqueezyWebhook(rawBody, headers) {
  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET || '';
  const sig = /** @type {string | undefined} */ (headers['x-signature']);
  const verified = verifyLemonSignature(rawBody, sig ?? null, secret);
  if (!verified.ok) {
    return { status: 401, body: { ok: false, error: verified.error } };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { status: 400, body: { ok: false, error: 'Invalid JSON' } };
  }

  const eventName = payload?.meta?.event_name || payload?.event_name;
  // Fulfill on paid order events; ignore the rest.
  const allowed = new Set([
    'order_created',
    'subscription_payment_success', // if you ever sell Update Pass as sub
  ]);
  if (eventName && !allowed.has(eventName)) {
    return { status: 200, body: { ok: true, ignored: true, eventName } };
  }

  const attrs = payload?.data?.attributes ?? {};
  const email = attrs.user_email || attrs.customer_email || payload?.meta?.custom_data?.email;
  const orderId = String(payload?.data?.id ?? attrs.identifier ?? attrs.order_number ?? '');
  const variantId =
    attrs.first_order_item?.variant_id ??
    attrs.variant_id ??
    payload?.meta?.custom_data?.variant_id;

  const tier =
    tierFromProductId(variantId) ||
    /** @type {'pro' | 'pro_max' | 'update_pass' | null} */ (
      payload?.meta?.custom_data?.tier ?? null
    );

  if (!tier) {
    return {
      status: 422,
      body: {
        ok: false,
        error: 'Unknown variant — set LEMON_VARIANT_PRO / PRO_MAX / UPDATE_PASS',
        variantId,
      },
    };
  }

  const result = await fulfillPurchase({
    orderId: orderId || `lemon-${variantId}-${email}`,
    email: String(email || ''),
    tier,
    provider: 'lemonsqueezy',
  });

  if (!result.ok) {
    return { status: result.status || 500, body: { ok: false, error: result.error } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      duplicate: result.duplicate,
      tier: result.tier,
      email: result.email,
      dryRun: result.dryRun,
    },
  };
}
