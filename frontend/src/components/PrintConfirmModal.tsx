import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface PrintResult {
  status: 'success' | 'error';
  printerNames: string[];
  senderName: string;
  errors: string[];
}

interface PrintConfirmModalProps {
  result: PrintResult | null;
  onClose: () => void;
}

export default function PrintConfirmModal({ result, onClose }: PrintConfirmModalProps) {
  useEffect(() => {
    if (!result) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [result, onClose]);

  useEffect(() => {
    if (!result || result.status !== 'success') return;
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [result, onClose]);

  if (!result) return null;

  const printed = result.status === 'success';

  return createPortal(
    <div className="print-confirm-backdrop" onClick={onClose}>
      <div
        className={`print-confirm-modal print-confirm-modal--${result.status}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={printed ? 'Message printed' : 'Print failed'}
      >
        <div className="print-confirm-status-icon">
          {printed ? '✓' : '✗'}
        </div>

        <div className={`print-confirm-status-label${printed ? ' print-confirm-status-label--success' : ' print-confirm-status-label--error'}`}>
          {printed ? 'PRINTED' : 'NOT PRINTED'}
        </div>

        {printed && (
          <p className="print-confirm-success-message">
            {(() => {
              const recipients = result.printerNames.join(' and ');
              const base = `${recipients} has received your message`;
              return result.senderName ? `Thanks ${result.senderName}, ${base}` : base;
            })()}
          </p>
        )}

        {!printed && result.errors.length > 0 && (
          <div className="print-confirm-errors">
            {result.errors.map((err, i) => (
              <p key={i} className="print-confirm-error-line">{err}</p>
            ))}
          </div>
        )}

        {!printed && (
          <button className="btn btn-primary print-confirm-close" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
