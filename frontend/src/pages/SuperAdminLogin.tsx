import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAdminAuth } from '../hooks/useAdminAuth';
import FeedbackBanner from '../components/FeedbackBanner';

export default function SuperAdminLogin() {
  const { token, login } = useAdminAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [loginFeedback, setLoginFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  if (token) return <Navigate to="/admin" replace />;

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
        navigate('/admin', { replace: true });
      } else {
        setLoginFeedback({ type: 'error', msg: data.error ?? 'Login failed.' });
      }
    } catch {
      setLoginFeedback({ type: 'error', msg: 'Network error.' });
    } finally {
      setLoggingIn(false);
    }
  }

  return (
    <section className="tab-panel active">
      <div id="admin-login-panel">
        <div className="panel-header">
          <h1>Super Admin</h1>
          <p>For advanced printer god powers.</p>
        </div>
        <div className="login-card">
          <form onSubmit={handleLogin}>
            <div className="field">
              <label htmlFor="admin-password"><span className="label-text">Password</span></label>
              <input
                type="password"
                id="admin-password"
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
      </div>
    </section>
  );
}
