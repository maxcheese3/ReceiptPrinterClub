import { NavLink } from 'react-router-dom';
import { usePrinterAuth } from '../contexts/PrinterAuthContext';

const PUBLIC_ITEMS = [
  { to: '/send-message', label: 'Send Message' },
  { to: '/about', label: 'About' },
  { to: '/admin', label: 'Admin' },
  { to: '/docs',  label: 'API Docs' },
];

const PRINTER_ITEMS = [
  { to: '/myprinter/message-history', label: 'Message History' },
  { to: '/myprinter/subscriptions',   label: 'Subscriptions' },
];

interface NavMenuProps {
  onNavigate?: () => void;
  onOpenThemePicker?: () => void;
}

export default function NavMenu({ onNavigate, onOpenThemePicker }: NavMenuProps) {
  const { apiKey } = usePrinterAuth();

  return (
    <nav id="nav-menu">
      {PUBLIC_ITEMS.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}
          onClick={onNavigate}
        >
          {label}
        </NavLink>
      ))}
      <div className="nav-menu-divider" />

      <button
        className="nav-tab nav-tab-theme"
        onClick={() => {
          onNavigate?.();
          onOpenThemePicker?.();
        }}
      >
        Theme
      </button>
      <div className="nav-menu-divider" />

      {apiKey ? (
        <>
          {PRINTER_ITEMS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}
              onClick={onNavigate}
            >
              {label}
            </NavLink>
          ))}
          <NavLink
            to="/myprinter"
            className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}
            onClick={onNavigate}
          >
            My Printer
          </NavLink>
</>
      ) : (
        <>
          <NavLink
            to="/register"
            className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}
            onClick={onNavigate}
          >
            Register Printer
          </NavLink>
          <NavLink
            to="/myprinter"
            className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}
            onClick={onNavigate}
          >
            My Printer
          </NavLink>
        </>
      )}
    </nav>
  );
}
