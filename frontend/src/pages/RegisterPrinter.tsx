import { useState } from 'react';
import FeedbackBanner from '../components/FeedbackBanner';
import { usePrinters } from '../hooks/usePrinters';
import { WIDTH_PRESETS } from '../lib/printerGeometry';

export default function RegisterPrinter() {
  const { reload } = usePrinters();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [widthDots, setWidthDots] = useState(WIDTH_PRESETS[0].dots);
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
      const res = await fetch('/api/printers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          location: location.trim() || undefined,
          print_width_dots: widthDots,
        }),
      });
      const data = await res.json() as { success: boolean; api_key?: string; printer?: { id: string }; error?: string };
      if (res.ok && data.success) {
        setName('');
        setDescription('');
        setLocation('');
        setWidthDots(WIDTH_PRESETS[0].dots);
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
          <label>
            <span className="label-text">Characters per line</span>
            <span className="label-hint"> Best guess for now — a test page will confirm it once your printer is set up</span>
          </label>
          <div className="paper-width-options">
            {WIDTH_PRESETS.map((preset) => (
              <label key={preset.dots} className="paper-width-option">
                <input
                  type="radio"
                  name="reg-paper-width"
                  value={preset.dots}
                  checked={widthDots === preset.dots}
                  onChange={() => setWidthDots(preset.dots)}
                />
                <span className="paper-width-label">
                  <strong>{preset.cols}</strong>
                  <span className="paper-width-hint">{preset.hint}</span>
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
              <li>Copy <code>.env.example</code> → <code>.env</code>, set your API key, server URL, and where your printer is (<code>PRINTER_DEVICE</code> or <code>PRINTER_NAME</code>).</li>
              <li>Run <code>node client.js</code>.</li>
              <li>Log in on <strong>My Printer</strong> and print a test page to check characters per line and emoji support.</li>
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}
