# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions correspond to feature branches merged into the refactor lineage.

---

## [4.0.0] - 2026-11-13 — `refactor/unified-print-pipeline`

### Added

- **Printer sizes** — the send page's font size is now Small / Normal / Medium / Large / X-Large, the five sizes thermal printers actually have. The API still takes `font_size` in points and rounds to the nearest size (7, 9, 12, 17, 25); messages without one print at Normal, which is also the send page's default.
- **Big emoji** — a message that is just 1 to 3 emoji (spaces and line breaks allowed) prints at X-Large, whatever size the sender picked, like iMessage. Any other text, or markup such as `# 😀`, keeps the chosen size.
- **Formatting** — on the Text tab (and in API/email messages), four header styles: `# Heading` prints a double-line box one size larger than the message, `## Banner` prints white-on-black, `### Title` prints a `─── Title ───` divider, and `#### Subtitle` prints bold, underlined and centred. `---` prints a divider, and `**bold**` / `__underline__` work inline. The ASCII Art tab still prints exactly as typed.
- **Text alignment** — Left / Center / Right next to Size and Wrap on the send page (`align` in the API). On the ASCII Art tab the whole picture moves as one block so it stays intact; headings, banners, dividers and the From/Time block always keep their own layout.
- **Emoji pictures** — emoji print as small black-and-white images (from Noto Emoji, SIL Open Font License) using the printer's custom-character feature, sized with the text. Up to 47 different emoji per message.
- **Test page** — "Print test page" on My Printer (or `node client.js --test-page` in `client/`, with `--cols 42` to try a width before saving it) prints a ruler showing how many characters fit per line, an edge check, a sample of every size and style, and an emoji row.
- **My Printer settings** — Characters per line (32, 42, 48, or another number from the test page) and Emoji (Pictures, or text stand-ins like `<3` for printers without custom characters). The client picks both up on its next poll. Width is chosen by characters rather than paper size because 80mm printers vary: most fit 48, those with a narrower print area fit 42.
- **Client version on every printer** — the print client sends its version (`X-Client-Version`) with each poll, and printer info includes it as `client_version`. The directory shows "Client 4.0.0" or "Old client" on each printer that has connected, My Printer shows it under Printer Management (with a nudge to update an old client), and Super Admin has a Client column.
- **All tab** — My Printer › Messages opens on a combined, newest-first list of everything you've sent and received. The tabs are now All · Received · Sent · Threads.
- **Auto-refresh** — message history re-reads the tab you're on every 15 seconds while the page is visible, and again when you switch back to it or reopen the home-screen app. There's also a ↻ button. "Load More" survives a refresh.
- **Reply** — tap a message from a registered printer (in history or "Your recent messages") to expand it, then Reply. It addresses that printer and fills FROM with the name you last used when writing to them. Printer threads also have Reply in their header. Messages from guests have no Reply, since guests have no inbox.
- **Saved FROMs** — the FROM box has a ▾ list of saved names to pick from, remove, or add the one you've typed. You can still type straight into the box. Names are saved on this device; the first time, the list starts with the FROM you already had.
- **Refresh link** on "Your recent messages", which also refreshes itself every 15 seconds while it's open.
- **MU/TH/UR theme** — a green-phosphor ship's-computer terminal: VT323 type, glow, scanlines and a blinking cursor. Failures show in inverse video, and the cursor stops blinking under reduced motion.
- **Home-screen app** — Add to Home Screen on iOS gives a black "RPC" icon and opens full screen with a black status bar. There's a web manifest for Android too. Icons are rendered from `frontend/icons/app-icon.svg` by `frontend/scripts/build-icons.sh`.
- **`GET /api/printer-admin/recent`** takes `offset`, and `limit` now goes up to 200. Its rows include `sender_printer_name` and `recipient_name`. `GET /api/printer-admin/messages` rows include `sender_printer_name`.
- **`PRINT_MODE=driver`** (client) — prints through the OS driver for printers that ignore ESC/POS, such as the Star TSP100. Builds on the CUPS text mode from the `al-mac` branch: per-size cpi/lpi jobs, no cut between jobs, and image pages sized to the image.
- **Bluetooth printers** — documented: bind with `rfcomm` and set `PRINTER_DEVICE=/dev/rfcomm0`.

### Fixed

- **Font size ignored on Linux and macOS** — the ESC/POS path printed every message at the printer's base size; only the line wrapping changed. Sizes now use the printer's built-in fonts and multipliers.
- **Emoji and accented characters printed as garbage on Linux and macOS** — text was sent as 7-bit ASCII. It's now encoded in code page 437 (accents, £, °, box drawing); anything else is simplified (ō → o) or replaced.
- **Images cropped on 58mm printers (Linux/macOS)** — images were scaled to 456 dots, wider than the 384-dot printhead. They now use the printer's configured width.
- **Three print jobs and three cuts per image message** — a message is now one job with one cut.
- **Body lines starting with `Time:`, `From:` or `---` printed small on Windows** — the header was detected by pattern matching; it's now built separately from the body.
- **Conversation previews could show the wrong message** — when two messages in a conversation were sent in the same second, the preview could pick the older one. Ties now go to the message sent last.
- **Column counter didn't match the printer** — it assumed a 58mm printer and its own font table. It now uses the selected printer's width, counting emoji as two characters.
- **"No messages yet" flashed while history was loading** — the Received, All and Threads lists show "Loading…" until the first response arrives.

### Changed

- **One print pipeline on every OS** — Windows, macOS and Linux all send the same ESC/POS bytes, so receipts look identical. Windows now prints through the spooler as a RAW job (`print-raw.ps1`) instead of drawing text with GDI; the GDI path remains as `PRINT_MODE=driver`.
- **Printer width is a server setting** — stored per printer as `print_width_dots` (384 / 512 / 576 for 32 / 42 / 48 characters), migrated from the old `columns` value. The per-printer font size is removed.
- **Printer API responses** — `GET /api/printers`, `GET`/`PATCH /api/printer-admin/me`, registration and the Super Admin printer endpoints return `print_width_dots`, `emoji_mode` and `client_version` in one shape, and no longer include `columns` or `font_size`. Registration takes `print_width_dots` only. Integrations that read the old fields, such as mr-website-v2, need updating.
- **Space between a message and its picture** — a fixed 3mm gap separates the text from the image, the same at every text size. Driver mode on Windows prints it too; driver mode on macOS/Linux leaves it out.
- **Client `.env`** — removed `PRINT_COLUMNS`, `PRINT_FONT_SIZE`, `PRINT_WIDTH_MM`, `PRINT_DPI` and `PRINT_CUPS_MODE` (the client warns if they're still set). The client reads `.env` from its own folder, and `install-service.js` no longer copies `.env` values into the service — re-run it so edits to `.env` take effect.
- **Client dependencies** — the optional `canvas` package and the Docker `WITH_CANVAS` build option are gone; the client has no native dependencies. `client/print-linux.js` is replaced by `layout.js`, `escpos.js` and `output.js`.
- **Client version** — `client/package.json` carries the app version.
- **Legacy send page removed** — along with its printer checklist and styles. Old `/send` links still land on `/send-message`.
- **Message history hides formatting markers** — `#` headers, `---` dividers, `**bold**` and `__underline__` show as plain readable text in history, previews, the message pop-up and Super Admin, following the printer's rules: ASCII Art messages still show exactly as typed.
- **Message tiles** start with a SENT or RECEIVED chip, then "to Alice's Printer from Damon" or "from Damon (Damon's Printer)". The printer name appears when the sender was logged in. Print status stays top right, and the time moves to the bottom-right corner.
- **Threads** — an open conversation shows the newest message at the top. `GET /api/printer-admin/thread` returns newest first.
- **Theme picker** shows each theme's printer icon (the one in the browser tab) instead of an emoji.
- **Leftover upgrade help is tagged** `LEGACY(old-client)` in the code and docs, so it can be removed in one pass once every printer shows a new client. The unused `printers.columns` and `printers.font_size` database columns stay until then, so the server can still be rolled back.
- Removed `SentHistory.tsx`, an unused component replaced by "Your recent messages".

---

## [3.2.2] - 2026-10-06 — `fix/client-docker-timezone`

### Fixed

- **Client Docker image** — printed receipts and archived message timestamps showed UTC instead of the operator's local time when running via Docker on Linux, because the `node:20-alpine` base image has no `tzdata` package and no `TZ` env var set, so `toLocaleString()` fell back to UTC. Now installs `tzdata` in the image and documents a `TZ` env var in `.env.example`.

---

## [3.2.1] - 2026-09-21 — `fix/client-docker-uid-conflict`

### Fixed

- **Client Docker image** — build failed on the `node:20-alpine` base image because it already defines a `node` user/group at uid/gid 1000, conflicting with the Dockerfile's own `printbridge` user creation at the same id. Now reuses the base image's existing `node` user instead of creating a new one.
- **Client Docker image** — printing failed with `EACCES` writing to `/tmp/printbridge` because that directory was created by `root` before dropping to the non-root `node` user, which had no write access to it. Now `chown`'d to the container's runtime user at build time.

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
