import { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { usePrinterAuth } from '../contexts/PrinterAuthContext';
import PrinterPageLayout from '../components/PrinterPageLayout';
import type { Message, Thread } from '../types/api';

const PA_PAGE = 50;

function formatTime(isoStr: string): string {
  return new Date(isoStr + 'Z').toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function statusClass(status: string): string {
  return ({ printed: 'status-printed', failed: 'status-failed', pending: 'status-pending', printing: 'status-printing' } as Record<string, string>)[status] ?? '';
}

export default function PrinterMessageHistory() {
  const { apiKey, authFetch } = usePrinterAuth();

  const [view, setView] = useState<'all' | 'threads'>('all');
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgOffset, setMsgOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<{ sender: string | null; displayName: string } | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);

  const loadMessages = useCallback(async (reset = false) => {
    const offset = reset ? 0 : msgOffset;
    try {
      const res = await authFetch(`/api/printer-admin/messages?limit=${PA_PAGE}&offset=${offset}`);
      const data = await res.json() as { messages: Message[] };
      const msgs = data.messages ?? [];
      if (reset) {
        setMessages(msgs);
        setMsgOffset(msgs.length);
      } else {
        setMessages((prev) => [...prev, ...msgs]);
        setMsgOffset((prev) => prev + msgs.length);
      }
      setHasMore(msgs.length >= PA_PAGE);
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

  useEffect(() => {
    if (!apiKey) return;
    loadMessages(true);
  }, [apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openThread(sender: string | null, displayName: string) {
    setActiveThread({ sender, displayName });
    try {
      const encoded = encodeURIComponent(sender ?? '');
      const res = await authFetch(`/api/printer-admin/messages?limit=200&sender=${encoded}`);
      const data = await res.json() as { messages: Message[] };
      setThreadMessages(data.messages ?? []);
    } catch { /**/ }
  }

  function switchView(v: 'all' | 'threads') {
    setView(v);
    setActiveThread(null);
    if (v === 'threads') loadThreads();
    else loadMessages(true);
  }

  if (!apiKey) return <Navigate to="/printer/login" replace />;

  return (
    <PrinterPageLayout>
      <div className="admin-section">
        <div className="admin-section-header">
          <h2>Messages</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="pa-view-toggle">
              <button
                className={`pa-view-btn${view === 'all' ? ' active' : ''}`}
                onClick={() => switchView('all')}
              >All Messages</button>
              <button
                className={`pa-view-btn${view === 'threads' ? ' active' : ''}`}
                onClick={() => switchView('threads')}
              >Threads</button>
            </div>
            {view === 'all' && hasMore && (
              <button className="btn btn-outline btn-sm" onClick={() => loadMessages(false)}>Load More</button>
            )}
          </div>
        </div>

        {view === 'all' && (
          <div className="pa-message-list">
            {messages.length === 0
              ? <div className="admin-loading">No messages yet.</div>
              : messages.map((m) => <MessageCard key={m.id} message={m} />)}
          </div>
        )}

        {view === 'threads' && !activeThread && (
          <div className="pa-thread-list">
            {threads.length === 0
              ? <div className="admin-loading">No messages yet.</div>
              : threads.map((t) => {
                const name = t.sender_name ?? '(unknown)';
                const initial = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
                const preview = t.latest_body
                  ? t.latest_body.slice(0, 60)
                  : t.latest_image ? 'Image' : '—';
                return (
                  <div key={t.sender_name ?? '__null__'} className="pa-thread-card" onClick={() => openThread(t.sender_name, name)}>
                    <div className="pa-thread-avatar">{initial}</div>
                    <div className="pa-thread-info">
                      <div className="pa-thread-name">{name}</div>
                      <div className="pa-thread-preview">{preview}</div>
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
                Back to Threads
              </button>
              <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{activeThread.displayName}</span>
            </div>
            <div className="pa-message-list">
              {threadMessages.length === 0
                ? <div className="admin-loading">No messages in this thread.</div>
                : threadMessages.map((m) => <MessageCard key={m.id} message={m} />)}
            </div>
          </>
        )}
      </div>
    </PrinterPageLayout>
  );
}

function MessageCard({ message: m }: { message: Message }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`pa-message-card${m.image_path ? ' has-image' : ''}`}
      onClick={(e) => { if ((e.target as HTMLElement).tagName !== 'IMG') setExpanded((x) => !x); }}
    >
      <span className="pa-msg-from">{m.sender_name ?? '(unknown)'}</span>
      <span className={`pa-msg-status ${statusClass(m.status)} status-badge`}>{m.status}</span>
      <span className="pa-msg-time">{formatTime(m.created_at)}</span>
      {m.image_path && (
        <img
          className="pa-msg-img"
          src={`/uploads/${m.image_path}`}
          alt="image"
          onClick={() => window.open(`/uploads/${m.image_path}`)}
        />
      )}
      {m.body && (
        <div className={`pa-msg-body${expanded ? ' expanded' : ''}`}>{m.body}</div>
      )}
    </div>
  );
}
