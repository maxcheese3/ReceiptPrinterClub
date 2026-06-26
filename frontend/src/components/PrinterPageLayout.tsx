import { usePrinterAuth } from '../contexts/PrinterAuthContext';

interface PrinterPageLayoutProps {
  children: React.ReactNode;
}

export default function PrinterPageLayout({ children }: PrinterPageLayoutProps) {
  const { printer, printerStats } = usePrinterAuth();

  const metaParts: string[] = [];
  if (printer?.location) metaParts.push(printer.location);
  if (printer?.description) metaParts.push(printer.description);
  if (printerStats) metaParts.push(`${printerStats.total} messages · ${printerStats.printed} printed`);

  return (
    <section className="tab-panel active">
      <div id="pa-dashboard">
        <div className="panel-header">
          <h1>{printer?.name ?? 'My Printer'}</h1>
          {metaParts.length > 0 && (
            <p style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{metaParts.join(' · ')}</p>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}
