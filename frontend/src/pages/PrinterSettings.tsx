import { useState, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { usePrinterAuth } from '../contexts/PrinterAuthContext';
import PrinterPageLayout from '../components/PrinterPageLayout';
import type { Printer } from '../types/api';
import { WIDTH_PRESETS, dotsForCols, normalCols } from '../lib/printerGeometry';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

// A row of buttons where exactly one is selected — the same control as the
// message history tabs.
function Toggle<T extends string | number | boolean>({ value, options, onChange, labelledBy, disabled }: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
  labelledBy: string;
  disabled?: boolean;
}) {
  return (
    <div className="pa-view-toggle settings-toggle" role="group" aria-labelledby={labelledBy}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={`pa-view-btn${value === o.value ? ' active' : ''}`}
          aria-pressed={value === o.value}
          title={o.title}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >{o.label}</button>
      ))}
    </div>
  );
}

// True when a client version is at least `min` (numeric x.y.z). An unknown
// (null) version is an old client.
function clientAtLeast(version: string | null | undefined, min: string): boolean {
  if (!version) return false;
  const a = version.split('.').map((n) => parseInt(n, 10) || 0);
  const b = min.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

export default function PrinterSettings() {
  const { apiKey, printer, printerStats, authFetch, refreshPrinter, logout } = usePrinterAuth();
  const navigate = useNavigate();

  const [paName, setPaName] = useState('');
  const [paDesc, setPaDesc] = useState('');
  const [paLocation, setPaLocation] = useState('');
  // Printer width, as Normal-size characters per line (what the test page ruler shows).
  const [paCols, setPaCols] = useState(WIDTH_PRESETS[0].cols);
  // "Other" is selected when the saved width isn't one of the common ones.
  const [paOtherCols, setPaOtherCols] = useState(false);
  const [paEmojiMode, setPaEmojiMode] = useState<'glyph' | 'text'>('glyph');
  const [paImageCut, setPaImageCut] = useState<'same' | 'separate'>('separate');
  const [paListed, setPaListed] = useState(true);
  const [settingsFeedback, setSettingsFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Printing (on / paused) and Status (active / inactive) apply as soon as
  // they're clicked. These follow the saved values, and change ahead of the
  // request so the toggle moves straight away.
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useState(true);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Management state
  const [busy, setBusy] = useState(false);
  const [mgmtFeedback, setMgmtFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  // Delete flow: null → not started; 'confirm' → showing the warning + name field.
  const [deleteStage, setDeleteStage] = useState<null | 'confirm'>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleteAck, setDeleteAck] = useState(false);

  const [testPageBusy, setTestPageBusy] = useState(false);
  const [testPageFeedback, setTestPageFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Fills the Settings form from the saved printer: on first load and after
  // Save, but not on every refresh. The Printing and Status toggles re-read the
  // printer too (and so does the refresh every 15 seconds while paused), and
  // that mustn't wipe edits that haven't been saved yet.
  function loadForm(p: Printer) {
    setPaName(p.name);
    setPaDesc(p.description ?? '');
    setPaLocation(p.location ?? '');
    const preset = WIDTH_PRESETS.find((w) => w.dots === p.print_width_dots);
    setPaCols(preset ? preset.cols : normalCols(p.print_width_dots));
    setPaOtherCols(!preset);
    setPaEmojiMode(p.emoji_mode === 'text' ? 'text' : 'glyph');
    setPaImageCut(p.image_cut === 'same' ? 'same' : 'separate');
    setPaListed(!p.hidden);
  }

  useEffect(() => {
    if (printer) loadForm(printer);
  }, [printer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!printer) return;
    // SQLite stores booleans as integers, so the API returns active/hidden/paused
    // as 0 or 1. Compare by truthiness — `active !== false` is true for the
    // number 0, which once left deactivated printers showing as Active.
    setPaused(!!printer.paused);
    setActive(!!printer.active);
  }, [printer]);

  // Keeps the "messages waiting" count current while paused.
  useAutoRefresh(refreshPrinter, 15_000, paused);
  const waiting = printerStats?.pending ?? 0;

  async function patchStatus(fields: { paused: boolean } | { active: boolean }, revert: () => void) {
    setStatusError(null);
    setStatusBusy(true);
    try {
      const res = await authFetch('/api/printer-admin/me', {
        method: 'PATCH',
        body: JSON.stringify(fields),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (res.ok && data.success) {
        refreshPrinter();
      } else {
        revert();
        setStatusError(data.error ?? 'Update failed.');
      }
    } catch (err) {
      revert();
      setStatusError((err as Error).message);
    } finally {
      setStatusBusy(false);
    }
  }

  function changePaused(next: boolean) {
    if (next === paused) return;
    setPaused(next);
    patchStatus({ paused: next }, () => setPaused(!next));
  }

  function changeActive(next: boolean) {
    if (next === active) return;
    setActive(next);
    patchStatus({ active: next }, () => setActive(!next));
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
          image_cut: paImageCut,
          hidden: !paListed,
        }),
      });
      const data = await res.json() as { success: boolean; printer?: Printer; error?: string };
      if (res.ok && data.success) {
        if (data.printer) loadForm(data.printer);
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
        setTestPageFeedback({
          type: 'success',
          msg: paused
            ? 'Test page queued. Printing is paused, so it prints when you switch Printing back on.'
            : 'Test page queued — it prints the next time your printer checks in.',
        });
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
            <span className="label-text" id="pa-width-label">Characters per line</span>
            <div className="settings-inline">
              <Toggle
                labelledBy="pa-width-label"
                value={paOtherCols ? 'other' : paCols}
                options={[
                  ...WIDTH_PRESETS.map((p) => ({ value: p.cols, label: String(p.cols), title: p.hint })),
                  { value: 'other' as const, label: 'Other' },
                ]}
                onChange={(v) => {
                  if (v === 'other') { setPaOtherCols(true); return; }
                  setPaOtherCols(false);
                  setPaCols(v);
                }}
              />
              {paOtherCols && (
                <input
                  type="number"
                  aria-label="Characters per line"
                  min={11}
                  max={85}
                  value={paCols}
                  onChange={(e) => setPaCols(Number(e.target.value))}
                />
              )}
            </div>
            <span className="label-hint">32: most 58mm · 48: most 80mm. The test page shows yours.</span>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <span className="label-text" id="pa-emoji-label">Emoji</span>
            <Toggle
              labelledBy="pa-emoji-label"
              value={paEmojiMode}
              options={[
                { value: 'glyph' as const, label: 'Pictures' },
                { value: 'text' as const, label: 'Text', title: 'Stand-ins like <3 and :D' },
              ]}
              onChange={setPaEmojiMode}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <span className="label-text" id="pa-image-cut-label">Images</span>
            <Toggle
              labelledBy="pa-image-cut-label"
              value={paImageCut}
              options={[
                { value: 'same' as const, label: 'Same receipt' },
                { value: 'separate' as const, label: 'Separate receipt', title: 'The image prints on its own, with its own cut' },
              ]}
              onChange={setPaImageCut}
            />
            {paImageCut === 'separate' && printer?.last_seen && !clientAtLeast(printer.client_version, '4.1.0') && (
              <span className="label-hint">Needs print client 4.1.0 — yours is {printer.client_version ?? 'older'}.</span>
            )}
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <span className="label-text" id="pa-listed-label">Printer Directory</span>
            <Toggle
              labelledBy="pa-listed-label"
              value={paListed}
              options={[
                { value: true, label: 'Listed' },
                { value: false, label: 'Hidden' },
              ]}
              onChange={setPaListed}
            />
            {!paListed && <span className="label-hint">Anyone with a direct link can still send to it.</span>}
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

          {/* Test page */}
          <div className="mgmt-row">
            <div className="mgmt-row-text">
              <div className="mgmt-row-title">Test page</div>
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

          {/* Pause: messages wait on the server and the printer shows as offline */}
          <div className="mgmt-row">
            <div className="mgmt-row-text">
              <div className="mgmt-row-title" id="pa-paused-label">Printing</div>
              <div className="mgmt-row-desc">
                {paused
                  ? `Paused — ${waiting === 0 ? 'nothing' : waiting === 1 ? '1 message' : `${waiting} messages`} waiting. Your printer shows as offline. Everything waiting prints in order when you switch back on.`
                  : 'Pause to hold messages on the server. Your printer shows as offline until you switch back on.'}
              </div>
            </div>
            <Toggle
              labelledBy="pa-paused-label"
              value={paused}
              options={[
                { value: false, label: 'On' },
                { value: true, label: 'Paused' },
              ]}
              onChange={changePaused}
              disabled={statusBusy}
            />
          </div>

          {/* Status: an inactive printer turns new messages away */}
          <div className="mgmt-row">
            <div className="mgmt-row-text">
              <div className="mgmt-row-title" id="pa-active-label">Status</div>
              <div className="mgmt-row-desc">
                {active
                  ? 'People can send to your printer.'
                  : 'Won’t receive messages or appear in the directory.'}
              </div>
            </div>
            <Toggle
              labelledBy="pa-active-label"
              value={active}
              options={[
                { value: true, label: 'Active' },
                { value: false, label: 'Inactive' },
              ]}
              onChange={changeActive}
              disabled={statusBusy}
            />
          </div>

          {statusError && (
            <div className="feedback error" style={{ margin: '4px 0 0', padding: '6px 10px', fontSize: 12 }}>
              {statusError}
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
