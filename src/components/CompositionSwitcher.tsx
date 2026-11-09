import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Copy, Plus, Trash2 } from 'lucide-react';
import TemplatePreview from './TemplatePreview';
import type { CompositionTemplate } from '../lib/templates';

type CompositionSwitcherProps = {
  templates: CompositionTemplate[];
  activeId: string | null;
  onApply: (template: CompositionTemplate) => void;
  /** Workspace toolset — Dev marks these as editable shipped layouts. */
  mode?: 'developer' | 'user';
  /** Mint a blank shipped composition from the default sidepanel. */
  onCreate?: () => void;
  /** Mint a blank shipped device layout from the default sidepanel. */
  onCreateLayout?: () => void;
  onDuplicate?: (template: CompositionTemplate) => void;
  onDelete?: (template: CompositionTemplate) => void;
};

type MenuBox = {
  top: number | 'auto';
  bottom: number | 'auto';
  left: number;
  width: number;
  maxHeight: number;
};

function measureMenu(anchor: HTMLElement): MenuBox {
  const rect = anchor.getBoundingClientRect();
  const gap = 6;
  const margin = 12;
  const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - margin);
  const spaceAbove = Math.max(0, rect.top - gap - margin);
  const openBelow = spaceBelow >= 220 || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(160, Math.min(360, openBelow ? spaceBelow : spaceAbove));
  if (openBelow) {
    return { top: rect.bottom + gap, bottom: 'auto', left: rect.left, width: rect.width, maxHeight };
  }
  return {
    top: 'auto',
    bottom: window.innerHeight - rect.top + gap,
    left: rect.left,
    width: rect.width,
    maxHeight,
  };
}

export default function CompositionSwitcher({
  templates,
  activeId,
  onApply,
  mode = 'user',
  onCreate,
  onCreateLayout,
  onDuplicate,
  onDelete,
}: CompositionSwitcherProps) {
  const isDev = mode === 'developer';
  const canCreate = Boolean(onCreate || onCreateLayout);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<MenuBox | null>(null);
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const shouldFocus = useRef(false);
  const typeBuffer = useRef('');
  const typeTimer = useRef(0);
  const listId = useId();
  const labelId = `${listId}-label`;

  const selectedIndex = templates.findIndex((template) => template.id === activeId);
  const selected = selectedIndex >= 0 ? templates[selectedIndex] : null;

  const place = () => {
    const anchor = triggerRef.current;
    if (!anchor) return;
    setBox(measureMenu(anchor));
  };

  const openMenu = (index = selectedIndex >= 0 ? selectedIndex : 0) => {
    shouldFocus.current = true;
    setCursor(index);
    place();
    setOpen(true);
  };

  const closeMenu = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const choose = (template: CompositionTemplate) => {
    onApply(template);
    closeMenu(true);
  };

  const moveCursor = (index: number) => {
    if (!templates.length) return;
    const next = (index + templates.length) % templates.length;
    shouldFocus.current = true;
    setCursor(next);
  };

  const stopRowAction = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.composition-switch-menu')) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeMenu(true);
    };
    const onReflow = () => place();
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector('[data-cursor="true"]');
    if (!(row instanceof HTMLElement)) return;
    row.scrollIntoView({ block: 'nearest' });
    if (shouldFocus.current) {
      shouldFocus.current = false;
      row.focus();
    }
  }, [open, cursor]);

  const jumpToLabel = (key: string) => {
    if (key.length !== 1 || !templates.length) return false;
    typeBuffer.current = `${typeBuffer.current}${key.toLowerCase()}`;
    window.clearTimeout(typeTimer.current);
    typeTimer.current = window.setTimeout(() => {
      typeBuffer.current = '';
    }, 500);
    const query = typeBuffer.current;
    const start = query.length === 1 ? cursor + 1 : cursor;
    for (let offset = 0; offset < templates.length; offset += 1) {
      const index = (start + offset) % templates.length;
      if (templates[index].label.toLowerCase().startsWith(query)) {
        moveCursor(index);
        return true;
      }
    }
    return false;
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveCursor(cursor + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveCursor(cursor - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveCursor(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveCursor(templates.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const template = templates[cursor];
      if (template) choose(template);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (event.key === 'Tab') {
      setOpen(false);
    } else if (!event.altKey && !event.metaKey && !event.ctrlKey && jumpToLabel(event.key)) {
      event.preventDefault();
    }
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const index = event.key === 'ArrowUp'
        ? (selectedIndex >= 0 ? selectedIndex : templates.length) - 1
        : (selectedIndex >= 0 ? selectedIndex : 0);
      if (!open) openMenu(index);
      else moveCursor(event.key === 'ArrowUp' ? cursor - 1 : cursor + 1);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && !open) {
      event.preventDefault();
      openMenu();
    }
  };

  const valueLabel = selected
    ? `${selected.label}. ${selected.description}`
    : 'Choose a composition. Restages the shot. Your devices stay.';

  return (
    <section className={`composition-switch is-compact ${open ? 'is-open' : ''}${isDev ? ' is-dev-toolset' : ''}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="composition-switch-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={labelId}
        aria-label={`Compositions. ${valueLabel}`}
        disabled={!templates.length}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="composition-switch-label" id={labelId}>Composition</span>
        {selected ? (
          <>
            <span className="composition-switch-thumb" aria-hidden>
              <TemplatePreview layout={selected.preview} />
            </span>
            <span className="composition-switch-copy">
              <strong>{selected.label}</strong>
            </span>
          </>
        ) : (
          <span className="composition-switch-copy">
            <strong>Choose…</strong>
          </span>
        )}
        <em className="composition-switch-count">{templates.length}</em>
        <ChevronDown size={14} className="composition-switch-chevron" aria-hidden />
      </button>
      {open && box && createPortal(
        <div
          className="composition-switch-menu"
          style={{
            top: box.top,
            bottom: box.bottom,
            left: box.left,
            width: box.width,
            maxHeight: box.maxHeight,
          }}
        >
          <p className="composition-switch-hint">
            {isDev
              ? 'Dev mode — apply, duplicate, or delete shipped layouts.'
              : 'Restages the shot. Duplicate copies into Yours.'}
          </p>
          {canCreate && (
            <div className="composition-switch-create-row" role="group" aria-label="Create library entry">
              {onCreateLayout && (
                <button
                  type="button"
                  className="composition-switch-create"
                  title="Create a new device layout"
                  aria-label="Create a new device layout"
                  onClick={() => {
                    closeMenu(false);
                    onCreateLayout();
                  }}
                >
                  <Plus size={13} strokeWidth={2.2} aria-hidden />
                  New layout
                </button>
              )}
              {onCreate && (
                <button
                  type="button"
                  className="composition-switch-create"
                  title="Create a new composition"
                  aria-label="Create a new composition"
                  onClick={() => {
                    closeMenu(false);
                    onCreate();
                  }}
                >
                  <Plus size={13} strokeWidth={2.2} aria-hidden />
                  New composition
                </button>
              )}
            </div>
          )}
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-labelledby={labelId}
            tabIndex={-1}
            onKeyDown={onListKeyDown}
          >
          {templates.map((template, index) => {
            const active = template.id === activeId;
            const current = index === cursor;
            return (
              <div
                key={template.id}
                className={`composition-switch-row-wrap ${active ? 'is-active' : ''} ${current ? 'is-cursor' : ''}`}
              >
                <button
                  type="button"
                  role="option"
                  id={`${listId}-option-${index}`}
                  aria-selected={active}
                  data-cursor={current ? 'true' : 'false'}
                  tabIndex={current ? 0 : -1}
                  className="composition-switch-row"
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => choose(template)}
                >
                  <span className="composition-switch-thumb" aria-hidden>
                    <TemplatePreview layout={template.preview} />
                  </span>
                  <span className="composition-switch-copy">
                    <strong>{template.label}</strong>
                    <span>{isDev ? 'Dev editable · ships to User' : template.description}</span>
                  </span>
                  {active ? <Check size={14} className="composition-switch-check" aria-hidden /> : null}
                </button>
                <div className="composition-switch-actions">
                  {onDuplicate && (
                    <button
                      type="button"
                      className="composition-switch-action"
                      title={isDev ? `Duplicate “${template.label}” into shipped layouts` : `Duplicate “${template.label}” into Yours`}
                      aria-label={`Duplicate ${template.label}`}
                      onMouseDown={stopRowAction}
                      onClick={(event) => {
                        stopRowAction(event);
                        onDuplicate(template);
                      }}
                    >
                      <Copy size={12} />
                    </button>
                  )}
                  {onDelete && isDev && (
                    <button
                      type="button"
                      className="composition-switch-action is-danger"
                      title={`Delete shipped “${template.label}”`}
                      aria-label={`Delete ${template.label}`}
                      onMouseDown={stopRowAction}
                      onClick={(event) => {
                        stopRowAction(event);
                        onDelete(template);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
