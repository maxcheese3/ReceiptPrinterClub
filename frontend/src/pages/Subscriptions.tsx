import { useState, useEffect, useCallback } from 'react';
import { useApiKeyAuth } from '../hooks/useApiKeyAuth';
import FeedbackBanner from '../components/FeedbackBanner';
import type { Subscription } from '../types/api';

const SUB_STORAGE_KEY = 'printbridge_sub_api_key';

const KNOWN_FEEDS = [
  { name: 'XKCD', url: 'https://xkcd.com', label: '🤓 XKCD', desc: 'https://xkcd.com — daily webcomic with image' },
  { name: 'NASA Image of the Day', url: 'https://www.nasa.gov/feeds/iotd-feed/', label: '🚀 NASA Image of the Day', desc: 'https://www.nasa.gov/feeds/iotd-feed/' },
  { name: 'Hacker News', url: 'https://hnrss.org/frontpage', label: '🔶 Hacker News Top', desc: 'https://hnrss.org/frontpage' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', label: '📱 The Verge', desc: 'https://www.theverge.com/rss/index.xml' },
  { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml', label: '🌍 BBC News', desc: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { name: 'Garfield Minus Garfield', url: 'https://garfieldminusgarfield.net/rss', label: '😿 Garfield Minus Garfield', desc: 'https://garfieldminusgarfield.net/rss' },
];

export default function Subscriptions() {
  const { apiKey, login, logout, authFetch } = useApiKeyAuth(SUB_STORAGE_KEY);
  const [keyInput, setKeyInput] = useState('');
  const [loginFeedback, setLoginFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [subs, setSubs] = useState<Subscription[]>([]);
  const [subName, setSubName] = useState('');
  const [subUrl, setSubUrl] = useState('');
  const [addFeedback, setAddFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [adding, setAdding] = useState(false);

  const loadSubs = useCallback(async () => {
    try {
      const res = await authFetch('/api/subscriptions');
      const data = await res.json() as { subscriptions: Subscription[] };
      setSubs(data.subscriptions ?? []);
    } catch { /**/ }
  }, [authFetch]);

  useEffect(() => {
    if (apiKey) loadSubs();
  }, [apiKey, loadSubs]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginFeedback(null);
    const key = keyInput.trim();
    if (!key) { setLoginFeedback({ type: 'error', msg: 'Please enter your API key.' }); return; }
    setLoggingIn(true);
    try {
      const res = await fetch('/api/subscriptions', { headers: { 'X-API-Key': key } });
      if (res.status === 401 || res.status === 403) {
        setLoginFeedback({ type: 'error', msg: 'Invalid API key.' });
        return;
      }
      const data = await res.json() as { subscriptions: Subscription[] };
      login(key);
      setKeyInput('');
      setSubs(data.subscriptions ?? []);
    } catch (err) {
      setLoginFeedback({ type: 'error', msg: (err as Error).message || 'Network error.' });
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddFeedback(null);
    const name = subName.trim();
    const url = subUrl.trim();
    if (!name) { setAddFeedback({ type: 'error', msg: 'Please enter a name.' }); return; }
    if (!url) { setAddFeedback({ type: 'error', msg: 'Please enter a feed URL.' }); return; }
    setAdding(true);
    try {
      const res = await authFetch('/api/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ name, feed_url: url }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (res.ok && data.success) {
        setSubName('');
        setSubUrl('');
        setAddFeedback({ type: 'success', msg: `✓ "${name}" added! It will be checked within 15 minutes, or click ↻ Fetch.` });
        loadSubs();
      } else {
        setAddFeedback({ type: 'error', msg: data.error ?? 'Failed to add subscription.' });
      }
    } catch (err) {
      setAddFeedback({ type: 'error', msg: (err as Error).message || 'Network error.' });
    } finally {
      setAdding(false);
    }
  }

  async function toggleSub(sub: Subscription) {
    try {
      await authFetch(`/api/subscriptions/${sub.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: sub.active ? 0 : 1 }),
      });
      loadSubs();
    } catch { /**/ }
  }

  async function fetchNow(sub: Subscription, setBtn: (l: string) => void) {
    setBtn('…');
    try {
      await authFetch(`/api/subscriptions/${sub.id}/poll`, { method: 'POST' });
      setBtn('✓');
      setTimeout(() => { setBtn('↻ Fetch'); loadSubs(); }, 2000);
    } catch { setBtn('↻ Fetch'); }
  }

  async function deleteSub(sub: Subscription) {
    if (!confirm(`Delete subscription "${sub.name}"?`)) return;
    try {
      await authFetch(`/api/subscriptions/${sub.id}`, { method: 'DELETE' });
      loadSubs();
    } catch { /**/ }
  }

  if (!apiKey) {
    return (
      <section className="tab-panel active">
        <div id="sub-login-panel">
          <div className="panel-header">
            <h1>Subscription Admin</h1>
            <p>Enter your printer's API key to manage its feed subscriptions.</p>
          </div>
          <form onSubmit={handleLogin} style={{ maxWidth: 420 }}>
            <div className="field">
              <label htmlFor="sub-api-key"><span className="label-text">Printer API Key</span></label>
              <input
                type="password"
                id="sub-api-key"
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

  return (
    <section className="tab-panel active">
      <div id="sub-dashboard">
        <div
          className="panel-header"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}
        >
          <div>
            <h1>Subscriptions</h1>
          </div>
          <button className="btn btn-outline btn-sm" onClick={logout}>Sign Out</button>
        </div>

        {/* Add subscription */}
        <div className="admin-section">
          <div className="admin-section-header"><h2>Add Subscription</h2></div>
          <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="sub-name"><span className="label-text">Name</span></label>
              <input
                type="text"
                id="sub-name"
                placeholder="e.g. XKCD Comics"
                maxLength={100}
                value={subName}
                onChange={(e) => setSubName(e.target.value)}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="sub-url">
                <span className="label-text">Feed URL</span>
                <span className="label-hint"> — RSS, Atom, or paste https://xkcd.com for XKCD</span>
              </label>
              <input
                type="url"
                id="sub-url"
                placeholder="https://xkcd.com or https://example.com/feed.rss"
                value={subUrl}
                onChange={(e) => setSubUrl(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={adding}>
              {adding ? 'Adding…' : 'Add Feed'}
            </button>
            {addFeedback && <FeedbackBanner type={addFeedback.type} message={addFeedback.msg} />}
          </form>
        </div>

        {/* Subscription list */}
        <div className="admin-section">
          <div className="admin-section-header">
            <h2>Active Subscriptions</h2>
            <button className="btn btn-outline btn-sm" onClick={loadSubs}>↻ Refresh</button>
          </div>
          <div className="sub-list">
            {subs.length === 0 ? (
              <div className="admin-loading">No subscriptions yet. Add one above.</div>
            ) : (
              subs.map((sub) => (
                <SubItem
                  key={sub.id}
                  sub={sub}
                  onToggle={() => toggleSub(sub)}
                  onFetch={(setBtn) => fetchNow(sub, setBtn)}
                  onDelete={() => deleteSub(sub)}
                />
              ))
            )}
          </div>
        </div>

        {/* Known feeds */}
        <div className="admin-section">
          <div className="admin-section-header"><h2>Known Feeds</h2></div>
          <div className="known-feeds">
            {KNOWN_FEEDS.map((f) => (
              <div
                key={f.url}
                className="known-feed-item"
                onClick={() => { setSubUrl(f.url); setSubName(f.name); }}
              >
                <strong>{f.label}</strong>
                <span>{f.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

interface SubItemProps {
  sub: Subscription;
  onToggle: () => void;
  onFetch: (setBtn: (l: string) => void) => void;
  onDelete: () => void;
}

function SubItem({ sub, onToggle, onFetch, onDelete }: SubItemProps) {
  const [fetchLabel, setFetchLabel] = useState('↻ Fetch');
  const checkedStr = sub.last_checked
    ? `Last checked: ${new Date(sub.last_checked + 'Z').toLocaleString()}`
    : 'Never checked';

  function typeLabel() {
    if (sub.feed_type === 'xkcd') return <span className="sub-badge sub-badge-xkcd">XKCD</span>;
    return <span className="sub-badge sub-badge-rss">RSS</span>;
  }

  return (
    <div className="sub-item">
      <div className="sub-item-info">
        <div className="sub-item-name">
          {sub.name} {typeLabel()}{' '}
          {sub.active
            ? <span className="sub-badge sub-badge-active">Active</span>
            : <span className="sub-badge sub-badge-paused">Paused</span>}
        </div>
        <div className="sub-item-url">{sub.feed_url}</div>
        <div className="sub-item-meta">
          {checkedStr}{sub.last_item_id ? ` · Last: ${sub.last_item_id.slice(0, 40)}` : ''}
        </div>
      </div>
      <div className="sub-item-actions">
        <button className="btn btn-sm btn-toggle" onClick={onToggle}>
          {sub.active ? 'Pause' : 'Resume'}
        </button>
        <button className="btn btn-sm btn-save" title="Fetch latest now" onClick={() => onFetch(setFetchLabel)}>
          {fetchLabel}
        </button>
        <button className="btn btn-sm btn-danger" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}
