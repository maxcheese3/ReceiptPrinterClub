/**
 * Saved FROM names for the send page — localStorage backed, per device.
 *
 * The FROM box still takes free text; this is just a list of names you've
 * chosen to keep (e.g. "Damon", "Dad", "The Jones House") so you can switch
 * between them without retyping. The FROM currently in the box is stored
 * separately under printbridge_sender_name, as before.
 */

import type { ThreadMessage } from '../types/api';

const STORAGE_KEY = 'printbridge_saved_froms';
const CURRENT_KEY = 'printbridge_sender_name';
const MAX_LENGTH  = 100; // matches the FROM input's maxLength

/** Read the saved list. Never throws. On first use it starts with whatever
 *  FROM was already in the box, so existing users don't begin with nothing. */
export function getSavedFroms(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      const current = localStorage.getItem(CURRENT_KEY)?.trim();
      const seed = current ? [current] : [];
      write(seed);
      return seed;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is string => typeof n === 'string' && n.trim() !== '');
  } catch {
    return [];
  }
}

function write(names: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
  } catch {
    /* storage unavailable — the picker just won't remember */
  }
}

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function isSavedFrom(names: string[], name: string): boolean {
  return names.some((n) => same(n, name));
}

/** Add a name (trimmed, ignoring case for duplicates). Returns the updated list. */
export function addSavedFrom(name: string): string[] {
  const clean = name.trim().slice(0, MAX_LENGTH);
  const names = getSavedFroms();
  if (!clean || isSavedFrom(names, clean)) return names;
  const next = [...names, clean];
  write(next);
  return next;
}

/** Remove a name. Returns the updated list. */
export function removeSavedFrom(name: string): string[] {
  const next = getSavedFroms().filter((n) => n !== name);
  write(next);
  return next;
}

// What the server prints when a logged-in user leaves FROM blank: their IP
// (IPv4, IPv4-mapped IPv6, or IPv6 with at least two colons). Not something to
// put back in the box.
const IP_LIKE = /^(::ffff:)?(\d{1,3}\.){3}\d{1,3}$|^[0-9a-f]*:[0-9a-f]*:[0-9a-f:]*$/i;

/**
 * The FROM you last used when sending to this printer, read from your thread
 * with it (newest first), or null if there isn't a usable one. Uses the server
 * rather than this device, so it works for messages sent from anywhere.
 */
export async function lastFromTo(
  authFetch: (path: string) => Promise<Response>,
  printerId: string,
): Promise<string | null> {
  try {
    const res = await authFetch(`/api/printer-admin/thread?counterparty_id=${encodeURIComponent(printerId)}`);
    const data = await res.json() as { messages?: ThreadMessage[] };
    const last = (data.messages ?? []).find((m) => m.direction === 'out');
    const name = last?.sender_name?.trim();
    if (!name || name === 'Anonymous' || IP_LIKE.test(name)) return null;
    return name;
  } catch {
    return null;
  }
}
