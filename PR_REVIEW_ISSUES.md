# PR #6 Review — `refactor/ux-ui-v2`

Review of PR #6: **refactor: UX/UI v2 overhaul — version 3.0.0**

---

## Critical

### ~~1. `useAdminAuth.ts` — 403 not handled, admin auto-logout broken~~ ✓ Fixed

`authFetch` only logs out on `401`, but the server's admin middleware can return `403`. Compare with `useApiKeyAuth` which correctly handles both. Silent failure means the admin page won't redirect to `/admin/login` when the token is invalidated.

**File:** `frontend/src/hooks/useAdminAuth.ts`

```ts
// Current — only 401 is caught
if (res.status === 401) { logout(); … }

// useApiKeyAuth.ts does this correctly:
if (res.status === 401 || res.status === 403) { logout(); … }
```

---

### ~~2. `SendMessageV2.tsx:259-262` — `handlePaste` useEffect missing dependency array~~ ✓ Fixed

Without a dependency array the effect fires after every render, re-registering the paste listener on every state change (including every slider move for brightness/contrast/threshold).

**File:** `frontend/src/pages/SendMessageV2.tsx` lines 259–262

```ts
// Current — runs on every render
useEffect(() => {
  document.addEventListener('paste', handlePaste as EventListener);
  return () => document.removeEventListener('paste', handlePaste as EventListener);
});

// Fix: useCallback on handlePaste with proper deps, then [handlePaste] as effect dep
```

---

### ~~3. `ThemePickerModal.tsx:61-68` — Carousel nav broken for persisted `hellokitty-light`/`hellokitty-dark`~~ ✓ Fixed

`CAROUSEL_THEMES` contains `'hellokitty'` but `useTheme`'s `THEMES` constant stores `'hellokitty-light'` and `'hellokitty-dark'`. If either variant is persisted in `localStorage`, `indexOf` returns `-1`, and prev/next calculations wrap to the wrong theme. No dot is active in the indicator.

**File:** `frontend/src/components/ThemePickerModal.tsx` lines 61–68

---

## Warning

### 4. `SuperAdmin.tsx` — `PrinterRow` state not resynced after parent re-fetches

Local state (`name`, `columns`, `fontSize`, etc.) is initialised from the `printer` prop once. After a save triggers `loadPrinters()`, the parent re-renders with fresh server data but the child's inputs still show pre-save values.

**File:** `frontend/src/pages/SuperAdmin.tsx` lines 258–263

---

### 5. Multiple files — eslint-disable on exhaustive-deps suppresses real issues

`useEffect` calls in `SuperAdmin.tsx`, `PrinterAuthContext.tsx`, and `PrinterMessageHistory.tsx` suppress `// eslint-disable-line` on exhaustive-deps rather than fixing the stale-closure issue. Fragile if `loadMessages` reset logic changes.

**Files:**
- `frontend/src/pages/SuperAdmin.tsx`
- `frontend/src/context/PrinterAuthContext.tsx`
- `frontend/src/pages/PrinterMessageHistory.tsx`

---

### 6. `SendMessageV2.tsx:507-508` — type-cast `KeyboardEvent` as `MouseEvent`

```tsx
onKeyDown={(e) => { if (e.key === 'Enter') startWebcam(e as unknown as React.MouseEvent); }}
```

`startWebcam` is typed to accept `React.MouseEvent`. Fix: accept `React.SyntheticEvent`, or call `e.preventDefault()` inline and make `startWebcam` take no argument.

**File:** `frontend/src/pages/SendMessageV2.tsx` lines 207, 507–508

---

### 7. `SendMessageV2.tsx:113` — `isMobile` UA sniff misidentifies iPadOS 13+

The regex matches `iPad` but iPadOS 13+ reports a desktop Safari UA. `isMobile` is also computed in two different places (`line 113` and inside `startWebcam`) with no guarantee of consistency.

**File:** `frontend/src/pages/SendMessageV2.tsx` line 113

---

### 8. `PrinterSettings.tsx` — `font_size` not editable from My Printer

The column counter in `SendMessageV2` depends on `colsForFontSize(p.font_size, p.columns)`. Printer owners can't change `font_size` from `/myprinter`, so the column counter can be inaccurate without a Super Admin fix.

**File:** `frontend/src/pages/PrinterSettings.tsx`

---

### 9. `useApiKeyAuth.ts:23-24` — hardcoded `Content-Type: application/json` breaks future `FormData` uploads

Setting `Content-Type` before `opts.headers` spread means future `authFetch` calls with `FormData` will corrupt the multipart boundary unless callers remember to explicitly override it.

**File:** `frontend/src/hooks/useApiKeyAuth.ts` lines 23–24

---

### 10. `PrinterLoginPage.tsx:10-14` — redundant `useEffect` redirect

Both a synchronous `<Navigate>` guard and a `useEffect` redirect fire when `apiKey` is truthy. The `useEffect` is dead code.

**File:** `frontend/src/pages/PrinterLoginPage.tsx` lines 10–14

---

### 11. `SuperAdmin.tsx:61` — `filterPrinter` not URL-encoded before interpolation

```ts
`&printer_id=${filterPrinter}`
```

UUIDs are safe in practice, but should use `encodeURIComponent(filterPrinter)` for correctness.

**File:** `frontend/src/pages/SuperAdmin.tsx` line 61

---

## Info

### ~~12. `style.css` — Duplicate CSS blocks left over from refactor~~ ✓ Fixed

The following classes are defined twice (second definition wins):
- `.drop-zone` — second definition drops `position: relative`, affecting overlay children
- `.drop-zone.drag-over`
- `.drop-zone-preview` and `.drop-zone-preview img`
- `.remove-image` and `.remove-image:hover`
- `.char-count-row`

**File:** `frontend/src/assets/style.css`

---

### 13. `useImageResize.ts:22`, `SendMessageV2.tsx:238` — `canvas.getContext('2d')!` non-null assertion

Can throw a `TypeError` if the browser's 2D context limit is reached. `useDithering.ts` correctly wraps the equivalent call in `try/catch`; these two locations should match.

**Files:**
- `frontend/src/hooks/useImageResize.ts` line 22
- `frontend/src/pages/SendMessageV2.tsx` line 238

---

### 14. Shared localStorage keys between `SendMessage.tsx` and `SendMessageV2.tsx`

Both pages use `'printbridge_sender_name'` and `'printbridge_font_size'`. Writes from the legacy `/send` route silently overwrite values used by `/send-message`. Either document as intentional or namespace the v2 keys (e.g. `_v2` suffix, like `GRAYSCALE_KEY` already does).

**Files:**
- `frontend/src/pages/SendMessage.tsx` lines 10–11
- `frontend/src/pages/SendMessageV2.tsx` lines 13–14

---

### 15. `PrintConfirmModal.tsx` — no explicit close button on success state

Success overlay only dismisses via backdrop click, Escape key, or 5-second auto-timer. Screen reader users relying on a focusable close button won't find one in the success state.

**File:** `frontend/src/components/PrintConfirmModal.tsx` lines 71–75

---

### 16. `useTheme.ts:15` — System light mode resolves to `shrek`

```ts
return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'shrek';
```

A user with OS light mode who selects "Match System" gets the Shrek theme. Appears intentional (UI discloses this), but worth confirming.

**File:** `frontend/src/hooks/useTheme.ts` line 15

---

### 17. `ThemePickerModal.tsx:42` — `originalTheme` ref pattern is fragile

`useRef<Theme>(theme)` captures the theme at mount. Safe while the modal unmounts between openings, but if it ever becomes persistently mounted, cancel will revert to a stale value.

**File:** `frontend/src/components/ThemePickerModal.tsx` line 42

---

## Not an issue

- **Version sync** — `frontend/src/version.ts` and `CHANGELOG.md` both show `3.0.0`. ✓
