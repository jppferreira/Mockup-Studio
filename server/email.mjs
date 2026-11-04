/**
 * Confirmation email via Resend (https://resend.com).
 * If RESEND_API_KEY is unset, logs the message (dry-run) so local testing works.
 */
import { planLabel } from '../scripts/lib/sign-license.mjs';

function siteUrl() {
  return (process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://mockupstudio.app').replace(
    /\/$/,
    '',
  );
}

function downloadUrl() {
  return process.env.VITE_DOWNLOAD_MAC_URL || `${siteUrl()}/#download`;
}

/**
 * @param {{ email: string, tier: string, key: string, orderId?: string, reason?: 'purchase' | 'reissue' }} opts
 */
export function buildConfirmationEmail(opts) {
  const label = planLabel(opts.tier);
  const site = siteUrl();
  const download = downloadUrl();
  const reissue = opts.reason === 'reissue';
  const subject = reissue
    ? `Your new Mockup Studio ${label} license key`
    : `Your Mockup Studio ${label} license key`;
  const intro = reissue
    ? `Here is a new license key for Mockup Studio ${label} (reissued after verification).`
    : `Thanks for buying Mockup Studio ${label}.`;
  const text = [
    intro,
    '',
    'Your license key:',
    opts.key,
    '',
    'Install & activate:',
    `1. Download the Mac app: ${download}`,
    '2. Open Mockup Studio → License (left panel).',
    '3. Paste the key above and click Activate.',
    '',
    reissue
      ? 'Activate this new key on your Mac. Older emailed keys for this order are replaced in our records (offline apps may still accept a previously activated key until you remove it).'
      : 'Keep this email — the key unlocks Pro features offline on your Mac.',
    '',
    `Pricing & help: ${site}/pricing`,
    `Terms: ${site}/terms`,
    opts.orderId ? `Order reference: ${opts.orderId}` : '',
    '',
    '— Mockup Studio',
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <p>${intro}</p>
    <p>Your license key:</p>
    <p style="font-family:ui-monospace,Menlo,monospace;font-size:14px;padding:12px 14px;background:#111;color:#e8ecef;border-radius:8px;word-break:break-all;">
      ${opts.key}
    </p>
    <p><strong>Install &amp; activate</strong></p>
    <ol>
      <li>Download the Mac app: <a href="${download}">${download}</a></li>
      <li>Open Mockup Studio → <strong>License</strong> (left panel).</li>
      <li>Paste the key and click <strong>Activate</strong>.</li>
    </ol>
    <p>
      <a href="${site}/pricing">Pricing</a> ·
      <a href="${site}/terms">Terms</a>
      ${opts.orderId ? ` · Order: ${opts.orderId}` : ''}
    </p>
    <p style="color:#666;font-size:13px;">${
      reissue
        ? 'Activate this new key in the app. Remove any old license first if you are switching machines.'
        : 'Keep this email — the key unlocks Pro features offline on your Mac.'
    }</p>
  `.trim();

  return { subject, text, html };
}

/**
 * @param {{ to: string, subject: string, text: string, html: string }} message
 */
async function sendRawEmail(message) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.LICENSE_EMAIL_FROM?.trim() || 'Mockup Studio <onboarding@resend.dev>';

  if (!apiKey) {
    console.log('\n——— LICENSE EMAIL (dry-run — set RESEND_API_KEY to send) ———');
    console.log('To:', message.to);
    console.log('From:', from);
    console.log('Subject:', message.subject);
    console.log(message.text);
    console.log('——— end dry-run ———\n');
    return { ok: true, dryRun: true };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: typeof body?.message === 'string' ? body.message : `Resend HTTP ${res.status}`,
      };
    }
    return { ok: true, id: body.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * @param {{ email: string, tier: string, key: string, orderId?: string, reason?: 'purchase' | 'reissue' }} opts
 * @returns {Promise<{ ok: true, dryRun?: boolean, id?: string } | { ok: false, error: string }>}
 */
export async function sendLicenseEmail(opts) {
  const { subject, text, html } = buildConfirmationEmail(opts);
  return sendRawEmail({ to: opts.email, subject, text, html });
}

/**
 * @param {{ email: string, code: string, orderId?: string }} opts
 */
export async function sendRecoverCodeEmail(opts) {
  const site = siteUrl();
  const subject = 'Your Mockup Studio recovery code';
  const text = [
    'Use this code to reissue your Mockup Studio license key:',
    '',
    opts.code,
    '',
    'It expires in 15 minutes. If you did not request this, you can ignore this email.',
    opts.orderId ? `Order reference: ${opts.orderId}` : '',
    '',
    `Recover page: ${site}/recover`,
    '— Mockup Studio',
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <p>Use this code to reissue your Mockup Studio license key:</p>
    <p style="font-family:ui-monospace,Menlo,monospace;font-size:28px;letter-spacing:0.2em;padding:12px 14px;background:#111;color:#e8ecef;border-radius:8px;display:inline-block;">
      ${opts.code}
    </p>
    <p style="color:#666;font-size:13px;">Expires in 15 minutes. If you did not request this, ignore this email.</p>
    <p><a href="${site}/recover">Open recover page</a>${
      opts.orderId ? ` · Order: ${opts.orderId}` : ''
    }</p>
  `.trim();

  return sendRawEmail({ to: opts.email, subject, text, html });
}
