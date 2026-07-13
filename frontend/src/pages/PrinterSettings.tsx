import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { usePrinterAuth } from '../contexts/PrinterAuthContext';
import PrinterPageLayout from '../components/PrinterPageLayout';
import type { Printer } from '../types/api';

export default function PrinterSettings() {
  const { apiKey, printer, authFetch, refreshPrinter } = usePrinterAuth();

  const [paName, setPaName] = useState('');
  const [paDesc, setPaDesc] = useState('');
  const [paLocation, setPaLocation] = useState('');
  const [paColumns, setPaColumns] = useState(24);
  const [settingsFeedback, setSettingsFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!printer) return;
    setPaName(printer.name);
    setPaDesc(printer.description ?? '');
    setPaLocation(printer.location ?? '');
    setPaColumns(printer.columns);
  }, [printer]);

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
            <label htmlFor="pa-columns">
              <span className="label-text">Columns *</span>
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
    </PrinterPageLayout>
  );
}
