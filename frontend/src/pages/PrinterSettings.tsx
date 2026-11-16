import { useState, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { usePrinterAuth } from '../contexts/PrinterAuthContext';
import PrinterPageLayout from '../components/PrinterPageLayout';
import type { Printer } from '../types/api';
import { WIDTH_PRESETS, SIZE_STEPS, colsFor, dotsForCols, normalCols } from '../lib/printerGeometry';

export default function PrinterSettings() {
  const { apiKey, printer, authFetch, refreshPrinter, logout } = usePrinterAuth();
  const navigate = useNavigate();

  const [paName, setPaName] = useState('');
  const [paDesc, setPaDesc] = useState('');
  const [paLocation, setPaLocation] = useState('');
  // Printer width, as Normal-size characters per line (what the test page ruler shows).
  const [paCols, setPaCols] = useState(WIDTH_PRESETS[0].cols);
  // "Other" is selected when the saved width isn't one of the common ones.
  const [paOtherCols, setPaOtherCols] = useState(false);
  const [paEmojiMode, setPaEmojiMode] = useState<'glyph' | 'text'>('glyph');
  const [settingsFeedback, setSettingsFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Management state
  const [busy, setBusy] = useState(false);
  const [mgmtFeedback, setMgmtFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  // Delete flow: null → not started; 'confirm' → showing the warning + name field.
  const [deleteStage, setDeleteStage] = useState<null | 'confirm'>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleteAck, setDeleteAck] = useState(false);

  const [testPageBusy, setTestPageBusy] = useState(false);
  const [testPageFeedback, setTestPageFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    if (!printer) return;
    setPaName(printer.name);
    setPaDesc(printer.description ?? '');
    setPaLocation(printer.location ?? '');
    const preset = WIDTH_PRESETS.find((p) => p.dots === printer.print_width_dots);
    setPaCols(preset ? preset.cols : normalCols(printer.print_width_dots));
    setPaOtherCols(!preset);
    setPaEmojiMode(printer.emoji_mode === 'text' ? 'text' : 'glyph');
  }, [printer]);

  async function patchPrinter(body: Record<string, unknown>, successMsg: string) {
    setMgmtFeedback(null);
    setBusy(true);
    try {
      const res = await authFetch('/api/printer-admin/me', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (res.ok && data.success) {
        refreshPrinter();
        setMgmtFeedback({ type: 'success', msg: successMsg });
      } else {
        setMgmtFeedback({ type: 'error', msg: data.error ?? 'Update failed.' });
      }
    } catch (err) {
      setMgmtFeedback({ type: 'error', msg: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  // SQLite stores booleans as integers, so the API returns active/hidden as 0 or 1
  // (not true/false). Compare by truthiness — `active !== false` would always be
  // true for the number 0, which previously left deactivated printers showing as
  // "Active" with no way to reactivate them.
  const isHidden = !!printer?.hidden;
  const isActive = !!printer?.active;

  function toggleHidden() {
    patchPrinter({ hidden: !isHidden }, !isHidden ? 'Printer hidden from the directory.' : 'Printer is now visible in the directory.');
  }

  function toggleActive() {
    patchPrinter({ active: !isActive }, !isActive ? 'Printer reactivated.' : 'Printer deactivated.');
  }

  async function handleDelete() {
    setMgmtFeedback(null);
    setBusy(true);
    try {
      const res = await authFetch('/api/printer-admin/me', {
        method: 'DELETE',
        body: JSON.stringify({ confirm_name: deleteConfirmName.trim() }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (res.ok && data.success) {
        // The API key is now dead; drop the session and leave.
        logout();
        navigate('/directory', { replace: true });
      } else {
        setMgmtFeedback({ type: 'error', msg: data.error ?? 'Could not delete printer.' });
        setBusy(false);
      }
    } catch (err) {
      setMgmtFeedback({ type: 'error', msg: (err as Error).message });
      setBusy(false);
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
          print_width_dots: dotsForCols(paCols),
          emoji_mode: paEmojiMode,
        }),
      });
      const data = await res.json() as { success: boolean; printer?: Printer; error?: string };
      if (res.ok && data.success) {
        refreshPrinter();
        setSettingsFeedback({ type: 'success', msg: 'Saved' });
      } else {
        setSettingsFeedback({ type: 'error', msg: data.error ?? 'Save failed.' });
      }
    } catch (err) {
      setSettingsFeedback({ type: 'error', msg: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestPage() {
    setTestPageFeedback(null);
    setTestPageBusy(true);
    try {
      const res = await authFetch('/api/printer-admin/test-page', { method: 'POST' });
      const data = await res.json() as { success?: boolean; error?: string };
      if (res.ok && data.success) {
        setTestPageFeedback({ type: 'success', msg: 'Test page queued — it prints the next time your printer checks in.' });
      } else {
        setTestPageFeedback({ type: 'error', msg: data.error ?? 'Could not queue a test page.' });
      }
    } catch (err) {
      setTestPageFeedback({ type: 'error', msg: (err as Error).message });
    } finally {
      setTestPageBusy(false);
    }
  }

  if (!apiKey) return <Navigate to="/myprinter/login" replace />;

  return (
    <PrinterPageLayout>
      <div className="admin-section">
        <div className="admin-section-header"><h2>Settings</h2></div>
        <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 500 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="pa-name"><span className="label-text">Name *</span></label>
            <input type="text" id="pa-name" maxLength={80} value={paName} onChange={(e) => setPaName(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="pa-description">
              <span className="label-text">Description</span>
            </label>
            <input type="text" id="pa-description" maxLength={200} value={paDesc} onChange={(e) => setPaDesc(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="pa-location">
              <span className="label-text">Location</span>
            </label>
            <input type="text" id="pa-location" maxLength={100} value={paLocation} onChange={(e) => setPaLocation(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label><span className="label-text">Characters per line</span></label>
            <div className="paper-width-options">
              {WIDTH_PRESETS.map((preset) => (
                <label key={preset.cols} className="paper-width-option">
                  <input
                    type="radio"
                    name="pa-width"
                    checked={!paOtherCols && paCols === preset.cols}
                    onChange={() => { setPaOtherCols(false); setPaCols(preset.cols); }}
                  />
                  <span className="paper-width-label">
                    <strong>{preset.cols}</strong>
                    <span className="paper-width-hint">{preset.hint}</span>
                  </span>
                </label>
              ))}
              <label className="paper-width-option">
                <input
                  type="radio"
                  name="pa-width"
                  checked={paOtherCols}
                  onChange={() => setPaOtherCols(true)}
                />
                <span className="paper-width-label">
                  <strong>Other</strong>
                  <span className="paper-width-hint">
                    {paOtherCols ? (
                      <input
                        type="number"
                        aria-label="Characters per line"
                        min={11}
                        max={85}
                        style={{ width: 70 }}
                        value={paCols}
                        onChange={(e) => setPaCols(Number(e.target.value))}
                      />
                    ) : 'If your test page shows a different number'}
                  </span>
                </span>
              </label>
            </div>
            <span className="label-hint">
              Not sure? Print a test page below and use the last number on the first ruler line.
              {' '}At each size: {SIZE_STEPS.map((s) => `${s.name} ${colsFor(dotsForCols(paCols), s.pt)}`).join(' · ')}
            </span>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label><span className="label-text">Emoji</span></label>
            <div className="paper-width-options">
              <label className="paper-width-option">
                <input type="radio" name="pa-emoji" checked={paEmojiMode === 'glyph'} onChange={() => setPaEmojiMode('glyph')} />
                <span className="paper-width-label">
                  <strong>Pictures</strong>
                  <span className="paper-width-hint">Small black-and-white emoji, if your printer supports custom characters</span>
                </span>
              </label>
              <label className="paper-width-option">
                <input type="radio" name="pa-emoji" checked={paEmojiMode === 'text'} onChange={() => setPaEmojiMode('text')} />
                <span className="paper-width-label">
                  <strong>Text</strong>
                  <span className="paper-width-hint">Stand-ins like &lt;3 and :D — works on every printer</span>
                </span>
              </label>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
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

      {/* ── Test page ──────────────────────────────────────────────────────── */}
      <div className="admin-section">
        <div className="admin-section-header"><h2>Test Page</h2></div>
        <div className="mgmt-list">
          <div className="mgmt-row">
            <div className="mgmt-row-text">
              <div className="mgmt-row-title">Check your printer</div>
              <div className="mgmt-row-desc">
                Prints rulers to confirm the paper width, a sample of every size and
                style, and an emoji row so you can choose Pictures or Text above.
                Save any changes first.
              </div>
            </div>
            <button type="button" className="btn btn-sm btn-outline" onClick={handleTestPage} disabled={testPageBusy}>
              {testPageBusy ? 'Queuing…' : 'Print test page'}
            </button>
          </div>
          {testPageFeedback && (
            <div className={`feedback ${testPageFeedback.type}`} style={{ margin: '4px 0 0', padding: '6px 10px', fontSize: 12 }}>
              {testPageFeedback.msg}
            </div>
          )}
        </div>
      </div>

      {/* ── Printer Management ─────────────────────────────────────────────── */}
      <div className="admin-section">
        <div className="admin-section-header"><h2>Printer Management</h2></div>

        <div className="mgmt-list">
          {/* Print client version, from its last poll */}
          <div className="mgmt-row">
            <div className="mgmt-row-text">
              <div className="mgmt-row-title">
                Print client:{' '}
                {!printer?.last_seen ? 'not connected yet' : printer.client_version ?? 'old version'}
              </div>
              <div className="mgmt-row-desc">
                {!printer?.last_seen
                  ? 'Start the print client on the computer connected to your printer.'
                  : printer.client_version
                    ? 'The version running on the computer connected to your printer.'
                    : 'Update the print client for formatting, alignment, emoji pictures and the test page.'}
              </div>
            </div>
          </div>

          {/* Hide */}
          <div className="mgmt-row">
            <div className="mgmt-row-text">
              <div className="mgmt-row-title">Directory visibility</div>
              <div className="mgmt-row-desc">
                {isHidden
                  ? 'Your printer is hidden. It won’t appear in the public directory, but people with a direct link can still send to it.'
                  : 'Your printer is listed in the public directory for anyone to find.'}
              </div>
            </div>
            <button
              type="button"
              className={`btn btn-sm ${isHidden ? 'btn-primary' : 'btn-outline'}`}
              onClick={toggleHidden}
              disabled={busy}
            >
              {isHidden ? 'Show in directory' : 'Hide from directory'}
            </button>
          </div>

          {/* Deactivate */}
          <div className="mgmt-row">
            <div className="mgmt-row-text">
              <div className="mgmt-row-title">
                Status: <span className={isActive ? 'mgmt-status-on' : 'mgmt-status-off'}>{isActive ? 'Active' : 'Inactive'}</span>
              </div>
              <div className="mgmt-row-desc">
                {isActive
                  ? 'Your printer is active and can receive messages.'
                  : 'Your printer is deactivated. It won’t receive new messages and is hidden from the directory until reactivated.'}
              </div>
            </div>
            <button
              type="button"
              className={`btn btn-sm ${isActive ? 'btn-outline' : 'btn-primary'}`}
              onClick={toggleActive}
              disabled={busy}
            >
              {isActive ? 'Deactivate' : 'Reactivate'}
            </button>
          </div>

          {mgmtFeedback && (
            <div className={`feedback ${mgmtFeedback.type}`} style={{ margin: '4px 0 0', padding: '6px 10px', fontSize: 12 }}>
              {mgmtFeedback.msg}
            </div>
          )}
        </div>

        {/* Danger zone: delete */}
        <div className="danger-zone">
          <div className="danger-zone-header">Delete this printer</div>

          {deleteStage === null ? (
            <>
              <p className="danger-zone-desc">
                Deleting retires your printer permanently. Your API key stops working and
                the printer is removed from the directory. Message history and conversations
                are preserved for the people who talked to you, but you won’t be able to
                log in or send from this printer again.
              </p>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => { setDeleteStage('confirm'); setDeleteConfirmName(''); setDeleteAck(false); setMgmtFeedback(null); }}
                disabled={busy}
              >
                Delete printer…
              </button>
            </>
          ) : (
            <div className="danger-confirm">
              <p className="danger-zone-desc">
                This can’t be undone. To confirm, type your printer’s name
                <strong> {printer?.name} </strong> below and check the box.
              </p>

              <label className="danger-ack">
                <input
                  type="checkbox"
                  checked={deleteAck}
                  onChange={(e) => setDeleteAck(e.target.checked)}
                />
                <span>I understand this printer will be permanently retired and its API key will stop working.</span>
              </label>

              <input
                type="text"
                className="danger-name-input"
                placeholder={printer?.name}
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                aria-label="Type printer name to confirm deletion"
              />

              <div className="danger-actions">
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => { setDeleteStage(null); setDeleteConfirmName(''); setDeleteAck(false); }}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={handleDelete}
                  disabled={busy || !deleteAck || deleteConfirmName.trim() !== printer?.name}
                >
                  {busy ? 'Deleting…' : 'Permanently delete'}
                </button>
              </div>

              {mgmtFeedback && mgmtFeedback.type === 'error' && (
                <div className="feedback error" style={{ margin: '8px 0 0', padding: '6px 10px', fontSize: 12 }}>
                  {mgmtFeedback.msg}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </PrinterPageLayout>
  );
}
