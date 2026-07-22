export interface Printer {
  id: string;
  name: string;
  description?: string;
  location?: string;
  columns: number;
  font_size: number;
  last_seen?: string;
  /** SQLite integer boolean: 0 or 1. Always test by truthiness, never `=== false`. */
  active?: number | boolean;
  /** SQLite integer boolean: 0 or 1. Always test by truthiness, never `=== false`. */
  hidden?: number | boolean;
}

export interface Message {
  id: string;
  printer_id: string;
  printer_name?: string;
  sender_name?: string;
  body?: string;
  image_path?: string;
  word_wrap: number;
  font_size: number;
  source: 'web' | 'api' | 'email';
  status: 'pending' | 'printing' | 'printed' | 'failed';
  created_at: string;
}

/** 'in' = received by me, 'out' = sent by me. */
export type Direction = 'in' | 'out';

/** A conversation. Two kinds:
 *  - kind 'printer': two-sided exchange with another registered printer.
 *  - kind 'guest':   one-sided messages from someone with no printer (no reply channel). */
export interface Thread {
  kind: 'printer' | 'guest';
  counterparty_id: string | null;
  counterparty_name: string | null;
  sender_name: string | null;
  message_count: number;
  latest_at: string;
  latest_body?: string;
  latest_image?: string;
  latest_direction: Direction;
}

/** A message inside a thread, tagged with which way it went. */
export interface ThreadMessage extends Message {
  direction: Direction;
}

/** A recent message in either direction. counterparty_name is the other party:
 *  the recipient for a sent message, the sender for a received one. */
export interface RecentMessage extends Message {
  direction: Direction;
  counterparty_name: string | null;
}

/** A message the logged-in printer owner SENT to another printer.
 *  recipient_name is null if that printer has since been deleted. */
export interface SentMessage extends Message {
  recipient_name: string | null;
}

export interface SentStats {
  total: number;
  printed: number;
  failed: number;
  pending: number;
  recipients: number;
}

/** A guest's locally-stored record of a message they sent.
 *  Kept in localStorage since guests have no server-side identity.
 *  Only an image *reference* is stored (not the bytes) — see lib/guestHistory.ts. */
export interface GuestSentMessage {
  id: string;
  printer_id: string;
  printer_name: string;
  sender_name?: string;
  body?: string;
  image_path?: string;
  created_at: string;
  status: 'sent' | 'failed';
  error?: string;
}

export interface Subscription {
  id: string;
  name: string;
  feed_url: string;
  feed_type: 'rss' | 'xkcd';
  active: boolean;
  last_checked?: string;
  last_item_id?: string;
}

export interface AdminStats {
  total: number;
  printed: number;
  failed: number;
  pending: number;
  printing: number;
  from_web: number;
  from_api: number;
  from_email: number;
}

export interface PrinterStats {
  total: number;
  pending: number;
  printed: number;
  failed: number;
  from_web: number;
  from_api: number;
  from_email: number;
}

/** Lightweight activity counters shown on the public directory. */
export interface PublicStats {
  delivered: number;
  this_week: number;
  today: number;
}
