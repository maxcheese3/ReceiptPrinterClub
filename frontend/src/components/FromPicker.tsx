import { useState, useRef, useEffect, type ReactNode } from 'react';
import { getSavedFroms, addSavedFrom, removeSavedFrom, isSavedFrom } from '../lib/savedFroms';

/**
 * The FROM box on the send page: a plain text input you can type straight into,
 * plus a ▾ button that opens your saved names to pick, remove, or save the one
 * you've typed. Focusing the input never opens the list, so typing a one-off
 * name takes no extra clicks.
 */

interface FromPickerProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Extra controls inside the shell, after the ▾ (e.g. the Anonymous toggle). */
  children?: ReactNode;
}

export default function FromPicker({ id, value, onChange, placeholder, children }: FromPickerProps) {
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<string[]>(getSavedFroms);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape. Escape is caught on the document because
  // removing a name also removes the focused × button, leaving focus on <body>.
  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const typed = value.trim();
  const canSave = typed !== '' && !isSavedFrom(names, typed);

  function pick(name: string) {
    onChange(name);
    setOpen(false);
  }

  return (
    <div className="from-picker" ref={wrapperRef}>
      <div className={`from-shell${children ? ' has-toggle' : ''}`}>
        <input
          type="text"
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}
          placeholder={placeholder}
          maxLength={100}
          autoComplete="off"
        />
        <button
          type="button"
          className={`from-picker-toggle${open ? ' open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-label="Saved names"
          aria-expanded={open}
          aria-haspopup="listbox"
          title="Saved names"
        >
          <svg className="printer-multiselect-chevron" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {children}
      </div>

      {open && (
        <div className="printer-dropdown from-dropdown">
          <div className="printer-dropdown-list" role="listbox" aria-label="Saved names">
            {names.length === 0 && (
              <div className="printer-dropdown-empty">No saved names yet. Type one, then save it here.</div>
            )}
            {names.map((name) => {
              const selected = name === typed;
              return (
                <div
                  key={name}
                  role="option"
                  aria-selected={selected}
                  tabIndex={0}
                  className={`printer-dropdown-item from-option${selected ? ' checked' : ''}`}
                  onClick={() => pick(name)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(name); } }}
                >
                  <span className="from-option-check" aria-hidden>{selected ? '✓' : ''}</span>
                  <span className="printer-dropdown-name">{name}</span>
                  <button
                    type="button"
                    className="printer-pill-remove"
                    aria-label={`Forget ${name}`}
                    title="Remove"
                    onClick={(e) => { e.stopPropagation(); setNames(removeSavedFrom(name)); }}
                  >×</button>
                </div>
              );
            })}
          </div>
          {canSave && (
            <button
              type="button"
              className="from-save-btn"
              onClick={() => setNames(addSavedFrom(typed))}
            >
              + Save “{typed}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}
