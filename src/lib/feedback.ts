import {
  FEEDBACK_EMAIL,
  submitFeedbackBrowser,
  type FeedbackSubmitResult,
} from '../../shared/feedbackSubmit';

export type FeedbackSendResult = FeedbackSubmitResult;

export interface FeedbackPayload {
  message: string;
  topic: string;
  email?: string;
  name?: string;
  intent?: 'feedback' | 'contact';
  appVersion?: string;
  platform?: string;
  userAgent?: string;
}

function fulfillBase(): string | null {
  const fromEnv = (import.meta.env.VITE_FULFILL_API_URL as string | undefined)?.trim();
  if (!fromEnv) return null;
  return fromEnv.replace(/\/$/, '');
}

async function openMailtoHref(href: string): Promise<void> {
  if (window.mockupDesktop?.openExternal) {
    const result = await window.mockupDesktop.openExternal(href);
    if (!result?.ok) throw new Error('openExternal failed');
    return;
  }
  const link = document.createElement('a');
  link.href = href;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Send feedback: prefer fulfill API (Resend), then FormSubmit, then mailto.
 */
export async function submitFeedback(payload: FeedbackPayload): Promise<FeedbackSendResult> {
  return submitFeedbackBrowser(
    {
      ...payload,
      fulfillApiUrl: fulfillBase(),
      inboxEmail: FEEDBACK_EMAIL,
      platform: payload.platform || navigator.platform || 'unknown',
      userAgent: payload.userAgent || navigator.userAgent,
    },
    openMailtoHref,
  );
}

export { FEEDBACK_EMAIL };
