import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/send',          label: 'Send Message' },
  { to: '/register',      label: 'Register Printer' },
  { to: '/docs',          label: 'API Docs' },
  { to: '/admin',         label: '⚙ Super Admin' },
  { to: '/subscriptions', label: '📡 Subscriptions' },
  { to: '/printer-admin', label: '🖨️ Printer Admin' },
];

export default function NavFooter() {
  return (
    <nav id="footer-nav">
      {NAV_ITEMS.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
