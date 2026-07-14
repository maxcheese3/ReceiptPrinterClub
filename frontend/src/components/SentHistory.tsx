import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { usePrinterAuth } from '../contexts/PrinterAuthContext';
import MessageCard from './MessageCard';
import { getGuestHistory, removeGuestMessage, clearGuestHistory } from '../lib/guestHistory';
import type { SentMessage, GuestSentMessage } from '../types/api';

/**
 * "Messages you've sent", shown under the send form.
 *
 * Two backends, one UI:
 *   - Logged in to a printer -> the server has been recording sends against that
 *     printer, so read them back from /api/printer-admin/sent. Persists across
 *     devices.
 *   - Guest -> no server identity exists, so read from localStorage. Persists on
 *     this device only.
 */

const PAGE = 5;

interface Props {
  /** Bump to force a re-read after a send. */
  refreshKey: number;
}

export default function SentHistory({ refreshKey }: Props) {
  const { apiKey, authFetch } = usePrinterAuth();
  const isGuest = !apiKey;

  const [expanded, setExpanded] = useState(false);
  const [guestItems, setGuestItems] = useState<GuestSentMessage[]>([]);
  const [sentItems, setSentItems] = useState<SentMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState(false);

  const loadServer = useCallback(async (n: number) => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/printer-admin/sent?limit=${n}&offset=0`);
      const data = await res.json() as { messages: SentMessage[]; stats: { total: number } };
      setSentItems(data.messages ?? []);
      setTotal(data.stats?.total ?? 0);
    } catch { /* leave whatever we had */ }
    finally { setLoading(false); }
  }, [authFetch]);

  useEffect(() => {
    if (isGuest) {
      const all = getGuestHistory();
      setGuestItems(all);
      setTotal(all.length);
    } else {
      loadServer(limit);
    }
  }, [isGuest, refreshKey, limit, loadServer]);

  const items = isGuest ? guestItems.slice(0, limit) : sentItems;
  const hasMore = total > items.length;

  function handleRemove(id: string) {
    setGuestItems(removeGuestMessage(id));
    setTotal((t) => Math.max(0, t - 1));
  }

  function handleClear() {
    clearGuestHistory();
    setGuestItems([]);
    setTotal(0);
  }

  // Nothing sent yet — stay out of the way entirely rather than showing an
  // empty panel above the fold on a first visit.
  if (total === 0 && !loading) return null;

  return (
    <div className="page-card sent-history">
      <button
        type="button"
        className="sent-history-toggle"
        onClick={() => setExpanded((x) => !x)}
        aria-expanded={expanded}
      >
        <span className="sent-history-title">
          Your sent messages <span className="sent-history-count">{total}</span>
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
                history on the server and see it anywhere.
              </>
            ) : (
              <>
                Saved to your printer account.{' '}
                <Link to="/myprinter/message-history">See full history</Link>.
              </>
            )}
          </p>

          <div className="pa-message-list">
            {items.map((m) => {
              const isGuestItem = (x: SentMessage | GuestSentMessage): x is GuestSentMessage =>
                'printer_name' in x;
              const label = isGuestItem(m)
                ? `To: ${m.printer_name}`
                : `To: ${m.recipient_name ?? '(deleted printer)'}`;
              return (
                <MessageCard
                  key={m.id}
                  label={label}
                  status={m.status}
                  createdAt={m.created_at}
                  body={m.body}
                  imagePath={m.image_path}
                  error={isGuestItem(m) ? m.error : undefined}
                  action={isGuest ? (
                    <button
                      type="button"
                      className="sent-history-remove"
                      onClick={() => handleRemove(m.id)}
                      aria-label="Remove from history"
                    >Remove</button>
                  ) : undefined}
                />
              );
            })}
          </div>

          <div className="sent-history-actions">
            {hasMore && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setLimit((n) => n + 25)}
                disabled={loading}
              >
                {loading ? 'Loading…' : 'Load More'}
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
