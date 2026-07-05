# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions correspond to feature branches merged into the refactor lineage.

---

## [3.0.0] - 2026-07-05 — `refactor/ux-ui-v2`

Consolidates the prior `feat/ux-ui-enhancements` branch lineage into a single
cohesive UX/UI refactor. All component CSS was completed and verified in this
pass — the UI is now fully styled end-to-end.

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

**Theme system**
- `ThemePickerModal` — carousel-style theme switcher accessible from the nav menu
- Six named themes: **Dark**, **Light**, **Rush** (industrial courier), **Beans** (cozy terracotta), **Shrek** (swamp lord), **TriMet** (Portland transit)
- System theme option that follows `prefers-color-scheme` and reacts to OS changes at runtime
- Selected theme persisted in `localStorage`

**Navigation**
- Hamburger menu in the header replaces footer navigation tabs
- Dropdown nav with animated open/close, backdrop dismiss, and keyboard accessibility
- Section dividers and Theme entry in the nav menu

**Printer admin**
- Dedicated pages for `PrinterSettings`, `PrinterMessageHistory`, and `PrinterSubscriptions`
- Routes restructured under `/myprinter/*`
- `PrinterPageLayout` shared wrapper for all printer admin views
- `PrinterAuthContext` for printer admin session management
- `PrinterLogin` component

**Printer multi-select**
- `PrinterMultiSelect` pill-based dropdown with live search
- Online/offline status indicator per printer
- Selected printers shown as removable pills; persisted across sessions via `localStorage`

**Persistence**
- Auth tokens stored in `localStorage` (survives page refresh)
- All send-form inputs persisted across sessions: sender name, font size, active tab (text/ASCII), word wrap toggle, dither method, grayscale toggle, and selected printers

**Dev tooling**
- `docker-compose.dev.yml` for hot-reload frontend development
- `Makefile` with `up`, `down`, `rebuild`, and `logs` targets
- `CONTRIBUTING.md` frontend development guide

### Changed
- Root `/` now redirects to `/send-message`; legacy `/send` route retained
- `/subscriptions` and `/printer-admin` issue permanent redirects to new paths
- All component CSS completed — hamburger button, header dropdown, `PrinterMultiSelect`, `SendMessageV2` layout, `ThemePickerModal`, and `PrintConfirmModal` were missing from the stylesheet and are now fully styled against the design token system

---

## [2.0.0] - 2026-06-25 — `refactor/rewire-frontend-vite-react`

### Changed
- **Each section of the app now has its own URL** — replacing the old single-page tab layout, every view is now a dedicated route (`/send`, `/register`, `/docs`, `/admin`, `/subscriptions`, `/printer-admin`). Deep linking, browser history, and back/forward navigation all work as expected.
- Replaced legacy vanilla JS/CSS frontend with Vite + React + TypeScript
- Added `docker-compose.dev.yml` for hot-reload development environment
