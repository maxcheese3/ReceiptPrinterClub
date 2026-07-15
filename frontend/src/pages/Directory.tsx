import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrinters } from '../hooks/usePrinters';
import { printerStatusText } from '../components/PrinterChecklist';
import type { Printer, PublicStats } from '../types/api';

export default function Directory() {
  const { printers: rawPrinters } = usePrinters();
  const sorted = [...rawPrinters].sort((a, b) => a.name.localeCompare(b.name));
  const onlinePrinters = sorted.filter((p) => printerStatusText(p).online);
  const offlinePrinters = sorted.filter((p) => !printerStatusText(p).online);
  const navigate = useNavigate();
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/printers/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setStats(d as PublicStats); })
      .catch(() => { /* stats are non-essential — silently skip if unavailable */ });
    return () => { cancelled = true; };
  }, []);

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleCardClick(id: string) {
    if (multiSelect) {
      toggleSelect(id);
    } else {
      navigate(`/send-message?to=${id}`);
    }
  }

  function handleSendToSelected() {
    if (selectedIds.length === 0) return;
    navigate(`/send-message?to=${selectedIds.join(',')}`);
  }

  function handleCancelMultiSelect() {
    setMultiSelect(false);
    setSelectedIds([]);
  }

  function handleToggleMultiSelect() {
    setMultiSelect(true);
    setSelectedIds([]);
  }

  function renderCard(printer: Printer) {
    const isSelected = selectedIds.includes(printer.id);
    const { online } = printerStatusText(printer);
    return (
      <div
        key={printer.id}
        className={`directory-card${isSelected ? ' selected' : ''}`}
        onClick={() => handleCardClick(printer.id)}
        role="button"
        tabIndex={0}
        aria-pressed={multiSelect ? isSelected : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleCardClick(printer.id);
          }
        }}
      >
        <span className={`directory-card-dot${online ? ' online' : ' offline'}`} aria-hidden="true" />
        {multiSelect && (
          <div className="directory-card-checkbox">
            <span className={`directory-checkbox${isSelected ? ' checked' : ''}`} aria-hidden="true" />
          </div>
        )}
        <div className="directory-card-content">
          <div className="directory-card-header">
            <span className="directory-card-name">{printer.name}</span>
          </div>
          <div className="directory-card-meta">
            {printer.description && (
              <span className="directory-meta-item">{printer.description}</span>
            )}
            {printer.location && (
              <span className="directory-meta-item directory-meta-location">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                  style={{ verticalAlign: '-1px', flexShrink: 0 }}
                >
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
                {' '}{printer.location}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-card">
      <div className="panel-header">
        <h1>Printer Directory</h1>
      </div>

      <div className="directory-toolbar">
        <span className="directory-count">
          {sorted.length === 0
            ? 'No printers registered'
            : `${sorted.length} printer${sorted.length === 1 ? '' : 's'}`}
          {stats && (
            <span className="directory-stats">
              <span className="directory-stat-sep" aria-hidden="true">·</span>
              <span className="directory-stat">
                <strong>{stats.delivered.toLocaleString()}</strong> delivered
              </span>
              <span className="directory-stat-sep" aria-hidden="true">·</span>
              <span className="directory-stat">
                <strong>{stats.this_week.toLocaleString()}</strong> this week
              </span>
              <span className="directory-stat-sep" aria-hidden="true">·</span>
              <span className="directory-stat">
                <strong>{stats.today.toLocaleString()}</strong> today
              </span>
            </span>
          )}
        </span>
        {!multiSelect ? (
          <button
            className="btn btn-outline"
            onClick={handleToggleMultiSelect}
            disabled={sorted.length === 0}
          >
            Select Multiple
          </button>
        ) : (
          <button className="btn btn-outline" onClick={handleCancelMultiSelect}>
            Cancel
          </button>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="directory-empty">No printers have been registered yet.</p>
      ) : (
        <div className="directory-groups">
          {onlinePrinters.length > 0 && (
            <div className="directory-group">
              <h2 className="directory-group-label">Online</h2>
              <div className="directory-grid">
                {onlinePrinters.map(renderCard)}
              </div>
            </div>
          )}
          {offlinePrinters.length > 0 && (
            <div className="directory-group">
              <h2 className="directory-group-label">Offline</h2>
              <div className="directory-grid">
                {offlinePrinters.map(renderCard)}
              </div>
            </div>
          )}
        </div>
      )}

      {multiSelect && selectedIds.length > 0 && (
        <div className="directory-action-bar">
          <span className="directory-action-label">
            {selectedIds.length} printer{selectedIds.length === 1 ? '' : 's'} selected
          </span>
          <button className="btn btn-primary" onClick={handleSendToSelected}>
            Send to {selectedIds.length === 1 ? 'Printer' : `${selectedIds.length} Printers`}
          </button>
        </div>
      )}
    </div>
  );
}
