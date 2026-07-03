# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions correspond to feature branches merged into the refactor lineage.

---

## [2.4.0] - 2026-06-29 — `feat/dev-tools-changelog`

### Added
- `Makefile` with commands for starting, stopping, rebuilding, and deploying the dev stack (currently focused on frontend)
- `CONTRIBUTING.md` with frontend development guide
- `CHANGELOG.md` (this file)

---

## [2.3.0] - 2026-06-29 — `feat/persist-user-prefs-localstorage`

### Changed
- Auth tokens now stored in `localStorage` instead of `sessionStorage` so sessions survive page refreshes
- Sender name and font size preferences persisted in `localStorage` across sessions

---

## [2.2.0] - 2026-06-26 — `feat/ux-nav-mobile-improvements`

### Added
- New `SendMessageV2` page as the primary send interface at `/send-message`. Original page is still live at `/send`
- Slicker `PrinterMultiSelect` component for selecting multiple printers 

### Changed
- Navigation links updated to point to new routes
- Mobile layout improvements across components

---

## [2.1.0] - 2026-06-26 — `feat/ux-menu-improvements`

### Added
- Broke out printer admin pages into seperate pages: `PrinterSettings`, `PrinterMessageHistory`, and `PrinterSubscriptions`
- Printer admin routes live under `/printer/*`
- `PrinterPageLayout` shared wrapper for printer admin views
- `PrinterAuthContext` for printer admin authentication


### Changed
- Replaced footer navigation tabs with hamburger menu in the header

---

## [2.0.0] - 2026-06-25 — `refactor/rewire-frontend-vite-react`

### Changed
- **Each section of the app now has its own URL** — replacing the old single-page tab layout, every view is now a dedicated route (`/send`, `/register`, `/docs`, `/admin`, `/subscriptions`, `/printer-admin`). Deep linking, browser history, and back/forward navigation all work as expected.
- Replaced legacy vanilla JS/CSS frontend with Vite + React + TypeScript
- Added `docker-compose.dev.yml` for hot-reload development environment
