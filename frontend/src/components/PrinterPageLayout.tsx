import { Link, useNavigate } from 'react-router-dom';
import { usePrinterAuth } from '../contexts/PrinterAuthContext';

interface PrinterPageLayoutProps {
  children: React.ReactNode;
}

export default function PrinterPageLayout({ children }: PrinterPageLayoutProps) {
  const { printer, printerStats, logout } = usePrinterAuth();
  const navigate = useNavigate();

  function handleSignOut() {
    logout();
    navigate('/send-message');
  }

  const metaParts: string[] = [];
  if (printer?.name) metaParts.push(printer.name);
  if (printer?.location) metaParts.push(printer.location);

  return (
    <section className="tab-panel active">
      <div id="pa-dashboard">
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1>My Printer</h1>
            {(metaParts.length > 0 || printerStats) && (
              <p style={{ color: 'var(--fg-muted)', fontSize: 14 }}>
                {metaParts.join(' · ')}
                {printerStats && (
                  <>
                    {metaParts.length > 0 && ' · '}
                    <Link
                      to="/myprinter/message-history"
                      style={{ color: 'inherit', textDecoration: 'none' }}
                      onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                      onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
                    >
                      {printerStats.total} messages · {printerStats.printed} printed
                    </Link>
                  </>
                )}
              </p>
            )}
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={handleSignOut}>
            Sign Out
          </button>
        </div>
        {children}
      </div>
    </section>
  );
}
