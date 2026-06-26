import { useState, useRef, useEffect } from 'react';
import type { Printer } from '../types/api';
import { printerStatusText } from './PrinterChecklist';

interface PrinterMultiSelectProps {
  printers: Printer[];
  printerMap: Record<string, Printer>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export default function PrinterMultiSelect({
  printers,
  printerMap,
  selectedIds,
  onChange,
}: PrinterMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  function toggle(id: string) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    onChange(next);
  }

  function remove(id: string) {
    onChange(selectedIds.filter((x) => x !== id));
  }

  const filtered = printers.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="printer-multiselect" ref={wrapperRef}>
      <div
        className={`printer-multiselect-control${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        role="button"
        aria-expanded={open}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}
      >
        <div className="printer-pills-row">
          {selectedIds.length === 0 && (
            <span className="printer-multiselect-placeholder">Select printer(s)…</span>
          )}
          {selectedIds.map((id) => {
            const p = printerMap[id];
            const name = p?.name ?? id;
            const { online } = p ? printerStatusText(p) : { online: false };
            return (
              <span key={id} className="printer-pill">
                <span className="printer-pill-status">{online ? '🟢' : '⚫'}</span>
                {name}
                <button
                  type="button"
                  className="printer-pill-remove"
                  aria-label={`Remove ${name}`}
                  onClick={(e) => { e.stopPropagation(); remove(id); }}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
        <svg className="printer-multiselect-chevron" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {open && (
        <div className="printer-dropdown">
          <input
            ref={searchRef}
            type="text"
            className="printer-dropdown-search"
            placeholder="Search printers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
          <div className="printer-dropdown-list">
            {filtered.length === 0 && (
              <div className="printer-dropdown-empty">No printers found</div>
            )}
            {filtered.map((p) => {
              const { online } = printerMap[p.id]
                ? printerStatusText(printerMap[p.id])
                : { online: false };
              const checked = selectedIds.includes(p.id);
              return (
                <label key={p.id} className={`printer-dropdown-item${checked ? ' checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(p.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="printer-dropdown-name">{p.name}</span>
                  {p.description && (
                    <span className="printer-dropdown-desc">{p.description}</span>
                  )}
                  <span className="printer-dropdown-status">{online ? '🟢' : '⚫'}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
