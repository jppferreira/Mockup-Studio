import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Bot, Sparkles } from 'lucide-react';
import { PROMPT_SUGGESTIONS } from '../lib/promptAnimate';

export type AgentChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
};

type AgentChatPanelProps = {
  messages: AgentChatMessage[];
  busy: boolean;
  status?: string | null;
  onSend: (text: string) => void;
  onClose?: () => void;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const scope = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** Equalizer voice glyph — four vertical bars matching the provided icon. */
function VoiceModeIcon({ live = false }: { live?: boolean }) {
  return (
    <span className={`agent-voice-icon${live ? ' is-live' : ''}`} aria-hidden>
      <span className="agent-voice-bars">
        <i /><i /><i /><i />
      </span>
    </span>
  );
}

export default function AgentChatPanel({
  messages,
  busy,
  status = null,
  onSend,
  onClose,
}: AgentChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [listening, setListening] = useState(false);
  /** True only after real keyboard typing — never set by speech results. */
  const [typing, setTyping] = useState(false);
  const [voiceSupported] = useState(() => Boolean(getSpeechRecognition()));
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseDraftRef = useRef('');
  const listeningRef = useRef(false);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy, status]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => () => {
    listeningRef.current = false;
    try {
      recognitionRef.current?.abort();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
  }, []);

  const stopListening = () => {
    listeningRef.current = false;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      try {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.stop();
      } catch {
        /* ignore */
      }
    }
    setListening(false);
  };

  const startListening = () => {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition || busy || typing || recognitionRef.current) return;

    baseDraftRef.current = draft.trim();
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = typeof navigator !== 'undefined' && navigator.language
      ? navigator.language
      : 'en-US';

    recognition.onresult = (event) => {
      let finalChunk = '';
      let interimChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const piece = result[0]?.transcript ?? '';
        if (result.isFinal) finalChunk += piece;
        else interimChunk += piece;
      }
      // Speech updates the draft only — never flips the control to “send”.
      if (finalChunk) {
        const nextBase = [baseDraftRef.current, finalChunk.trim()].filter(Boolean).join(' ');
        baseDraftRef.current = nextBase;
        setDraft(nextBase);
        return;
      }
      if (interimChunk) {
        setDraft([baseDraftRef.current, interimChunk.trim()].filter(Boolean).join(' '));
      }
    };

    recognition.onerror = (event) => {
      const code = event.error ?? '';
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setVoiceHint('Microphone permission needed');
      } else if (code && code !== 'aborted' && code !== 'no-speech') {
        setVoiceHint('Could not hear that — try again');
      }
      listeningRef.current = false;
      recognitionRef.current = null;
      setListening(false);
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      // Do not auto-restart — voice is tap-to-activate only.
      if (listeningRef.current) {
        listeningRef.current = false;
        setListening(false);
      }
    };

    recognitionRef.current = recognition;
    listeningRef.current = true;
    try {
      recognition.start();
      setListening(true);
      setVoiceHint(null);
    } catch {
      listeningRef.current = false;
      recognitionRef.current = null;
      setListening(false);
      setVoiceHint('Voice input unavailable');
    }
  };

  const submit = (text: string) => {
    const value = text.trim();
    if (!value || busy) return;
    stopListening();
    setDraft('');
    baseDraftRef.current = '';
    setTyping(false);
    setVoiceHint(null);
    onSend(value);
  };

  /** Keyboard only — speech must not call this. */
  const onUserType = (value: string) => {
    if (listening) stopListening();
    setDraft(value);
    if (value.trim()) {
      setTyping(true);
    } else {
      setTyping(false);
      baseDraftRef.current = '';
    }
    setVoiceHint(null);
  };

  const onVoiceButtonClick = () => {
    if (busy) return;
    if (listening) {
      const captured = draft.trim();
      stopListening();
      if (captured) {
        submit(captured);
      }
      return;
    }
    setTyping(false);
    setVoiceHint(null);
    startListening();
  };

  // Stable control: send only while the user is typing; otherwise the voice icon.
  const showSend = typing;

  return (
    <div className="agent-chat-panel" aria-label="Agent chat">
      <div className="agent-chat-head">
        <div className="agent-chat-title">
          <Bot size={15} strokeWidth={1.9} aria-hidden />
          <div>
            <strong>Agent</strong>
            <span>Tap voice to talk — type anytime to send</span>
          </div>
        </div>
        {onClose && (
          <button type="button" className="text-button" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      <div className="agent-chat-thread" ref={listRef} role="log" aria-live="polite">
        {messages.length === 0 && !busy && (
          <div className="agent-chat-empty">
            <Sparkles size={18} strokeWidth={1.8} aria-hidden />
            <p>Tap the voice button to speak, or type a prompt to send.</p>
            <div className="agent-chat-suggestions" role="list">
              {PROMPT_SUGGESTIONS.slice(0, 6).map((chip) => (
                <button
                  key={chip}
                  type="button"
                  role="listitem"
                  className="agent-chat-chip"
                  onClick={() => submit(chip)}
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`agent-chat-bubble is-${message.role}`}
          >
            {message.role !== 'user' && (
              <span className="agent-chat-avatar" aria-hidden>
                <Bot size={12} strokeWidth={2} />
              </span>
            )}
            <p>{message.text}</p>
          </div>
        ))}
        {busy && (
          <div className="agent-chat-bubble is-assistant is-pending">
            <span className="agent-chat-avatar" aria-hidden>
              <Bot size={12} strokeWidth={2} />
            </span>
            <p>{status || 'Building motion…'}</p>
          </div>
        )}
      </div>

      <form
        className={`agent-chat-composer${listening ? ' is-listening' : ''}`}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          submit(draft);
        }}
      >
        <span className="agent-chat-aurora" aria-hidden />
        <span className="agent-chat-aurora agent-chat-aurora-soft" aria-hidden />
        <div className={`agent-chat-field${busy ? ' is-busy' : ''}${listening ? ' is-listening' : ''}`}>
          <textarea
            ref={inputRef}
            value={draft}
            rows={2}
            placeholder={
              busy
                ? 'Working…'
                : listening
                  ? 'Listening…'
                  : voiceSupported
                    ? 'Tap voice or type a prompt…'
                    : 'Ask the agent to animate…'
            }
            aria-label="Agent prompt"
            disabled={busy}
            onChange={(e) => onUserType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(draft);
              }
            }}
          />
          <div className="agent-chat-actions">
            {showSend ? (
              <button
                type="submit"
                className="agent-chat-send"
                disabled={busy || !draft.trim()}
                title="Send"
                aria-label="Send"
              >
                <ArrowUp size={15} strokeWidth={2.2} aria-hidden />
              </button>
            ) : voiceSupported ? (
              <button
                type="button"
                className={`agent-chat-voice${listening ? ' is-live' : ''}`}
                onClick={onVoiceButtonClick}
                disabled={busy}
                title={listening ? 'Stop and send' : 'Talk to agent'}
                aria-label={listening ? 'Stop and send' : 'Talk to agent'}
                aria-pressed={listening}
              >
                <VoiceModeIcon live={listening} />
              </button>
            ) : (
              <button
                type="submit"
                className="agent-chat-send"
                disabled={busy || !draft.trim()}
                title="Send"
                aria-label="Send"
              >
                <ArrowUp size={15} strokeWidth={2.2} aria-hidden />
              </button>
            )}
          </div>
        </div>
        {voiceHint && !showSend && <span className="agent-chat-voice-hint">{voiceHint}</span>}
      </form>
    </div>
  );
}
