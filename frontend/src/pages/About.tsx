import { Link } from 'react-router-dom';

export default function About() {
  return (
    <section className="tab-panel active">
      <div className="panel-header">
        <h1>About</h1>
        <p>Revolutionizing the way humans talk to each other.</p>
      </div>

      <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 28 }}>
        <p style={{ color: 'var(--fg-muted)', lineHeight: 1.7 }}>
          Forget email. Forget texting. Forget every other communication platform built in the last
          two decades. ReceiptPrinterClub is here, boldly pushing messages to thermal receipt
          printers — the bleeding edge of human connection. 
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p className="label-text" style={{ marginBottom: 6 }}>Credits</p>
          <p style={{ color: 'var(--fg)' }}>Created by <span style={{ color: 'var(--accent)' }}>Ryan Evans</span></p>
          <p style={{ color: 'var(--fg)' }}>Inspired by <span style={{ color: 'var(--accent)' }}>Adam Novotny</span></p>
          <p style={{ color: 'var(--fg)' }}>Collaborated by <span style={{ color: 'var(--accent)' }}>Damon Jones</span></p>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a
            href="https://github.com/maxcheese3/ReceiptPrinterClub"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline"
          >
            GitHub
          </a>
          <Link to="/docs" className="btn btn-outline">
            API Docs
          </Link>
        </div>
      </div>
    </section>
  );
}
