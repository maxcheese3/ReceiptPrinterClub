import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrinters } from '../hooks/usePrinters';
import { printerStatusText } from '../components/PrinterChecklist';

export default function Directory() {
  const { printers: rawPrinters } = usePrinters();
  const printers = [...rawPrinters].sort((a, b) => a.name.localeCompare(b.name));
  const navigate = useNavigate();
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

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

  return (
    <div className="page-card">
      <div className="panel-header">
        <h1>Printer Directory</h1>
      </div>

      <div className="directory-toolbar">
        <span className="directory-count">
          {printers.length === 0
            ? 'No printers registered'
            : `${printers.length} printer${printers.length === 1 ? '' : 's'}`}
        </span>
        {!multiSelect ? (
          <button
            className="btn btn-outline"
            onClick={handleToggleMultiSelect}
            disabled={printers.length === 0}
          >
            Select Multiple
          </button>
        ) : (
          <button className="btn btn-outline" onClick={handleCancelMultiSelect}>
            Cancel
          </button>
        )}
      </div>

      {printers.length === 0 ? (
        <p className="directory-empty">No printers have been registered yet.</p>
      ) : (
        <div className="directory-grid">
          {printers.map((printer) => {
            const { online, label } = printerStatusText(printer);
            const isSelected = selectedIds.includes(printer.id);
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
                {multiSelect && (
                  <div className="directory-card-checkbox">
                    <span className={`directory-checkbox${isSelected ? ' checked' : ''}`} aria-hidden="true" />
                  </div>
                )}
                <div className="directory-card-content">
                  <div className="directory-card-header">
                    <span className="directory-card-name">{printer.name}</span>
                    <span
                      className={`directory-status-badge${online ? ' online' : ' offline'}`}
                      title={label}
                    >
                      {online ? '🟢' : '⚫'} {online ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <div className="directory-card-meta">
                    {printer.location && (
                      <span className="directory-meta-item directory-meta-location">
                        📍 {printer.location}
                      </span>
                    )}
                    {printer.description && (
                      <span className="directory-meta-item">{printer.description}</span>
                    )}
                    <span className="directory-meta-item directory-meta-cols">
                      {printer.columns}-col · {printer.font_size}pt
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
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
