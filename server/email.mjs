/**
 * Confirmation email via Resend (https://resend.com).
 * If RESEND_API_KEY is unset, logs the message (dry-run) so local testing works.
 */
import { planLabel } from '../scripts/lib/sign-license.mjs';

function siteUrl() {
  return (process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://mokstudio.io').replace(
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

/**
 * Forward product feedback / contact form to the inbox.
 * @param {{
 *   to?: string,
 *   replyTo?: string,
 *   name?: string,
 *   topic: string,
 *   intent?: string,
 *   message: string,
 *   appVersion?: string,
 *   platform?: string,
 *   userAgent?: string,
 * }} opts
 */
export async function sendFeedbackEmail(opts) {
  const to = (
    opts.to
    || process.env.FEEDBACK_INBOX?.trim()
    || process.env.VITE_SALES_EMAIL?.trim()
    || 'hello@jppferreira.com'
  );
  const intent = opts.intent === 'contact' ? 'contact' : 'feedback';
  const topic = String(opts.topic || 'Other').trim() || 'Other';
  const name = String(opts.name || '').trim() || 'Mockup Studio user';
  const replyTo = String(opts.replyTo || '').trim();
  const subject = `Mockup Studio ${intent} — ${topic}${replyTo ? ` · ${replyTo}` : ''}`;
  const text = [
    `Topic: ${topic}`,
    `Intent: ${intent}`,
    `From: ${name}`,
    replyTo ? `Reply-to: ${replyTo}` : 'Reply-to: (not provided)',
    opts.appVersion ? `App: Mockup Studio ${opts.appVersion}` : null,
    opts.platform ? `Platform: ${opts.platform}` : null,
    opts.userAgent ? `User-Agent: ${opts.userAgent}` : null,
    '',
    String(opts.message || '').trim(),
  ]
    .filter((line) => line != null)
    .join('\n');

  const html = `
    <p><strong>Topic:</strong> ${escapeHtml(topic)} · <strong>Intent:</strong> ${escapeHtml(intent)}</p>
    <p><strong>From:</strong> ${escapeHtml(name)}${
      replyTo ? ` &lt;${escapeHtml(replyTo)}&gt;` : ''
    }</p>
    ${opts.appVersion ? `<p><strong>App:</strong> Mockup Studio ${escapeHtml(opts.appVersion)}</p>` : ''}
    ${opts.platform ? `<p><strong>Platform:</strong> ${escapeHtml(opts.platform)}</p>` : ''}
    <pre style="white-space:pre-wrap;font-family:ui-sans-serif,system-ui,sans-serif;background:#111;color:#e8ecef;padding:14px;border-radius:8px;">${escapeHtml(String(opts.message || '').trim())}</pre>
  `.trim();

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.LICENSE_EMAIL_FROM?.trim() || 'Mockup Studio <onboarding@resend.dev>';

  if (!apiKey) {
    console.log('\n——— FEEDBACK EMAIL (dry-run — set RESEND_API_KEY to send) ———');
    console.log('To:', to);
    console.log('From:', from);
    if (replyTo) console.log('Reply-To:', replyTo);
    console.log('Subject:', subject);
    console.log(text);
    console.log('——— end dry-run ———\n');
    return { ok: true, dryRun: true };
  }

  try {
    /** @type {Record<string, unknown>} */
    const payload = {
      from,
      to: [to],
      subject,
      text,
      html,
    };
    if (replyTo) payload.reply_to = replyTo;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
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

/** @param {string} value */
function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
