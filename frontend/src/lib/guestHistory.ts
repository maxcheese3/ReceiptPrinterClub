/**
 * Guest "messages I sent" history — localStorage backed.
 *
 * Guests have no account and no server-side identity, so there's nowhere on the
 * server to hang their history off. localStorage gives us per-device persistence
 * across sessions, which is what we want.
 *
 * Two deliberate constraints:
 *
 * 1. We store an image *reference* (`image_path`), never the image bytes.
 *    localStorage caps out around 5MB; a single base64 photo can be 2MB+, so
 *    storing bytes would blow the quota after a couple of sends. Thumbnails are
 *    rendered from the server at /uploads/<image_path> instead. Trade-off: if
 *    the server ever prunes old uploads, an old thumbnail 404s. Text is
 *    unaffected, and the alternative (bytes in localStorage) breaks much sooner.
 *
 * 2. The list is capped (MAX_ENTRIES) and trimmed oldest-first. Without a cap,
 *    a heavy user eventually hits the quota, and *every* subsequent write throws
 *    — silently breaking sends if we didn't also catch. We cap, and we catch.
 *
 * Once a user logs in to a printer, the server keeps their sent history instead
 * (see /api/printer-admin/sent) — this module is only used for logged-out sends.
 */

import type { GuestSentMessage } from '../types/api';

const STORAGE_KEY = 'printbridge_guest_sent';
const MAX_ENTRIES = 100;

/** Read the full guest history, newest first. Never throws. */
export function getGuestHistory(): GuestSentMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Guard against hand-edited / corrupted storage.
    return (parsed as GuestSentMessage[]).filter(
      (m) => m && typeof m.id === 'string' && typeof m.created_at === 'string'
    );
  } catch {
    return [];
  }
}

function write(entries: GuestSentMessage[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded (or storage disabled, e.g. private browsing). Drop the
    // oldest half and retry once — better to keep recent history than to lose
    // all of it. If it still fails, give up silently: history is a convenience
    // and must never break the actual send.
    try {
      const half = entries.slice(0, Math.floor(entries.length / 2));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(half));
    } catch {
      /* storage unavailable — proceed without history */
    }
  }
}

/** Prepend a sent message. Returns the updated list. */
export function addGuestMessage(entry: GuestSentMessage): GuestSentMessage[] {
  const next = [entry, ...getGuestHistory()].slice(0, MAX_ENTRIES);
  write(next);
  return next;
}

/** Remove a single entry by id. */
export function removeGuestMessage(id: string): GuestSentMessage[] {
  const next = getGuestHistory().filter((m) => m.id !== id);
  write(next);
  return next;
}

/** Wipe all guest history on this device. */
export function clearGuestHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing we can do */
  }
}
