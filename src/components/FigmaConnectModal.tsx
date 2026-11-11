import { useEffect, useId, useRef, useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import {
  FIGMA_TOKEN_HELP_URL,
  FIGMA_TOKEN_PRIVACY_NOTICE,
  FIGMA_TOKEN_SETUP_STEPS,
  getFigmaTokenAccountId,
  hasFigmaTokenConsent,
  maskFigmaToken,
  saveFigmaToken,
  setFigmaTokenConsent,
} from '../lib/figma';

interface Props {
  open: boolean;
  onClose: () => void;
  onConnected: (masked: string) => void;
  onNotify: (message: string) => void;
}

export default function FigmaConnectModal({
  open,
  onClose,
  onConnected,
  onNotify,
}: Props) {
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  const openRef = useRef(open);
  const cancelledRef = useRef(false);
  const [tokenDraft, setTokenDraft] = useState('');
  const [consent, setConsent] = useState(() => hasFigmaTokenConsent());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Reset only when the modal opens — do not depend on unstable parent callbacks
  // (inline onClose was clearing the token field on every parent re-render / Confirm).
  useEffect(() => {
    if (!open) return;
    cancelledRef.current = false;
    setTokenDraft('');
    setConsent(hasFigmaTokenConsent());
    setBusy(false);
    setError(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (cancelledRef.current) return;
      // Busy save: mark cancelled so the in-flight confirm does not call onConnected.
      cancelledRef.current = true;
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const requestClose = () => {
    cancelledRef.current = true;
    onClose();
  };

  const confirm = async () => {
    const trimmed = tokenDraft.trim();
    if (!trimmed) {
      setError('Paste your Figma personal access token first.');
      return;
    }
    if (!consent) {
      setError('Accept the privacy notice before connecting.');
      return;
    }
    if (!getFigmaTokenAccountId()) {
      setError('Sign in to your mokstudio account before connecting a Figma token.');
      return;
    }
    cancelledRef.current = false;
    setBusy(true);
    setError(null);
    try {
      setFigmaTokenConsent(true);
      await saveFigmaToken(trimmed);
      if (cancelledRef.current || !openRef.current) return;
      const masked = maskFigmaToken(trimmed);
      onConnected(masked);
      onNotify(`Figma connected · ${masked}`);
      onClose();
    } catch (err) {
      if (cancelledRef.current || !openRef.current) return;
      setError(err instanceof Error ? err.message : 'Could not save Figma token');
    } finally {
      if (openRef.current) setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={busy ? undefined : requestClose}
      role="presentation"
    >
      <div
        className="export-modal figma-connect-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-head">
          <div className="modal-icon"><KeyRound size={20} /></div>
          <button
            type="button"
            className="modal-close"
            onClick={requestClose}
            aria-label="Close"
            disabled={busy}
          >
            <X size={18} />
          </button>
        </div>
        <h2 id={titleId}>Connect Figma token</h2>
        <p>Generate a personal access token, paste it below, and confirm.</p>

        <strong className="figma-connect-guide-title">How to get your token</strong>
        <ol className="figma-connect-steps">
          {FIGMA_TOKEN_SETUP_STEPS.map((step, index) => (
            <li key={step.title}>
              <span className="figma-connect-step-index">{index + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>

        <button
          type="button"
          className="figma-connect-help-link"
          onClick={() => {
            const openExternal = window.mockupDesktop?.openExternal;
            if (openExternal) void openExternal(FIGMA_TOKEN_HELP_URL);
            else window.open(FIGMA_TOKEN_HELP_URL, '_blank', 'noopener,noreferrer');
          }}
        >
          Open Figma’s token help article
        </button>

        <p className="figma-connect-privacy">{FIGMA_TOKEN_PRIVACY_NOTICE}</p>

        <label className="figma-connect-consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => {
              const accepted = event.target.checked;
              setConsent(accepted);
              setFigmaTokenConsent(accepted);
            }}
          />
          <span>
            I understand the token stays on this device, is only sent to Figma’s API for files I choose,
            and I can disconnect to delete it.
          </span>
        </label>

        <label className="field-stack">
          <span>Paste personal access token</span>
          <input
            type="password"
            value={tokenDraft}
            onChange={(event) => setTokenDraft(event.target.value)}
            placeholder="Paste figd_… token here"
            spellCheck={false}
            autoComplete="off"
            autoFocus
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              void confirm();
            }}
          />
        </label>

        {error ? <p className="figma-explore-error" role="alert">{error}</p> : null}

        <div className="export-modal-actions">
          <button type="button" className="button subtle-button" onClick={requestClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="button primary-button"
            disabled={busy || !tokenDraft.trim() || !consent}
            onClick={() => void confirm()}
          >
            {busy ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
