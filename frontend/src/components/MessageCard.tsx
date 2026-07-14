import { useState } from 'react';

/**
 * A single message card. Shared by every history view (received, sent, and the
 * guest localStorage list) so they can't visually drift apart.
 *
 * The primary label is variable: a *received* message is identified by who sent
 * it, while a *sent* message is identified by who it went to. Callers pass
 * `label` accordingly.
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

interface MessageCardProps {
  /** Who the message is from (received view) or to (sent view). */
  label: string;
  status: string;
  createdAt: string;
  body?: string;
  imagePath?: string;
  /** Shown under the card when a send failed. */
  error?: string;
  /** Optional per-card action, e.g. "Remove" in guest history. */
  action?: React.ReactNode;
  /** Optional marker, e.g. the Sent/Received pill in recent activity. */
  badge?: React.ReactNode;
}

export default function MessageCard({
  label, status, createdAt, body, imagePath, error, action, badge,
}: MessageCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`pa-message-card${imagePath ? ' has-image' : ''}`}
      onClick={(e) => {
        const el = e.target as HTMLElement;
        // Don't toggle when interacting with the image or an action button.
        if (el.tagName !== 'IMG' && el.tagName !== 'BUTTON') setExpanded((x) => !x);
      }}
    >
      <span className="pa-msg-from">
        {badge}
        {label}
      </span>
      <span className={`pa-msg-status ${statusClass(status)} status-badge`}>{status}</span>
      <span className="pa-msg-time">{formatTime(createdAt)}</span>
      {action}
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
      {error && <div className="pa-msg-error">{error}</div>}
    </div>
  );
}
