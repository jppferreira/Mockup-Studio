/**
 * Allow the marketing site to call recover endpoints from the browser.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export function applyCors(req, res) {
  const allowed = (process.env.CORS_ORIGIN || process.env.SITE_URL || process.env.VITE_SITE_URL || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = req.headers.origin;
  if (allowed.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (origin && /localhost|127\.0\.0\.1/.test(origin)) {
    // Local website (vite :5180) during development
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Fulfill-Secret');
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export function handleOptions(req, res) {
  applyCors(req, res);
  res.writeHead(204);
  res.end();
}
