export const FEEDBACK_EMAIL = 'hello@jppferreira.com';
const DEFAULT_INBOX = FEEDBACK_EMAIL;
const SEND_TIMEOUT_MS = 10_000;
/** FormSubmit has been unreliable — keep this short so mailto can take over. */
const FORMSUBMIT_TIMEOUT_MS = 2_500;

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * Only use a fulfill API URL when it can actually reach a server from this page.
 * Blocks baked-in `http://127.0.0.1:8787` on the public GitHub Pages site.
 */
export function resolveFulfillApiUrl(candidate?: string | null): string | null {
  const raw = candidate?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const pageHost = typeof window !== 'undefined' ? window.location.hostname : '';
  if (isLoopbackHost(url.hostname) && pageHost && !isLoopbackHost(pageHost)) {
    return null;
  }
  return raw.replace(/\/$/, '');
}

export type FeedbackChannel = 'api' | 'formsubmit' | 'mailto';

export type FeedbackSubmitResult =
  | { ok: true; channel: FeedbackChannel }
  | { ok: false; error: string };

export interface FeedbackSubmitPayload {
  message: string;
  topic: string;
  email?: string;
  name?: string;
  intent?: 'feedback' | 'contact';
  appVersion?: string;
  platform?: string;
  userAgent?: string;
  /** Prefer VITE_FULFILL_API_URL; falls back to FormSubmit then mailto. */
  fulfillApiUrl?: string | null;
  inboxEmail?: string;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = SEND_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function mailtoHref(payload: FeedbackSubmitPayload, inbox: string): string {
  const kind = payload.intent === 'contact' ? 'contact' : 'feedback';
  const subject = encodeURIComponent(`Mockup Studio ${kind} — ${payload.topic}`);
  const body = encodeURIComponent(
    [
      `Topic: ${payload.topic}`,
      payload.name ? `Name: ${payload.name}` : null,
      payload.email ? `Reply-to: ${payload.email}` : 'Reply-to: (not provided)',
      payload.appVersion ? `App: Mockup Studio ${payload.appVersion}` : null,
      payload.platform ? `Platform: ${payload.platform}` : null,
      '',
      payload.message,
    ]
      .filter(Boolean)
      .join('\n'),
  );
  return `mailto:${inbox}?subject=${subject}&body=${body}`;
}

async function tryFulfillApi(
  payload: FeedbackSubmitPayload,
  base: string,
): Promise<boolean> {
  const res = await fetchWithTimeout(`${base.replace(/\/$/, '')}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      name: payload.name || 'Mockup Studio user',
      email: payload.email || undefined,
      message: payload.message,
      topic: payload.topic,
      intent: payload.intent || 'feedback',
      appVersion: payload.appVersion,
      platform: payload.platform,
      userAgent: payload.userAgent,
      _gotcha: '',
    }),
  });
  if (!res.ok) return false;
  const data = await res.json().catch(() => ({}));
  return data?.ok !== false;
}

async function tryFormSubmit(payload: FeedbackSubmitPayload, inbox: string): Promise<boolean> {
  const res = await fetchWithTimeout(
    `https://formsubmit.co/ajax/${inbox}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        name: payload.name || payload.email || 'Mockup Studio user',
        email: payload.email || 'noreply@mockupstudio.app',
        message: payload.message,
        topic: payload.topic,
        intent: payload.intent || 'feedback',
        appVersion: payload.appVersion,
        platform: payload.platform,
        userAgent: payload.userAgent,
        _subject: `Mockup Studio ${payload.intent === 'contact' ? 'contact' : 'feedback'} — ${payload.topic}`,
        _template: 'table',
        _captcha: 'false',
        ...(payload.email ? { _replyto: payload.email } : {}),
      }),
    },
    FORMSUBMIT_TIMEOUT_MS,
  );
  if (!res.ok) return false;
  const data = await res.json().catch(() => ({}));
  if (data && data.success === false) return false;
  return true;
}

/**
 * Browser-safe feedback send: fulfill API → FormSubmit → mailto href (caller opens it).
 */
export async function submitFeedbackBrowser(
  payload: FeedbackSubmitPayload,
  openMailto: (href: string) => void | Promise<void>,
): Promise<FeedbackSubmitResult> {
  const message = payload.message.trim();
  if (!message) return { ok: false, error: 'Please write a short note.' };
  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email.trim())) {
    return { ok: false, error: 'That email doesn’t look valid.' };
  }

  const normalized: FeedbackSubmitPayload = {
    ...payload,
    message,
    email: payload.email?.trim() || undefined,
    name: payload.name?.trim() || undefined,
  };
  const inbox = payload.inboxEmail || DEFAULT_INBOX;
  const fulfill = resolveFulfillApiUrl(payload.fulfillApiUrl);

  if (fulfill) {
    try {
      if (await tryFulfillApi(normalized, fulfill)) return { ok: true, channel: 'api' };
    } catch {
      // fall through
    }
  }

  try {
    if (await tryFormSubmit(normalized, inbox)) return { ok: true, channel: 'formsubmit' };
  } catch {
    // fall through — FormSubmit is often unreachable
  }

  try {
    await openMailto(mailtoHref(normalized, inbox));
    return { ok: true, channel: 'mailto' };
  } catch {
    return {
      ok: false,
      error: `Couldn’t send right now. Email ${inbox} or try again in a moment.`,
    };
  }
}
