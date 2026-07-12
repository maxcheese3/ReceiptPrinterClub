# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions correspond to feature branches merged into the refactor lineage.

---

## [3.1.0] - 2026-07-12 — `refactor/ux-ui-v2`

### Added

- **Printer Directory** — new `/directory` page listing all registered printers as cards showing name, online/offline status, description, location, and column/font-size spec. Clicking a card opens the Send Message page with that printer pre-selected. A "Select Multiple" mode lets users tick several printers at once and navigate directly to Send Message with all of them pre-selected via the `?to=` URL parameter.
- **Directory nav item** — "Directory" added to the hamburger navigation menu between "Send Message" and "About".

---

## [3.0.1] - 2026-07-12 — `refactor/ux-ui-v2`

### Fixed

- **Theme picker** — separated user-selectable themes (`Theme`) from CSS-applied themes (`CSSTheme`). `hellokitty-light` and `hellokitty-dark` are no longer stored in `localStorage` or included in the `Theme` type; only the encompassing `hellokitty` meta-theme is stored. Adds a one-time migration that upgrades any stale `hellokitty-light`/`hellokitty-dark` localStorage values to `hellokitty`. Fixes carousel `indexOf` returning `-1` for persisted variants, which broke prev/next navigation and the dot indicator.

---

## [3.0.0] - 2026-07-10 — `refactor/ux-ui-v2`

Overhaul of the UX and UI frontend experience.

### Added

**Send page (v2)**
- New `SendMessageV2` page as the primary send interface at `/send-message`
- Text and ASCII Art tabs with shared textarea; ASCII mode disables word wrap for accurate column counting
- Inline To/From field layout with `PrinterMultiSelect` component
- Advanced options panel (font size, word wrap toggle) behind a collapsible "Aa" button
- Drag-and-drop image attachment zone with live preview
- Webcam capture support (falls back to file picker on mobile and unsupported browsers)
- B&W dithering panel with selectable algorithm (none, ordered Bayer 4×4, Floyd-Steinberg, Atkinson), brightness, contrast, and threshold sliders
- Per-line column counter in ASCII Art mode keyed to the narrowest selected printer
- `PrintConfirmModal` — themed success/error overlay after each print attempt, auto-dismisses on success

**Navigation**
- Hamburger menu in the header replaces footer navigation tabs
- Dropdown nav with animated open/close, backdrop dismiss, and keyboard accessibility
- Section dividers and Theme entry in the nav menu
- Proper URLs/routing for all the respective pages

**My Printer menus**
- Rebranded from "Printer Admin" to be more distinguished from Super Admin
- Dedicated pages for `PrinterSettings`, `PrinterMessageHistory`, and `PrinterSubscriptions` and `PrinterLogin`
- Routes restructured under `/myprinter/*`
- `PrinterPageLayout` shared wrapper for all my printer views
- `PrinterAuthContext` for my printer session management

**Persistence**
- Auth tokens stored in `localStorage` (survives page refresh)
- All send-form inputs persisted across sessions: sender name, font size, active tab (text/ASCII), word wrap toggle, dither method, grayscale toggle, and selected printers
- formerly a `sessionStorage` approach

**Dev tooling**
- `docker-compose.dev.yml` for hot-reload frontend development
- `docker-compose.local.yml` for full local stack testing without Cloudflare Tunnel; exposes server ports 3000 and 2525 directly
- `Makefile` with `up`, `down`, `rebuild`, and `logs` targets; extended with `build-server`, `deploy-server`, `logs-server`, `start-local`, `stop-local`, `restart-local`, `build-local-server`, `deploy-local-server`, and `logs-local-*` targets
- `CONTRIBUTING.md` frontend development guide, updated to document both dev and local-stack workflows

**About page**
- About page (`/about`) with project credits and links to the GitHub repo and API Docs; added to the nav menu

**Change log**
- Changelog.md to track changes for each release (this file)
- Version number & footer is added with link to changelog in github

**Theme system**
- `ThemePickerModal` — carousel-style theme switcher accessible from the nav menu
- Seven named themes: **Dark**, **Light**, **Rush** (industrial courier), **Beans** (cozy terracotta), **Shrek** (swamp lord), **TriMet** (Portland transit), **Hello Kitty** (matches system dark/light mode)
- System theme option that follows `prefers-color-scheme` and reacts to OS changes at runtime
- Custom SVG printer icon replaces the emoji favicon; matches the header logo and updates dynamically when the active theme changes
- Selected theme persisted in `localStorage`

**Claude rules**
- Add `CLAUDE.md` to implement rules for Claude

### Fixed
- UI optimization for mobile users
- Minor theme tweaks and font size adjustments for accessibility 
- Autofill re-enabled on login forms (was broken by earlier styling changes)
- Feed URLs on the Subscriptions page no longer overflow the viewport width
- iPhone auto-zoom prevented by ensuring form inputs meet the 16 px font-size minimum
- Double padding removed from card layout on mobile viewports

### Changed
- Root `/` now redirects to `/send-message`; legacy `/send` route retained
- `/subscriptions` and `/printer-admin` issue permanent redirects to new paths
- Super admin login split into a dedicated `/admin/login` route; previously co-located inside `/admin`
- Makefile targets renamed for clarity: `build` → `build-frontend`, `deploy` → `deploy-frontend`
- All component CSS completed — hamburger button, header dropdown, `PrinterMultiSelect`, `SendMessageV2` layout, `ThemePickerModal`, and `PrintConfirmModal` were missing from the stylesheet and are now fully styled against the design token system

---

## [2.0.0] - 2026-06-25 — `refactor/rewire-frontend-vite-react`

### Changed
- **Each section of the app now has its own URL** — replacing the old single-page tab layout, every view is now a dedicated route (`/send`, `/register`, `/docs`, `/admin`, `/subscriptions`, `/printer-admin`). Deep linking, browser history, and back/forward navigation all work as expected.
- Replaced legacy vanilla JS/CSS frontend with Vite + React + TypeScript
- Added `docker-compose.dev.yml` for hot-reload development environment
