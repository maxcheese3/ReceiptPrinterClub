import { useState, useEffect, useCallback, useRef } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { usePrinterAuth } from '../contexts/PrinterAuthContext';
import PrinterPageLayout from '../components/PrinterPageLayout';
import MessageCard, { formatTime, sentLabel, receivedLabel } from '../components/MessageCard';
import ChatBubble from '../components/ChatBubble';
import type { Message, Thread, ThreadMessage, SentMessage, SentStats, RecentMessage } from '../types/api';
import { displayBody } from '../lib/messageText';
import { usePagedList } from '../hooks/usePagedList';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

const REFRESH_MS = 15_000;

type View = 'all' | 'received' | 'sent' | 'threads';

const VIEWS: { id: View; label: string }[] = [
  { id: 'all',      label: 'All' },
  { id: 'received', label: 'Received' },
  { id: 'sent',     label: 'Sent' },
  { id: 'threads',  label: 'Threads' },
];

// A printer thread is keyed by the counterparty's id (so we can match both
// directions); a guest thread only by the name they typed. Distinct prefixes
// because a guest could type a name matching a printer's id.
function threadKey(t: Thread): string {
  return t.kind === 'printer' ? `p:${t.counterparty_id}` : `g:${t.sender_name ?? '__anon__'}`;
}

export default function PrinterMessageHistory() {
  const { apiKey, authFetch } = usePrinterAuth();
  const navigate = useNavigate();

  const [view, setView] = useState<View>('all');

  // ── Paged lists ─────────────────────────────────────────────────────────────
  const all = usePagedList<RecentMessage, { messages: RecentMessage[] }>(useCallback(
    (limit, offset) => authFetch(`/api/printer-admin/recent?limit=${limit}&offset=${offset}`).then((r) => r.json()),
    [authFetch],
  ));
  const received = usePagedList<Message, { messages: Message[] }>(useCallback(
    (limit, offset) => authFetch(`/api/printer-admin/messages?limit=${limit}&offset=${offset}`).then((r) => r.json()),
    [authFetch],
  ));
  const sent = usePagedList<SentMessage, { messages: SentMessage[]; stats: SentStats }>(useCallback(
    (limit, offset) => authFetch(`/api/printer-admin/sent?limit=${limit}&offset=${offset}`).then((r) => r.json()),
    [authFetch],
  ));
  const sentStats = sent.lastResponse?.stats ?? null;

  // ── Threads ─────────────────────────────────────────────────────────────────
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [threadLoaded, setThreadLoaded] = useState(false);
  // Which thread is open right now, so a slow response for one you've already
  // left can't land in the one you're looking at.
  const activeKeyRef = useRef<string | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      const res = await authFetch('/api/printer-admin/threads');
      const data = await res.json() as { threads: Thread[] };
      setThreads(data.threads ?? []);
    } catch { /**/ }
    finally { setThreadsLoaded(true); }
  }, [authFetch]);

  const loadThread = useCallback(async (t: Thread) => {
    const key = threadKey(t);
    const qs = t.kind === 'printer'
      ? `counterparty_id=${encodeURIComponent(t.counterparty_id ?? '')}`
      : `sender_name=${encodeURIComponent(t.sender_name ?? '')}`;
    try {
      const res = await authFetch(`/api/printer-admin/thread?${qs}`);
      const data = await res.json() as { messages: ThreadMessage[] };
      if (activeKeyRef.current !== key) return;
      setThreadMessages(data.messages ?? []);
    } catch { /**/ }
    finally {
      if (activeKeyRef.current === key) setThreadLoaded(true);
    }
  }, [authFetch]);

  function openThread(t: Thread) {
    activeKeyRef.current = threadKey(t);
    setActiveThread(t);
    setThreadMessages([]);
    setThreadLoaded(false);
    loadThread(t);
  }

  function closeThread() {
    activeKeyRef.current = null;
    setActiveThread(null);
    loadThreads();
  }

  function threadTitle(t: Thread): string {
    if (t.kind === 'printer') return t.counterparty_name ?? '(deleted printer)';
    return t.sender_name ?? '(anonymous)';
  }

  // ── Refresh ─────────────────────────────────────────────────────────────────
  // Only the view on screen is re-read; the others catch up when you switch to them.
  const refreshView = useCallback(() => {
    if (view === 'all')      return all.refresh();
    if (view === 'received') return received.refresh();
    if (view === 'sent')     return sent.refresh();
    return activeThread ? loadThread(activeThread) : loadThreads();
  }, [view, activeThread, all, received, sent, loadThread, loadThreads]);

  useEffect(() => {
    if (apiKey) refreshView();
  }, [apiKey, view]); // eslint-disable-line react-hooks/exhaustive-deps

  useAutoRefresh(refreshView, REFRESH_MS, !!apiKey);

  function switchView(v: View) {
    activeKeyRef.current = null;
    setActiveThread(null);
    setView(v);
  }

  function reply(printerId: string) {
    navigate(`/send-message?reply=${encodeURIComponent(printerId)}`);
  }

  if (!apiKey) return <Navigate to="/myprinter/login" replace />;

  function loadMoreButton(show: boolean, onClick: () => void) {
    if (!show) return null;
    return (
      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <button className="btn btn-outline btn-sm" onClick={onClick}>Load More</button>
      </div>
    );
  }

  function receivedCard(m: Message) {
    const from = m.sender_printer_id;
    return (
      <MessageCard
        key={m.id}
        direction="in"
        label={receivedLabel(m.sender_name, m.sender_printer_name)}
        status={m.status}
        createdAt={m.created_at}
        body={displayBody(m)}
        imagePath={m.image_path}
        // Only a registered printer can be replied to; guests have no inbox.
        onReply={from ? () => reply(from) : undefined}
      />
    );
  }

  function sentCard(m: Message & { recipient_name: string | null }) {
    return (
      <MessageCard
        key={m.id}
        direction="out"
        label={sentLabel(m.recipient_name, m.sender_name)}
        status={m.status}
        createdAt={m.created_at}
        body={displayBody(m)}
        imagePath={m.image_path}
      />
    );
  }

  return (
    <PrinterPageLayout>
      <div className="admin-section">
        <div className="admin-section-header">
          <h2>Messages</h2>
          <div className="pa-history-controls">
            <div className="pa-view-toggle">
              {VIEWS.map(({ id, label }) => (
                <button
                  key={id}
                  className={`pa-view-btn${view === id ? ' active' : ''}`}
                  onClick={() => switchView(id)}
                >{label}</button>
              ))}
            </div>
            <button
              className="btn btn-outline btn-sm pa-refresh-btn"
              onClick={() => refreshView()}
              title="Refresh"
              aria-label="Refresh"
            >↻</button>
          </div>
        </div>

        {/* ── All ──────────────────────────────────────────────────────────── */}
        {view === 'all' && (
          <>
            <div className="pa-message-list">
              {!all.loaded
                ? <div className="admin-loading">Loading…</div>
                : all.items.length === 0
                  ? <div className="admin-loading">No messages yet.</div>
                  : all.items.map((m) => (m.direction === 'out' ? sentCard(m) : receivedCard(m)))}
            </div>
            {loadMoreButton(all.hasMore, all.loadMore)}
          </>
        )}

        {/* ── Received ─────────────────────────────────────────────────────── */}
        {view === 'received' && (
          <>
            <div className="pa-message-list">
              {!received.loaded
                ? <div className="admin-loading">Loading…</div>
                : received.items.length === 0
                  ? <div className="admin-loading">No messages yet.</div>
                  : received.items.map(receivedCard)}
            </div>
            {loadMoreButton(received.hasMore, received.loadMore)}
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
              {!sent.loaded
                ? <div className="admin-loading">Loading…</div>
                : sent.items.length === 0
                  ? (
                    <div className="admin-loading">
                      Nothing sent yet. Messages you send while logged in will show up here.
                    </div>
                  )
                  : sent.items.map(sentCard)}
            </div>
            {loadMoreButton(sent.hasMore, sent.loadMore)}
          </>
        )}

        {/* ── Threads ──────────────────────────────────────────────────────── */}
        {view === 'threads' && !activeThread && (
          <div className="pa-thread-list">
            {!threadsLoaded
              ? <div className="admin-loading">Loading…</div>
              : threads.length === 0
                ? <div className="admin-loading">No conversations yet.</div>
                : threads.map((t) => {
                  const name = threadTitle(t);
                  const initial = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
                  const latestText = displayBody({ body: t.latest_body, word_wrap: t.latest_word_wrap, source: t.latest_source });
                  const preview = latestText
                    ? latestText.slice(0, 60)
                    : t.latest_image ? 'Image' : '—';
                  return (
                    <div key={threadKey(t)} className="pa-thread-card" onClick={() => openThread(t)}>
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
              <button className="btn btn-outline btn-sm" onClick={closeThread}>
                Back
              </button>
              <span style={{ fontWeight: 600, color: 'var(--fg)' }}>
                {threadTitle(activeThread)}
              </span>
              {activeThread.kind === 'guest'
                ? <span className="thread-badge">guest — can't reply</span>
                : activeThread.counterparty_id && (
                  <button
                    className="btn btn-outline btn-sm pa-thread-reply"
                    onClick={() => reply(activeThread.counterparty_id!)}
                  >Reply</button>
                )}
            </div>

            {/* Newest first, so the latest reply is visible without scrolling. */}
            <div className="chat-log">
              {!threadLoaded
                ? <div className="admin-loading">Loading…</div>
                : threadMessages.length === 0
                  ? <div className="admin-loading">No messages in this conversation.</div>
                  : threadMessages.map((m) => (
                    <ChatBubble
                      key={m.id}
                      direction={m.direction}
                      body={displayBody(m)}
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
      </div>
    </PrinterPageLayout>
  );
}
