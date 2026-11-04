#!/usr/bin/env node
/**
 * Mockup Studio license fulfillment server.
 *
 * Endpoints:
 *   GET  /health
 *   POST /webhooks/lemonsqueezy   — Lemon Squeezy order webhooks
 *   POST /webhooks/paddle         — Paddle Billing transaction webhooks
 *   POST /dev/fulfill             — local test (no store signature); requires FULFILL_DEV_SECRET
 *   POST /recover/request         — email a 6-digit recovery code
 *   POST /recover/confirm         — verify code + email a fresh signed key
 *
 * Env: see server/.env.example and root .env.example
 */
import { createServer } from 'node:http';
import { config as loadEnv } from './load-env.mjs';
import { applyCors, handleOptions } from './cors.mjs';
import { fulfillPurchase } from './fulfill.mjs';
import { confirmRecover, requestRecover } from './recover.mjs';
import { storePath } from './store.mjs';
import { handleLemonSqueezyWebhook } from './webhooks/lemonsqueezy.mjs';
import { handlePaddleWebhook } from './webhooks/paddle.mjs';

loadEnv();

const PORT = Number(process.env.FULFILL_PORT || 8787);
const HOST = process.env.FULFILL_HOST || '127.0.0.1';

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** @param {import('node:http').IncomingMessage} req */
function headerMap(req) {
  /** @type {Record<string, string | string[] | undefined>} */
  const out = {};
  for (const [k, v] of Object.entries(req.headers)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {object} body
 */
function sendJson(req, res, status, body) {
  applyCors(req, res);
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const method = req.method || 'GET';

  try {
    if (method === 'OPTIONS') {
      handleOptions(req, res);
      return;
    }

    if (method === 'GET' && url.pathname === '/health') {
      sendJson(req, res, 200, { ok: true, store: storePath() });
      return;
    }

    if (method === 'POST' && url.pathname === '/webhooks/lemonsqueezy') {
      const raw = await readRawBody(req);
      const result = await handleLemonSqueezyWebhook(raw, headerMap(req));
      sendJson(req, res, result.status, result.body);
      return;
    }

    if (method === 'POST' && url.pathname === '/webhooks/paddle') {
      const raw = await readRawBody(req);
      const result = await handlePaddleWebhook(raw, headerMap(req));
      sendJson(req, res, result.status, result.body);
      return;
    }

    if (method === 'POST' && url.pathname === '/recover/request') {
      const raw = await readRawBody(req);
      let body;
      try {
        body = JSON.parse(raw.toString('utf8') || '{}');
      } catch {
        sendJson(req, res, 400, { ok: false, error: 'Invalid JSON' });
        return;
      }
      const result = await requestRecover({
        email: String(body.email || ''),
        orderId: body.orderId ? String(body.orderId) : undefined,
      });
      sendJson(req, res, result.ok ? 200 : result.status || 500, result);
      return;
    }

    if (method === 'POST' && url.pathname === '/recover/confirm') {
      const raw = await readRawBody(req);
      let body;
      try {
        body = JSON.parse(raw.toString('utf8') || '{}');
      } catch {
        sendJson(req, res, 400, { ok: false, error: 'Invalid JSON' });
        return;
      }
      const result = await confirmRecover({
        email: String(body.email || ''),
        code: String(body.code || ''),
      });
      sendJson(req, res, result.ok ? 200 : result.status || 500, result);
      return;
    }

    if (method === 'POST' && url.pathname === '/dev/fulfill') {
      const expected = process.env.FULFILL_DEV_SECRET || 'dev-secret';
      const headers = headerMap(req);
      const got = headers['x-fulfill-secret'];
      if (got !== expected) {
        sendJson(req, res, 401, { ok: false, error: 'Invalid X-Fulfill-Secret' });
        return;
      }
      const raw = await readRawBody(req);
      let body;
      try {
        body = JSON.parse(raw.toString('utf8') || '{}');
      } catch {
        sendJson(req, res, 400, { ok: false, error: 'Invalid JSON' });
        return;
      }
      const tier = body.tier;
      if (tier !== 'pro' && tier !== 'pro_max' && tier !== 'update_pass') {
        sendJson(req, res, 400, { ok: false, error: 'tier must be pro | pro_max | update_pass' });
        return;
      }
      const result = await fulfillPurchase({
        orderId: String(body.orderId || `dev-${Date.now()}`),
        email: String(body.email || ''),
        tier,
        provider: 'dev',
      });
      sendJson(req, res, result.ok ? 200 : result.status || 500, result);
      return;
    }

    sendJson(req, res, 404, { ok: false, error: 'Not found' });
  } catch (err) {
    console.error(err);
    sendJson(req, res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`License fulfillment listening on http://${HOST}:${PORT}`);
  console.log('  GET  /health');
  console.log('  POST /webhooks/lemonsqueezy');
  console.log('  POST /webhooks/paddle');
  console.log('  POST /recover/request');
  console.log('  POST /recover/confirm');
  console.log('  POST /dev/fulfill  (X-Fulfill-Secret)');
  console.log('Store:', storePath());
  if (!process.env.RESEND_API_KEY) {
    console.log('Email: dry-run (set RESEND_API_KEY to send via Resend)');
  }
});
