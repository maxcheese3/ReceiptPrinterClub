import { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { usePrinterAuth } from '../contexts/PrinterAuthContext';
import PrinterPageLayout from '../components/PrinterPageLayout';
import MessageCard, { formatTime } from '../components/MessageCard';
import ChatBubble from '../components/ChatBubble';
import type { Message, Thread, ThreadMessage, SentMessage, SentStats } from '../types/api';

const PA_INITIAL = 10;
const PA_MORE    = 25;

type View = 'all' | 'threads' | 'sent';

export default function PrinterMessageHistory() {
  const { apiKey, authFetch } = usePrinterAuth();

  const [view, setView] = useState<View>('all');

  // ── Received ────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgOffset, setMsgOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);

  // ── Sent ────────────────────────────────────────────────────────────────────
  const [sent, setSent] = useState<SentMessage[]>([]);
  const [sentOffset, setSentOffset] = useState(0);
  const [sentHasMore, setSentHasMore] = useState(false);
  const [sentStats, setSentStats] = useState<SentStats | null>(null);
  const [sentLoaded, setSentLoaded] = useState(false);

  const loadMessages = useCallback(async (reset = false) => {
    const offset = reset ? 0 : msgOffset;
    const limit  = reset ? PA_INITIAL : PA_MORE;
    try {
      const res = await authFetch(`/api/printer-admin/messages?limit=${limit}&offset=${offset}`);
      const data = await res.json() as { messages: Message[] };
      const msgs = data.messages ?? [];
      if (reset) {
        setMessages(msgs);
        setMsgOffset(msgs.length);
      } else {
        setMessages((prev) => [...prev, ...msgs]);
        setMsgOffset((prev) => prev + msgs.length);
      }
      setHasMore(msgs.length >= limit);
    } catch { /**/ }
  }, [authFetch, msgOffset]);

  const loadThreads = useCallback(async () => {
    try {
      const res = await authFetch('/api/printer-admin/threads');
      const data = await res.json() as { threads: Thread[] };
      setThreads(data.threads ?? []);
      setActiveThread(null);
    } catch { /**/ }
  }, [authFetch]);

  const loadSent = useCallback(async (reset = false) => {
    const offset = reset ? 0 : sentOffset;
    const limit  = reset ? PA_INITIAL : PA_MORE;
    try {
      const res = await authFetch(`/api/printer-admin/sent?limit=${limit}&offset=${offset}`);
      const data = await res.json() as { messages: SentMessage[]; stats: SentStats };
      const msgs = data.messages ?? [];
      if (reset) {
        setSent(msgs);
        setSentOffset(msgs.length);
      } else {
        setSent((prev) => [...prev, ...msgs]);
        setSentOffset((prev) => prev + msgs.length);
      }
      setSentStats(data.stats ?? null);
      setSentHasMore(msgs.length >= limit);
      setSentLoaded(true);
    } catch { setSentLoaded(true); }
  }, [authFetch, sentOffset]);

  useEffect(() => {
    if (!apiKey) return;
    loadMessages(true);
  }, [apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A printer thread is keyed by the counterparty's id (so we can match both
  // directions); a guest thread only by the name they typed.
  async function openThread(t: Thread) {
    setActiveThread(t);
    setThreadMessages([]);
    const qs = t.kind === 'printer'
      ? `counterparty_id=${encodeURIComponent(t.counterparty_id ?? '')}`
      : `sender_name=${encodeURIComponent(t.sender_name ?? '')}`;
    try {
      const res = await authFetch(`/api/printer-admin/thread?${qs}`);
      const data = await res.json() as { messages: ThreadMessage[] };
      setThreadMessages(data.messages ?? []);
    } catch { /**/ }
  }

  function threadTitle(t: Thread): string {
    if (t.kind === 'printer') return t.counterparty_name ?? '(deleted printer)';
    return t.sender_name ?? '(anonymous)';
  }

  function switchView(v: View) {
    setView(v);
    setActiveThread(null);
    if (v === 'threads')   loadThreads();
    else if (v === 'sent') loadSent(true);
    else                   loadMessages(true);
  }

  if (!apiKey) return <Navigate to="/myprinter/login" replace />;

  return (
    <PrinterPageLayout>
      <div className="admin-section">
        <div className="admin-section-header">
          <h2>Messages</h2>
          <div className="pa-view-toggle">
            <button
              className={`pa-view-btn${view === 'all' ? ' active' : ''}`}
              onClick={() => switchView('all')}
            >Received</button>
            <button
              className={`pa-view-btn${view === 'threads' ? ' active' : ''}`}
              onClick={() => switchView('threads')}
            >Threads</button>
            <button
              className={`pa-view-btn${view === 'sent' ? ' active' : ''}`}
              onClick={() => switchView('sent')}
            >Sent</button>
          </div>
        </div>

        {/* ── Received ─────────────────────────────────────────────────────── */}
        {view === 'all' && (
          <>
            <div className="pa-message-list">
              {messages.length === 0
                ? <div className="admin-loading">No messages yet.</div>
                : messages.map((m) => (
                  <MessageCard
                    key={m.id}
                    label={m.sender_name ?? '(unknown)'}
                    status={m.status}
                    createdAt={m.created_at}
                    body={m.body}
                    imagePath={m.image_path}
                  />
                ))}
            </div>
            {hasMore && (
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <button className="btn btn-outline btn-sm" onClick={() => loadMessages(false)}>
                  Load More
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Threads ──────────────────────────────────────────────────────── */}
        {view === 'threads' && !activeThread && (
          <div className="pa-thread-list">
            {threads.length === 0
              ? <div className="admin-loading">No conversations yet.</div>
              : threads.map((t) => {
                const name = threadTitle(t);
                const initial = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
                const preview = t.latest_body
                  ? t.latest_body.slice(0, 60)
                  : t.latest_image ? 'Image' : '—';
                // Distinct key: a guest could type a name matching a printer's.
                const key = t.kind === 'printer' ? `p:${t.counterparty_id}` : `g:${t.sender_name ?? '__anon__'}`;
                return (
                  <div key={key} className="pa-thread-card" onClick={() => openThread(t)}>
                    <div className={`pa-thread-avatar${t.kind === 'guest' ? ' guest' : ''}`}>{initial}</div>
                    <div className="pa-thread-info">
                      <div className="pa-thread-name">
                        {name}
                        {t.kind === 'guest' && <span className="thread-badge">guest</span>}
                      </div>
                      <div className="pa-thread-preview">
                        {/* Show at a glance whether they replied last, or you did. */}
                        {t.latest_direction === 'out' && <span className="preview-you">You: </span>}
                        {preview}
                      </div>
                    </div>
                    <div className="pa-thread-right">
                      <span className="pa-thread-count">{t.message_count}</span>
                      <span className="pa-thread-time">{formatTime(t.latest_at)}</span>
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {view === 'threads' && activeThread && (
          <>
            <div className="pa-thread-detail-header">
              <button className="btn btn-outline btn-sm" onClick={() => { setActiveThread(null); loadThreads(); }}>
                Back
              </button>
              <span style={{ fontWeight: 600, color: 'var(--fg)' }}>
                {threadTitle(activeThread)}
              </span>
              {activeThread.kind === 'guest' && (
                <span className="thread-badge">guest — can't reply</span>
              )}
            </div>

            <div className="chat-log">
              {threadMessages.length === 0
                ? <div className="admin-loading">No messages in this conversation.</div>
                : threadMessages.map((m) => (
                  <ChatBubble
                    key={m.id}
                    direction={m.direction}
                    body={m.body}
                    imagePath={m.image_path}
                    status={m.status}
                    createdAt={m.created_at}
                    // In a guest thread the sender name varies per message, so
                    // label each one. In a printer thread it's always the same
                    // person, already shown in the header — no need to repeat it.
                    senderLabel={activeThread.kind === 'guest' ? (m.sender_name ?? undefined) : undefined}
                  />
                ))}
            </div>
          </>
        )}

        {/* ── Sent ─────────────────────────────────────────────────────────── */}
        {view === 'sent' && (
          <>
            {sentStats && sentStats.total > 0 && (
              <div className="pa-sent-summary">
                <span><strong>{sentStats.total}</strong> sent</span>
                <span><strong>{sentStats.recipients}</strong> {sentStats.recipients === 1 ? 'printer' : 'printers'}</span>
                {sentStats.failed > 0 && <span className="status-failed"><strong>{sentStats.failed}</strong> failed</span>}
              </div>
            )}

            <div className="pa-message-list">
              {!sentLoaded
                ? <div className="admin-loading">Loading…</div>
                : sent.length === 0
                  ? (
                    <div className="admin-loading">
                      Nothing sent yet. Messages you send while logged in will show up here.
                    </div>
                  )
                  : sent.map((m) => (
                    <MessageCard
                      key={m.id}
                      // Sent messages are identified by their recipient, not their sender.
                      label={`To: ${m.recipient_name ?? '(deleted printer)'}`}
                      status={m.status}
                      createdAt={m.created_at}
                      body={m.body}
                      imagePath={m.image_path}
                    />
                  ))}
            </div>

            {sentHasMore && (
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <button className="btn btn-outline btn-sm" onClick={() => loadSent(false)}>
                  Load More
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </PrinterPageLayout>
  );
}
