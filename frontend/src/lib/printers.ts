import type { Printer } from '../types/api';

const STORAGE_KEY = 'printbridge_selected_printers';

/** Printers the sender last picked on the send page, saved on this device. */
export function loadSavedIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function saveIds(ids: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

export function printerStatusText(printer: Printer): { online: boolean; label: string } {
  if (!printer.last_seen) {
    return { online: false, label: '⚫ Not yet connected' };
  }
  // A paused printer is still checking in, but nothing will print until its
  // owner resumes it, so it shows as offline.
  if (printer.paused) {
    return { online: false, label: '⚫ Offline' };
  }
  const diff = Date.now() - new Date(printer.last_seen + 'Z').getTime();
  const minutes = Math.floor(diff / 60_000);
  const online = minutes < 6;
  const when = minutes < 1 ? 'just now' : minutes === 1 ? '1 min ago' : `${minutes} min ago`;
  return {
    online,
    label: online ? '🟢 Online' : `⚫ Last seen ${when}`,
  };
}

/** Which print client a printer runs, or null if it has never connected. */
export function clientLabel(printer: { last_seen?: string; client_version?: string | null }): string | null {
  if (!printer.last_seen) return null;
  return printer.client_version ? `Client ${printer.client_version}` : 'Old client';
}
