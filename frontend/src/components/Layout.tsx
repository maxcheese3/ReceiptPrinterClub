import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import NavMenu from './NavMenu';
import type { Theme } from '../hooks/useTheme';

interface LayoutProps {
  children: React.ReactNode;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
}

export default function Layout({ children, theme, onThemeChange }: LayoutProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

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
              <NavMenu onNavigate={() => setMenuOpen(false)} />
            </div>
          </>
        )}
      </header>

      <main>{children}</main>

      <footer>
        <div className="theme-picker">
          {(['dark', 'light', 'rush', 'beans', 'shrek', 'transit'] as const).map((t) => {
            const labels: Record<string, string> = {
              dark: '🌑', light: '☀️', rush: '🚲', beans: '🫘', shrek: '🧅', transit: '🚌',
            };
            const titles: Record<string, string> = {
              dark: 'Dark Mode', light: 'Light Mode', rush: 'Premium Rush',
              beans: 'Beans', shrek: 'Shrek', transit: 'Public Transit',
            };
            return (
              <button
                key={t}
                className={`theme-btn${theme === t ? ' active' : ''}`}
                data-theme={t}
                title={titles[t]}
                onClick={() => onThemeChange(t)}
              >
                {labels[t]}
              </button>
            );
          })}
        </div>
      </footer>
    </>
  );
}
