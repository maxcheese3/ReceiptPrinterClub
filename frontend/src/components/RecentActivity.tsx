import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { usePrinterAuth } from '../contexts/PrinterAuthContext';
import MessageCard from './MessageCard';
import { getGuestHistory, removeGuestMessage, clearGuestHistory } from '../lib/guestHistory';
import type { RecentMessage, GuestSentMessage } from '../types/api';

/**
 * The activity panel under the send form. Behaves differently by user type:
 *
 *   Logged in  -> "Your recent messages": the 10 most recent messages in BOTH
 *                 directions, each marked Sent or Received. Server-backed.
 *   Guest      -> "Your sent messages": unchanged. Guests have no inbox (nothing
 *                 can be addressed to them), so there's nothing to receive —
 *                 sent-only is the only coherent view. localStorage-backed.
 */

const GUEST_PAGE = 5;
const RECENT_LIMIT = 10;

interface Props {
  /** Bump to force a re-read after a send. */
  refreshKey: number;
}

export default function RecentActivity({ refreshKey }: Props) {
  const { apiKey, authFetch } = usePrinterAuth();
  const isGuest = !apiKey;

  const [expanded, setExpanded] = useState(false);

  // Guest state
  const [guestItems, setGuestItems] = useState<GuestSentMessage[]>([]);
  const [guestLimit, setGuestLimit] = useState(GUEST_PAGE);

  // Logged-in state
  const [recent, setRecent] = useState<RecentMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const loadRecent = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/printer-admin/recent?limit=${RECENT_LIMIT}`);
      const data = await res.json() as { messages: RecentMessage[] };
      setRecent(data.messages ?? []);
    } catch { /* keep whatever we had */ }
    finally { setLoading(false); }
  }, [authFetch]);

  useEffect(() => {
    if (isGuest) {
      setGuestItems(getGuestHistory());
    } else {
      loadRecent();
      // Anonymous sends are unattributed by design, so the server has no record
      // of them and they can't come back from /recent. They only exist in
      // localStorage — pull them in so they don't vanish from the sender's view.
      setGuestItems(getGuestHistory());
    }
  }, [isGuest, refreshKey, loadRecent]);

  const total = isGuest ? guestItems.length : recent.length + guestItems.length;

  // For logged-in users, interleave the server's attributed messages with any
  // anonymous sends held only in localStorage, newest-first, so the panel reads
  // as one timeline rather than two disjoint lists.
  type Row =
    | { kind: 'server'; at: string; msg: RecentMessage }
    | { kind: 'local';  at: string; msg: GuestSentMessage };

  const rows: Row[] = isGuest
    ? []
    : [
        ...recent.map((m): Row => ({ kind: 'server', at: m.created_at, msg: m })),
        ...guestItems.map((m): Row => ({ kind: 'local', at: m.created_at, msg: m })),
      ]
        // created_at from the server has no timezone marker; local entries are
        // full ISO strings. Normalise before comparing or the ordering is wrong.
        .sort((a, b) => normAt(b.at).localeCompare(normAt(a.at)))
        .slice(0, RECENT_LIMIT);

  function normAt(s: string): string {
    return /[Zz]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z';
  }

  function handleRemove(id: string) {
    setGuestItems(removeGuestMessage(id));
  }

  function handleClear() {
    clearGuestHistory();
    setGuestItems([]);
  }

  // Nothing to show yet — stay out of the way rather than render an empty panel.
  if (total === 0 && !loading) return null;

  const title = isGuest ? 'Your sent messages' : 'Your recent messages';

  return (
    <div className="page-card sent-history">
      <button
        type="button"
        className="sent-history-toggle"
        onClick={() => setExpanded((x) => !x)}
        aria-expanded={expanded}
      >
        <span className="sent-history-title">
          {title} <span className="sent-history-count">{total}</span>
        </span>
        <span className={`sent-history-chevron${expanded ? ' open' : ''}`} aria-hidden="true">▾</span>
      </button>

      {expanded && (
        <div className="sent-history-body">
          <p className="sent-history-note">
            {isGuest ? (
              <>
                Saved on this device only.{' '}
                <Link to="/myprinter/login">Log in to your printer</Link> to keep your
                history on the server and see replies.
              </>
            ) : (
              <>
                Your latest sent and received messages.{' '}
                <Link to="/myprinter/message-history">See full history</Link>.
              </>
            )}
          </p>

          <div className="pa-message-list">
            {isGuest
              ? guestItems.slice(0, guestLimit).map((m) => (
                <MessageCard
                  key={m.id}
                  label={`To: ${m.printer_name}`}
                  status={m.status}
                  createdAt={m.created_at}
                  body={m.body}
                  imagePath={m.image_path}
                  error={m.error}
                  action={
                    <button
                      type="button"
                      className="sent-history-remove"
                      onClick={() => handleRemove(m.id)}
                      aria-label="Remove from history"
                    >Remove</button>
                  }
                />
              ))
              : rows.map((row) => {
                if (row.kind === 'local') {
                  // An anonymous send: known only to this device, and deliberately
                  // not linked to your printer on the server.
                  const m = row.msg;
                  return (
                    <MessageCard
                      key={`local-${m.id}`}
                      label={`To: ${m.printer_name}`}
                      status={m.status}
                      createdAt={m.created_at}
                      body={m.body}
                      imagePath={m.image_path}
                      error={m.error}
                      badge={
                        <>
                          <span className="dir-badge out">Sent</span>
                          <span
                            className="dir-badge anon"
                            title="Not linked to your printer. Only saved on this device."
                          >Anonymous</span>
                        </>
                      }
                    />
                  );
                }
                const m = row.msg;
                const isOut = m.direction === 'out';
                const who = m.counterparty_name ?? '(unknown)';
                return (
                  <MessageCard
                    key={m.id}
                    // Direction is the primary fact here, so lead with it.
                    label={isOut ? `To: ${who}` : `From: ${who}`}
                    status={m.status}
                    createdAt={m.created_at}
                    body={m.body}
                    imagePath={m.image_path}
                    badge={
                      <span className={`dir-badge ${isOut ? 'out' : 'in'}`}>
                        {isOut ? 'Sent' : 'Received'}
                      </span>
                    }
                  />
                );
              })}
          </div>

          <div className="sent-history-actions">
            {isGuest && guestItems.length > guestLimit && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setGuestLimit((n) => n + 25)}
              >
                Load More
              </button>
            )}
            {isGuest && total > 0 && (
              <button
                type="button"
                className="btn btn-outline btn-sm sent-history-clear"
                onClick={handleClear}
              >
                Clear history
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
