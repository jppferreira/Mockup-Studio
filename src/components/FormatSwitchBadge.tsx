import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export type FormatSwitchOption = {
  id: string;
  label: string;
  hint: string;
  group?: string;
};

interface Props {
  label: string;
  hint: string;
  activeId: string;
  options: FormatSwitchOption[];
  onSelect: (id: string) => void;
}

export default function FormatSwitchBadge({ label, hint, activeId, options, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  let lastGroup = '';

  return (
    <div className={`crop-focus-badge ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="crop-focus-badge-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch format"
        onClick={() => setOpen((value) => !value)}
      >
        <strong>{label}</strong>
        <span>{hint}</span>
        <ChevronDown size={12} className="crop-focus-badge-chevron" aria-hidden />
      </button>
      {open && (
        <div className="crop-focus-badge-menu" role="listbox" aria-label="Formats">
          {options.map((option) => {
            const showGroup = Boolean(option.group && option.group !== lastGroup);
            if (option.group) lastGroup = option.group;
            const selected = option.id === activeId;
            return (
              <div key={option.id}>
                {showGroup ? <div className="crop-focus-badge-group">{option.group}</div> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`crop-focus-badge-option ${selected ? 'is-selected' : ''}`}
                  onClick={() => {
                    onSelect(option.id);
                    setOpen(false);
                  }}
                >
                  <span>
                    <strong>{option.label}</strong>
                    <em>{option.hint}</em>
                  </span>
                  {selected ? <Check size={12} aria-hidden /> : null}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
