import { useState, type ReactNode } from 'react';
import type { Direction } from '../types/api';

/**
 * A single message card. Shared by every history view (all, received, sent, the
 * recent panel, and the guest localStorage list) so they can't visually drift
 * apart.
 *
 *   [SENT] to Alice from Damon                  printed
 *   message body…
 *   Reply                                 Nov 13, 10:42
 *
 * The label is built with sentLabel() / receivedLabel() so every view words it
 * the same way.
 */

export function formatTime(isoStr: string): string {
  // Server timestamps are UTC but stored without a zone marker, so append 'Z'.
  // Guest history is written with a real ISO string that already has one —
  // don't double-append or the date goes invalid.
  const iso = /[Zz]|[+-]\d{2}:?\d{2}$/.test(isoStr) ? isoStr : isoStr + 'Z';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function statusClass(status: string): string {
  return ({
    printed:  'status-printed',
    failed:   'status-failed',
    pending:  'status-pending',
    printing: 'status-printing',
    sent:     'status-printed',
  } as Record<string, string>)[status] ?? '';
}

/** "to <recipient> from <the FROM I used>". The from part is left off when blank. */
export function sentLabel(to: string | null | undefined, from?: string | null): ReactNode {
  return (
    <>
      to <strong>{to ?? '(deleted printer)'}</strong>
      {from?.trim() && <> from <strong>{from}</strong></>}
    </>
  );
}

/** "from <their FROM> (<their printer>)". The printer name only appears when the
 *  sender was logged in, and only if it adds something to what they typed. */
export function receivedLabel(senderName?: string | null, senderPrinterName?: string | null): ReactNode {
  const name = senderName?.trim() || senderPrinterName || '(unknown)';
  const showPrinter = senderPrinterName && senderPrinterName !== name;
  return (
    <>
      from <strong>{name}</strong>
      {showPrinter && <span className="pa-msg-printer"> ({senderPrinterName})</span>}
    </>
  );
}

interface MessageCardProps {
  /** Renders the leading SENT / RECEIVED chip. */
  direction?: Direction;
  /** Built with sentLabel() / receivedLabel(). */
  label: ReactNode;
  status: string;
  createdAt: string;
  body?: string;
  imagePath?: string;
  /** Shown under the card when a send failed. */
  error?: string;
  /** Optional per-card action, e.g. "Remove" in guest history. */
  action?: ReactNode;
  /** Extra chips after the direction chip, e.g. Anonymous. */
  badge?: ReactNode;
  /** When set, a Reply button appears while the card is expanded. */
  onReply?: () => void;
}

export default function MessageCard({
  direction, label, status, createdAt, body, imagePath, error, action, badge, onReply,
}: MessageCardProps) {
  const [expanded, setExpanded] = useState(false);
  const showReply = expanded && onReply;

  return (
    <div
      className={`pa-message-card${expanded ? ' expanded' : ''}`}
      onClick={(e) => {
        const el = e.target as HTMLElement;
        // Don't toggle when interacting with the image or an action button.
        if (el.tagName !== 'IMG' && el.tagName !== 'BUTTON') setExpanded((x) => !x);
      }}
    >
      <span className="pa-msg-from">
        {direction && (
          <span className={`dir-badge ${direction}`}>{direction === 'out' ? 'Sent' : 'Received'}</span>
        )}
        {badge}
        <span className="pa-msg-label">{label}</span>
      </span>
      <span className={`pa-msg-status ${statusClass(status)} status-badge`}>{status}</span>

      {(imagePath || body) && (
        <div className="pa-msg-main">
          {imagePath && (
            <img
              className="pa-msg-img"
              src={`/uploads/${imagePath}`}
              alt="attachment"
              // The upload may have been pruned server-side; hide rather than show a
              // broken-image icon.
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              onClick={() => window.open(`/uploads/${imagePath}`)}
            />
          )}
          {body && <div className={`pa-msg-body${expanded ? ' expanded' : ''}`}>{body}</div>}
        </div>
      )}
      {error && <div className="pa-msg-error">{error}</div>}

      <div className="pa-msg-foot">
        {showReply && (
          <button type="button" className="btn btn-outline btn-sm pa-msg-reply" onClick={onReply}>
            Reply
          </button>
        )}
        {action}
        <span className="pa-msg-time">{formatTime(createdAt)}</span>
      </div>
    </div>
  );
}
