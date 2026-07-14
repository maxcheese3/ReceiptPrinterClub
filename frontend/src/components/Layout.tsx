import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import NavMenu from './NavMenu';
import ThemePickerModal from './ThemePickerModal';
import Footer from './Footer';
import type { Theme } from '../hooks/useTheme';
import { usePrinters } from '../hooks/usePrinters';
import { printerStatusText } from './PrinterChecklist';

interface LayoutProps {
  children: React.ReactNode;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
}

export default function Layout({ children, theme, onThemeChange }: LayoutProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const { printers } = usePrinters();
  const onlineCount = printers.filter((p) => printerStatusText(p).online).length;

  return (
    <>
      <div className="bg-grid" />

      <header>
        <div className="header-inner">
          <div className="logo" style={{ cursor: 'pointer' }} onClick={() => navigate('/send-message')}>
            <svg className="logo-icon" viewBox="0 0 40 40" fill="none">
              <rect x="6" y="14" width="28" height="18" rx="3" fill="var(--accent)" opacity="0.15" />
              <rect x="6" y="14" width="28" height="18" rx="3" stroke="var(--accent)" strokeWidth="2" />
              <rect x="11" y="8" width="18" height="10" rx="2" fill="var(--bg)" stroke="var(--accent)" strokeWidth="2" />
              <rect x="14" y="26" width="12" height="8" rx="1.5" fill="var(--bg)" stroke="var(--fg-muted)" strokeWidth="1.5" />
              <circle cx="28" cy="22" r="2" fill="var(--accent)" />
            </svg>
            <span>ReceiptPrinterClub</span>
          </div>

          <Link
            to="/directory"
            className="online-count-badge"
            aria-label={`${onlineCount} printer${onlineCount !== 1 ? 's' : ''} online — view directory`}
          >
            {onlineCount > 0 && <span className="online-dot" />}
            <span>{onlineCount} online</span>
          </Link>

          <button
            className={`hamburger-btn${menuOpen ? ' open' : ''}`}
            aria-label="Toggle navigation menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>

        {menuOpen && (
          <>
            <div className="header-menu-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="header-menu-dropdown">
              <NavMenu
                onNavigate={() => setMenuOpen(false)}
                onOpenThemePicker={() => {
                  setMenuOpen(false);
                  setThemePickerOpen(true);
                }}
              />
            </div>
          </>
        )}
      </header>

      <main>{children}</main>

      <Footer />

      {themePickerOpen && (
        <ThemePickerModal
          theme={theme}
          onThemeChange={onThemeChange}
          onClose={() => setThemePickerOpen(false)}
        />
      )}
    </>
  );
}
