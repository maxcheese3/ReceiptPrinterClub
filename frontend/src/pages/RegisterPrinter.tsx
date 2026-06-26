import { useState } from 'react';
import FeedbackBanner from '../components/FeedbackBanner';
import { usePrinters } from '../hooks/usePrinters';

const PAPER_COLS: Record<string, number> = { '58': 24, '80': 36 };

export default function RegisterPrinter() {
  const { reload } = usePrinters();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [paperWidth, setPaperWidth] = useState<'58' | '80'>('58');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [result, setResult] = useState<{ apiKey: string; printerId: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setResult(null);
    setSubmitting(true);
    try {
      const cols = PAPER_COLS[paperWidth] ?? 24;
      const res = await fetch('/api/printers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          location: location.trim() || undefined,
          font_size: 9,
          columns: cols,
        }),
      });
      const data = await res.json() as { success: boolean; api_key?: string; printer?: { id: string }; error?: string };
      if (res.ok && data.success) {
        setName('');
        setDescription('');
        setLocation('');
        setPaperWidth('58');
        setResult({ apiKey: data.api_key!, printerId: data.printer!.id });
        reload();
      } else {
        setFeedback({ type: 'error', msg: data.error ?? 'Registration failed.' });
      }
    } catch {
      setFeedback({ type: 'error', msg: 'Network error.' });
    } finally {
      setSubmitting(false);
    }
  }

  function copyKey() {
    if (!result) return;
    navigator.clipboard.writeText(result.apiKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <section className="tab-panel active">
      <div className="panel-header">
        <h1>Register a Printer</h1>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="reg-name"><span className="label-text">Printer Name</span></label>
          <input
            type="text"
            id="reg-name"
            required
            placeholder="Office Receipt Printer"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="reg-desc">
            <span className="label-text">Description</span>
            <span className="label-hint"> Optional</span>
          </label>
          <input
            type="text"
            id="reg-desc"
            placeholder="58mm thermal by the front desk"
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="reg-location">
            <span className="label-text">Location</span>
            <span className="label-hint"> Optional</span>
          </label>
          <input
            type="text"
            id="reg-location"
            placeholder="2nd Floor, East Wing"
            maxLength={100}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
        <div className="field">
          <label><span className="label-text">Paper Width</span></label>
          <div className="paper-width-options">
            {(['58', '80'] as const).map((w) => (
              <label key={w} className="paper-width-option">
                <input
                  type="radio"
                  name="reg-paper-width"
                  value={w}
                  checked={paperWidth === w}
                  onChange={() => setPaperWidth(w)}
                />
                <span className="paper-width-label">
                  <strong>{w} mm</strong>
                  <span className="paper-width-hint">
                    {PAPER_COLS[w]} columns at 9pt · set <code>PRINT_COLUMNS={PAPER_COLS[w]}</code> in client .env
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Registering…' : 'Register Printer'}
        </button>
        {feedback && <FeedbackBanner type={feedback.type} message={feedback.msg} />}
      </form>

      {result && (
        <div className="api-key-box">
          <h2>🎉 Printer Registered!</h2>
          <p>Save your API key — it won't be shown again.</p>
          <div className="api-key-row">
            <code>{result.apiKey}</code>
            <button className="btn btn-sm" onClick={copyKey}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="printer-id-note">Printer ID: <code>{result.printerId}</code></p>
          <div className="next-steps">
            <strong>Next steps:</strong>
            <ol>
              <li>Copy the <code>client/</code> folder to your machine.</li>
              <li>Run <code>npm install</code> inside it.</li>
              <li>Copy <code>.env.example</code> → <code>.env</code>, set your API key, server URL, and <code>PRINT_COLUMNS</code> to match your paper width above.</li>
              <li>Run <code>node client.js</code>.</li>
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}
