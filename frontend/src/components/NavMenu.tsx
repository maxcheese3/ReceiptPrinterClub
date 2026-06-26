import { NavLink, useNavigate } from 'react-router-dom';
import { usePrinterAuth } from '../contexts/PrinterAuthContext';

const PUBLIC_ITEMS = [
  { to: '/send',  label: 'Send Message' },
  { to: '/docs',  label: 'API Docs' },
  { to: '/admin', label: 'Admin' },
];

const PRINTER_ITEMS = [
  { to: '/printer/settings',        label: 'Settings' },
  { to: '/printer/message-history', label: 'Message History' },
  { to: '/printer/subscriptions',   label: 'Subscriptions' },
];

interface NavMenuProps {
  onNavigate?: () => void;
}

export default function NavMenu({ onNavigate }: NavMenuProps) {
  const { apiKey, logout } = usePrinterAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    onNavigate?.();
    navigate('/send');
  }

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
          <div className="nav-menu-divider" />
          <button className="nav-tab nav-menu-logout" onClick={handleLogout}>
            Sign Out
          </button>
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
            to="/printer/login"
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
