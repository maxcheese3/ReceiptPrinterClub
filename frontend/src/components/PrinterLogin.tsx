import { useState } from 'react';
import FeedbackBanner from './FeedbackBanner';

interface PrinterLoginProps {
  onLogin: (key: string) => void;
}

export default function PrinterLogin({ onLogin }: PrinterLoginProps) {
  const [keyInput, setKeyInput] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const key = keyInput.trim();
    if (!key) { setFeedback({ type: 'error', msg: 'Please enter your API key.' }); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/printer-admin/me', {
        headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      });
      if (res.status === 401 || res.status === 403) {
        setFeedback({ type: 'error', msg: 'Invalid API key.' });
        return;
      }
      onLogin(key);
    } catch (err) {
      setFeedback({ type: 'error', msg: (err as Error).message || 'Network error.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="tab-panel active">
      <div id="pa-login-panel">
        <div className="panel-header">
          <h1>My Printer</h1>
          <p>Enter your printer's API key to manage settings, messages, and subscriptions.</p>
        </div>
        <form onSubmit={handleSubmit} style={{ maxWidth: 420 }}>
          <div className="field">
            <label htmlFor="pa-api-key"><span className="label-text">Printer API Key</span></label>
            <textarea
              id="pa-api-key"
              className="admin-api-input"
              placeholder="Your printer's API key"
              autoComplete="off"
              rows={3}
              style={{ resize: 'none', minHeight: 'unset', fontSize: '16px' }}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
          {feedback && <FeedbackBanner type={feedback.type} message={feedback.msg} />}
        </form>
      </div>
    </section>
  );
}
