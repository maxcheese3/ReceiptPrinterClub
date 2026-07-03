import { useState, useEffect, useCallback } from 'react';
import { useAdminAuth } from '../hooks/useAdminAuth';
import FeedbackBanner from '../components/FeedbackBanner';
import type { Message, AdminStats } from '../types/api';

interface AdminPrinter {
  id: string;
  name: string;
  description?: string;
  location?: string;
  columns: number;
  font_size: number;
  active: boolean | number;
  hidden: boolean | number;
  last_seen?: string;
}

interface SuperAdminProps {
  onOpenModal: (msg: Message) => void;
}

const PAGE_SIZE = 50;

function lastSeenLabel(last_seen?: string): string {
  if (!last_seen) return 'never';
  const m = Math.floor((Date.now() - new Date(last_seen + 'Z').getTime()) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export default function SuperAdmin({ onOpenModal }: SuperAdminProps) {
  const { token, login, logout, authFetch } = useAdminAuth();
  const [password, setPassword] = useState('');
  const [loginFeedback, setLoginFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  // Dashboard state
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [printers, setPrinters] = useState<AdminPrinter[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgOffset, setMsgOffset] = useState(0);
  const [filterPrinter, setFilterPrinter] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const res = await authFetch('/api/admin/stats');
      const data = await res.json() as { stats: AdminStats };
      setStats(data.stats);
    } catch { /**/ }
  }, [authFetch]);

  const loadPrinters = useCallback(async () => {
    try {
      const res = await authFetch('/api/admin/printers');
      const data = await res.json() as { printers: AdminPrinter[] };
      setPrinters(data.printers ?? []);
    } catch { /**/ }
  }, [authFetch]);

  const loadMessages = useCallback(async (reset = false) => {
    const offset = reset ? 0 : msgOffset;
    const url = `/api/admin/messages?limit=${PAGE_SIZE}&offset=${offset}${filterPrinter ? `&printer_id=${filterPrinter}` : ''}`;
    try {
      const res = await authFetch(url);
      const data = await res.json() as { messages: Message[] };
      const msgs = data.messages ?? [];
      if (reset) {
        setMessages(msgs);
        setMsgOffset(msgs.length);
      } else {
        setMessages((prev) => [...prev, ...msgs]);
        setMsgOffset((prev) => prev + msgs.length);
      }
    } catch { /**/ }
  }, [authFetch, msgOffset, filterPrinter]);

  // Load dashboard when token becomes available
  useEffect(() => {
    if (!token) return;
    loadStats();
    loadPrinters();
    loadMessages(true);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload messages when filter changes
  useEffect(() => {
    if (!token) return;
    setMsgOffset(0);
    loadMessages(true);
  }, [filterPrinter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginFeedback(null);
    setLoggingIn(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json() as { token?: string; error?: string };
      if (res.ok && data.token) {
        login(data.token);
        setPassword('');
      } else {
        setLoginFeedback({ type: 'error', msg: data.error ?? 'Login failed.' });
      }
    } catch {
      setLoginFeedback({ type: 'error', msg: 'Network error.' });
    } finally {
      setLoggingIn(false);
    }
  }

  async function savePrinter(p: AdminPrinter, updates: Partial<AdminPrinter>) {
    setSavingId(p.id);
    try {
      const res = await authFetch(`/api/admin/printers/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (!data.success) alert(data.error ?? 'Save failed.');
      else await loadPrinters();
    } catch { /**/ }
    finally { setSavingId(null); }
  }

  async function deletePrinter(p: AdminPrinter) {
    if (!confirm(`Permanently delete "${p.name}" and ALL its messages? This cannot be undone.`)) return;
    try {
      await authFetch(`/api/admin/printers/${p.id}`, { method: 'DELETE' });
      await loadPrinters();
    } catch (err) { alert((err as Error).message); }
  }

  if (!token) {
    return (
      <section className="tab-panel active">
        <div id="admin-login-panel">
          <div className="panel-header">
            <h1>Super Admin</h1>
            <p>For advanced printer god powers.</p>
          </div>
          <form onSubmit={handleLogin} style={{ maxWidth: 400 }}>
            <div className="field">
              <label htmlFor="admin-password"><span className="label-text">Password</span></label>
              <input
                type="password"
                id="admin-password"
                className="admin-api-input"
                autoComplete="current-password"
                placeholder="Admin password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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

  return (
    <section className="tab-panel active">
      <div id="admin-dashboard">
        <div
          className="panel-header"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}
        >
          <div>
            <h1>Super Admin Dashboard</h1>
            <p>Manage printers and view message history.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {stats && (
              <div className="admin-stat-row">
                <span>Total: <strong>{stats.total}</strong></span>{' '}
                <span>Printed: <strong>{stats.printed}</strong></span>{' '}
                <span>Failed: <strong>{stats.failed}</strong></span>{' '}
                <span>Web: <strong>{stats.from_web}</strong> · API: <strong>{stats.from_api}</strong> · Email: <strong>{stats.from_email}</strong></span>
              </div>
            )}
            <button className="btn btn-outline btn-sm" onClick={logout}>Sign Out</button>
          </div>
        </div>

        {/* Printers */}
        <div className="admin-section">
          <div className="admin-section-header">
            <h2>Printers</h2>
            <button className="btn btn-outline btn-sm" onClick={loadPrinters}>↻ Refresh</button>
          </div>
          <div className="admin-table-wrap">
            {printers.length === 0 ? (
              <div className="admin-loading">No printers registered.</div>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Name</th><th>Description</th><th>Location</th>
                    <th>Cols</th><th>Font</th><th>Status</th><th>Visible</th><th>Last Seen</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {printers.map((p) => (
                    <PrinterRow
                      key={p.id}
                      printer={p}
                      saving={savingId === p.id}
                      onSave={(updates) => savePrinter(p, updates)}
                      onDelete={() => deletePrinter(p)}
                      onToggleActive={() => savePrinter(p, { active: p.active ? 0 : 1 })}
                      onToggleHidden={() => savePrinter(p, { hidden: p.hidden ? 0 : 1 })}
                      lastSeenLabel={lastSeenLabel(p.last_seen)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="admin-section">
          <div className="admin-section-header">
            <h2>Message History</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                className="admin-filter-select"
                value={filterPrinter}
                onChange={(e) => setFilterPrinter(e.target.value)}
              >
                <option value="">All Printers</option>
                {printers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button className="btn btn-outline btn-sm" onClick={() => loadMessages(false)}>Load More</button>
            </div>
          </div>
          <div className="admin-table-wrap">
            {messages.length === 0 ? (
              <div className="admin-loading">No messages found.</div>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Time</th><th>Printer</th><th>From</th><th>Source</th>
                    <th>Body</th><th>Image</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((m) => (
                    <tr key={m.id}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
                        {new Date(m.created_at + 'Z').toLocaleString()}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{m.printer_name ?? m.printer_id.slice(0, 8)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{m.sender_name ?? '—'}</td>
                      <td style={{ textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{m.source}</td>
                      <td>
                        <div
                          className="msg-body-preview"
                          style={{ cursor: 'pointer' }}
                          onClick={() => onOpenModal(m)}
                        >
                          {(m.body ?? '').slice(0, 80) || '—'}
                        </div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {m.image_path ? (
                          <img
                            className="msg-image-thumb"
                            src={`/uploads/${m.image_path}`}
                            alt="img"
                            onClick={() => window.open(`/uploads/${m.image_path}`)}
                            style={{ cursor: 'pointer' }}
                          />
                        ) : '—'}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className={`status-badge status-${m.status}`}>{m.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

interface PrinterRowProps {
  printer: AdminPrinter;
  saving: boolean;
  lastSeenLabel: string;
  onSave: (updates: Partial<AdminPrinter>) => void;
  onDelete: () => void;
  onToggleActive: () => void;
  onToggleHidden: () => void;
}

function PrinterRow({ printer: p, saving, lastSeenLabel, onSave, onDelete, onToggleActive, onToggleHidden }: PrinterRowProps) {
  const [name, setName] = useState(p.name);
  const [description, setDescription] = useState(p.description ?? '');
  const [location, setLocation] = useState(p.location ?? '');
  const [columns, setColumns] = useState(p.columns);
  const [fontSize, setFontSize] = useState(p.font_size);

  return (
    <tr className={!p.active ? 'inactive' : ''}>
      <td><input className="admin-inline-input" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 120 }} /></td>
      <td><input className="admin-inline-input" value={description} onChange={(e) => setDescription(e.target.value)} style={{ minWidth: 120 }} /></td>
      <td><input className="admin-inline-input" value={location} onChange={(e) => setLocation(e.target.value)} style={{ minWidth: 100 }} /></td>
      <td>
        <input
          className="admin-inline-input"
          type="number"
          value={columns}
          onChange={(e) => setColumns(Number(e.target.value))}
          style={{ width: 60, minWidth: 60 }}
        />
      </td>
      <td>
        <select
          className="admin-inline-select"
          value={fontSize}
          onChange={(e) => setFontSize(Number(e.target.value))}
        >
          {[7, 8, 9, 10, 11, 12, 14].map((s) => (
            <option key={s} value={s}>{s}pt</option>
          ))}
        </select>
      </td>
      <td>
        <span className={`status-badge ${p.active ? 'status-printed' : 'status-failed'}`}>
          {p.active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td>
        <span className={`status-badge ${p.hidden ? 'status-failed' : 'status-printed'}`}>
          {p.hidden ? 'Hidden' : 'Visible'}
        </span>
      </td>
      <td style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>{lastSeenLabel}</td>
      <td className="admin-actions">
        <button
          className="btn btn-sm btn-save"
          disabled={saving}
          onClick={() => onSave({ name, description, location, columns, font_size: fontSize })}
        >
          {saving ? '…' : 'Save'}
        </button>
        <button className="btn btn-sm btn-toggle" onClick={onToggleActive}>
          {p.active ? 'Deactivate' : 'Activate'}
        </button>
        <button className="btn btn-sm btn-hide" onClick={onToggleHidden}>
          {p.hidden ? 'Unhide' : 'Hide'}
        </button>
        <button className="btn btn-sm btn-danger" onClick={onDelete}>Delete</button>
      </td>
    </tr>
  );
}
