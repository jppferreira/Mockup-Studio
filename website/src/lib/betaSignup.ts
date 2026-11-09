export type BetaSignupResult =
  | { ok: true; already: boolean }
  | { ok: false; error: string };

function supabaseConfig(): { url: string; key: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '');
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

export function isBetaSignupConfigured(): boolean {
  return supabaseConfig() !== null;
}

export async function submitBetaSignup(
  email: string,
  source: string,
  consent: boolean,
): Promise<BetaSignupResult> {
  const config = supabaseConfig();
  if (!config) {
    return { ok: false, error: 'Beta signup isn’t configured yet.' };
  }
  if (!consent) {
    return { ok: false, error: 'Please agree before joining the beta.' };
  }

  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }

  let response: Response;
  try {
    response = await fetch(`${config.url}/rest/v1/mokstudio_beta_signups`, {
      method: 'POST',
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ email: trimmed, source, consent: true }),
    });
  } catch {
    return { ok: false, error: 'Couldn’t reach the signup service. Try again in a moment.' };
  }

  if (response.ok) return { ok: true, already: false };

  if (response.status === 409) return { ok: true, already: true };

  const body = await response.json().catch(() => null) as { code?: string; message?: string } | null;
  if (body?.code === '23505') return { ok: true, already: true };

  return { ok: false, error: 'Couldn’t join the beta just now. Try again in a moment.' };
}
