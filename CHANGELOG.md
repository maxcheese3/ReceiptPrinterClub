# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions correspond to feature branches merged into the refactor lineage.

---

## [3.2.1] - 2026-10-28 — `fix/printer-history-auth`

### Fixed

- **Printer message history privacy** — removed the unauthenticated `GET /api/messages/:printer_id/recent` route. Anyone who knew (or looked up) a printer ID could read that printer's 50 most recent messages, including bodies, sender names and emails, image paths, and delivery status. Printer owners continue to access their own history through the API-key-protected `/api/printer-admin/*` routes.
- **SSRF via server-side fetches** — `image_url`, OAuth token endpoints, and RSS/Atom feed/image URLs now reject localhost, private, link-local, and reserved addresses, including on redirects and at DNS-connect time. Non-image fetch results are no longer left behind in `/uploads`.
- **Rate-limit bypass** — any request with a non-empty `X-API-Key` header used to skip message rate limiting even when the key was invalid. Only a key that resolves to a real printer raises the ceiling (to 120/60s, configurable); it is no longer unlimited.
- **Admin login brute force** — failed admin logins are limited to 10 per 15 minutes per IP.
- **Printer registration flooding** — registrations are limited to 5 per hour per IP.
- **Feed polling resource limits** — feed documents and images have size caps, redirects are bounded, and each poll processes at most 50 new items. The per-subscription "Fetch now" action now polls only that feed instead of triggering every subscription.
- **Retired printers via SMTP** — the exact-ID email lookup now excludes soft-deleted printers, matching the web/API send paths.
- **Invalid image uploads** — files that cannot be decoded as images are rejected (400) and removed instead of being stored.
- **Proxy trust** — `TRUST_PROXY=0` now actually disables proxy trust (previously it was coerced to `1`, making client IPs spoofable through `X-Forwarded-For` in local/dev setups).
- **Sender-name fallback** — unnamed web messages now use Express's trusted `req.ip` instead of reading `X-Forwarded-For` directly, so a spoofed header cannot control the printed "From:" value.
- **Error detail leakage** — `POST /api/messages` no longer returns raw exception strings in production (they remain available when `NODE_ENV` is not `production`).
- **Dependency advisories** — refreshed the server lockfile to pick up patched `proxy-addr` (critical IP-spoofing), `body-parser`, `mailparser`/`nodemailer`, `morgan`, and `smtp-server` versions, and upgraded `sharp` to 0.35.5 for the libvips/libheif/librsvg fixes.

### Changed

- **API rate limiting** — all `/api` routes now have a broad per-IP limit (default 300/60s), with valid printer API keys exempt. The README's rate-limit table now matches the implementation.
- **Private-network integrations** — if you intentionally fetch images/OAuth tokens/feeds from a private network, set `ALLOW_PRIVATE_NETWORK_FETCH=1`.
- **Default admin password** — the server logs a warning at startup if `ADMIN_PASSWORD` is missing or still `changeme`.
- **Server container user** — the server image now runs as an unprivileged `printbridge` user instead of root.
- **Remaining dependency advisories** — the `uuid` 9 advisory only affects v3/v5/v6 with a caller-provided buffer (this project uses v4 only); one `qs` advisory requires an Express 5 upgrade.

---

## [3.2.0] - 2026-07-13 — `feat/online-printers-badge`

### Changed

- **Printer Directory** — cards now display in 2 columns on mobile; name scales down to 20px on narrow screens.  added word-wrap for description and location

### Added

- **Online printer badge** — compact "X online" pill in the header bar, to the left of the hamburger button. Shows a pulsing green dot when at least one printer is active; links to the Directory page. Refreshes every 10 seconds.

---

## [3.1.1] - 2026-07-13 — `refactor/ux-ui-v2`

### Fixed

- **Printer selector** — options in `PrinterMultiSelect` are now alphabetized.
- **Default font size** — send form now defaults to 12pt instead of 9pt.
- **Advanced options toolbar** — compacted layout; fixes wrapping on mobile.
- **TO selector** — increased font size to match page body text.

### Changed

- **Build output** — removed legacy v1 static files (`index.html`, `style.css`, `app.js`) from the repo; `server/public/` is now gitignored as it is populated by `npm run build` in `frontend/`.

---

## [3.1.0] - 2026-07-12 — `refactor/ux-ui-v2`

### Added

- **Printer Directory** — new `/directory` page listing all registered printers as cards showing name, online/offline status, description, location, and column/font-size spec. Clicking a card opens the Send Message page with that printer pre-selected. A "Select Multiple" mode lets users tick several printers at once and navigate directly to Send Message with all of them pre-selected via the `?to=` URL parameter.

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
