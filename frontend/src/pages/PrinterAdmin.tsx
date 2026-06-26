import { useState, useEffect, useCallback } from 'react';
import { useApiKeyAuth } from '../hooks/useApiKeyAuth';
import FeedbackBanner from '../components/FeedbackBanner';
import type { Message, Thread, PrinterStats } from '../types/api';
import type { Printer } from '../types/api';

const PA_STORAGE_KEY = 'printbridge_pa_api_key';
const PA_PAGE = 50;

function formatTime(isoStr: string): string {
  return new Date(isoStr + 'Z').toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function statusClass(status: string): string {
  return ({ printed: 'status-printed', failed: 'status-failed', pending: 'status-pending', printing: 'status-printing' } as Record<string, string>)[status] ?? '';
}

export default function PrinterAdmin() {
  const { apiKey, login, logout, authFetch } = useApiKeyAuth(PA_STORAGE_KEY);
  const [keyInput, setKeyInput] = useState('');
  const [loginFeedback, setLoginFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [printer, setPrinter] = useState<Printer | null>(null);
  const [printerStats, setPrinterStats] = useState<PrinterStats | null>(null);

  // Settings form
  const [paName, setPaName] = useState('');
  const [paDesc, setPaDesc] = useState('');
  const [paLocation, setPaLocation] = useState('');
  const [paColumns, setPaColumns] = useState(24);
  const [settingsFeedback, setSettingsFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Messages
  const [view, setView] = useState<'all' | 'threads'>('all');
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgOffset, setMsgOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Threads
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

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginFeedback(null);
    const key = keyInput.trim();
    if (!key) { setLoginFeedback({ type: 'error', msg: 'Please enter your API key.' }); return; }
    setLoggingIn(true);
    try {
      const res = await fetch('/api/printer-admin/me', {
        headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      });
      if (res.status === 401 || res.status === 403) {
        setLoginFeedback({ type: 'error', msg: 'Invalid API key.' });
        return;
      }
      const data = await res.json() as { printer: Printer; stats: PrinterStats };
      login(key);
      setKeyInput('');
      setPrinter(data.printer);
      setPrinterStats(data.stats);
      setPaName(data.printer.name);
      setPaDesc(data.printer.description ?? '');
      setPaLocation(data.printer.location ?? '');
      setPaColumns(data.printer.columns);
    } catch (err) {
      setLoginFeedback({ type: 'error', msg: (err as Error).message || 'Network error.' });
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSettingsFeedback(null);
    setSaving(true);
    try {
      const res = await authFetch('/api/printer-admin/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name: paName.trim(),
          description: paDesc.trim(),
          location: paLocation.trim(),
          columns: paColumns,
        }),
      });
      const data = await res.json() as { success: boolean; printer?: Printer; error?: string };
      if (res.ok && data.success) {
        if (data.printer) setPrinter(data.printer);
        setSettingsFeedback({ type: 'success', msg: '✓ Saved' });
      } else {
        setSettingsFeedback({ type: 'error', msg: data.error ?? 'Save failed.' });
      }
    } catch (err) {
      setSettingsFeedback({ type: 'error', msg: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

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

  if (!apiKey) {
    return (
      <section className="tab-panel active">
        <div id="pa-login-panel">
          <div className="panel-header">
            <h1>Printer Admin</h1>
            <p>Enter your printer's API key to view messages and manage settings.</p>
          </div>
          <form onSubmit={handleLogin} style={{ maxWidth: 420 }}>
            <div className="field">
              <label htmlFor="pa-api-key"><span className="label-text">Printer API Key</span></label>
              <input
                type="password"
                id="pa-api-key"
                placeholder="Your printer's API key"
                autoComplete="off"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loggingIn}>
              {loggingIn ? 'Signing in…' : 'Sign In'}
            </button>
            {loginFeedback && <FeedbackBanner type={loginFeedback.type} message={loginFeedback.msg} />}
          </form>
        </div>
      </section>
    );
  }

  const metaParts: string[] = [];
  if (printer?.location) metaParts.push(printer.location);
  if (printer?.description) metaParts.push(printer.description);
  if (printerStats) metaParts.push(`${printerStats.total} messages · ${printerStats.printed} printed`);

  return (
    <section className="tab-panel active">
      <div id="pa-dashboard">
        <div
          className="panel-header"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}
        >
          <div>
            <h1>{printer?.name ?? 'Printer Admin'}</h1>
            <p style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{metaParts.join(' · ')}</p>
          </div>
          <button className="btn btn-outline btn-sm" onClick={logout}>Sign Out</button>
        </div>

        {/* Settings */}
        <div className="admin-section">
          <div className="admin-section-header"><h2>Printer Settings</h2></div>
          <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 500 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pa-name"><span className="label-text">Name</span></label>
              <input type="text" id="pa-name" maxLength={80} value={paName} onChange={(e) => setPaName(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pa-description">
                <span className="label-text">Description</span><span className="label-hint"> Optional</span>
              </label>
              <input type="text" id="pa-description" maxLength={200} value={paDesc} onChange={(e) => setPaDesc(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pa-location">
                <span className="label-text">Location</span><span className="label-hint"> Optional</span>
              </label>
              <input type="text" id="pa-location" maxLength={100} value={paLocation} onChange={(e) => setPaLocation(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pa-columns">
                <span className="label-text">Columns</span>
                <span className="label-hint"> chars per line — 24 for 58mm, 36 for 80mm</span>
              </label>
              <input
                type="number"
                id="pa-columns"
                min={10}
                max={200}
                style={{ maxWidth: 100 }}
                value={paColumns}
                onChange={(e) => setPaColumns(Number(e.target.value))}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? 'Saving…' : 'Save Settings'}
              </button>
              {settingsFeedback && (
                <div className={`feedback ${settingsFeedback.type}`} style={{ margin: 0, padding: '6px 10px', fontSize: 12 }}>
                  {settingsFeedback.msg}
                </div>
              )}
            </div>
          </form>
        </div>

        {/* Messages */}
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
                    : t.latest_image ? '📷 Image' : '—';
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
                  ← Back to Threads
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
      </div>
    </section>
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
