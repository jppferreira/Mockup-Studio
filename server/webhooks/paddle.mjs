import { createHmac, timingSafeEqual } from 'node:crypto';
import { fulfillPurchase, tierFromProductId } from '../fulfill.mjs';

/**
 * Paddle Billing webhook signature:
 * HMAC-SHA256 of `${ts}:${rawBody}` using the endpoint secret, compared to
 * `Paddle-Signature` header parts (`ts=…;h1=…`).
 * @param {Buffer} rawBody
 * @param {string | null} signatureHeader
 * @param {string} secret
 */
export function verifyPaddleSignature(rawBody, signatureHeader, secret) {
  if (!secret) return { ok: false, error: 'PADDLE_WEBHOOK_SECRET not set' };
  if (!signatureHeader) return { ok: false, error: 'Missing Paddle-Signature header' };

  const parts = Object.fromEntries(
    signatureHeader.split(';').map((p) => {
      const [k, v] = p.split('=');
      return [k.trim(), v];
    }),
  );
  const ts = parts.ts;
  const h1 = parts.h1;
  if (!ts || !h1) return { ok: false, error: 'Malformed Paddle-Signature' };

  const signedPayload = `${ts}:${rawBody.toString('utf8')}`;
  const digest = createHmac('sha256', secret).update(signedPayload).digest('hex');
  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(h1, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: 'Invalid Paddle signature' };
  }
  return { ok: true };
}

/**
 * @param {Buffer} rawBody
 * @param {Record<string, string | string[] | undefined>} headers
 */
export async function handlePaddleWebhook(rawBody, headers) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET || '';
  const sig = /** @type {string | undefined} */ (headers['paddle-signature']);
  const verified = verifyPaddleSignature(rawBody, sig ?? null, secret);
  if (!verified.ok) {
    return { status: 401, body: { ok: false, error: verified.error } };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { status: 400, body: { ok: false, error: 'Invalid JSON' } };
  }

  const eventType = payload?.event_type || payload?.eventType;
  const allowed = new Set(['transaction.completed', 'transaction.paid']);
  if (eventType && !allowed.has(eventType)) {
    return { status: 200, body: { ok: true, ignored: true, eventType } };
  }

  const data = payload?.data ?? {};
  const email =
    data.customer?.email ||
    data.details?.customer?.email ||
    payload?.custom_data?.email;
  const orderId = String(data.id || data.transaction_id || '');
  const priceId =
    data.items?.[0]?.price?.id ||
    data.items?.[0]?.price_id ||
    data.details?.line_items?.[0]?.price_id;

  const tier =
    tierFromProductId(priceId) ||
    /** @type {'pro' | 'pro_max' | 'update_pass' | null} */ (payload?.custom_data?.tier ?? null);

  if (!tier) {
    return {
      status: 422,
      body: {
        ok: false,
        error: 'Unknown price — set PADDLE_PRICE_PRO / PRO_MAX / UPDATE_PASS',
        priceId,
      },
    };
  }

  const result = await fulfillPurchase({
    orderId: orderId || `paddle-${priceId}-${email}`,
    email: String(email || ''),
    tier,
    provider: 'paddle',
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
