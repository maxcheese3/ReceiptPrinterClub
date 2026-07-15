const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "../../data");
const DB_PATH  = path.join(DATA_DIR, "db", "printbridge.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "uploads"), { recursive: true });

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS printers (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      description TEXT,
      location    TEXT,
      api_key     TEXT NOT NULL UNIQUE,
      active      INTEGER NOT NULL DEFAULT 1,
      hidden      INTEGER NOT NULL DEFAULT 0,
      columns     INTEGER NOT NULL DEFAULT 22,
      font_size   INTEGER NOT NULL DEFAULT 9,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen   TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id           TEXT PRIMARY KEY,
      printer_id   TEXT NOT NULL,
      source       TEXT NOT NULL CHECK(source IN ('web','email','api')),
      sender_name  TEXT,
      sender_email TEXT,
      body         TEXT,
      image_path   TEXT,
      word_wrap    INTEGER NOT NULL DEFAULT 1,
      font_size    INTEGER,
      status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','printing','printed','failed')),
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      printed_at   TEXT,
      error        TEXT,
      -- Which printer SENT this message (null for guests / unauthenticated sends).
      -- Distinct from printer_id, which is the RECIPIENT. sender_name is free text
      -- that anyone can type, so it can't be trusted as an identity — this column is
      -- set from a verified API key, which is why "sent history" can rely on it.
      sender_printer_id TEXT,
      FOREIGN KEY (printer_id)        REFERENCES printers(id),
      FOREIGN KEY (sender_printer_id) REFERENCES printers(id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_printer_status
      ON messages(printer_id, status, created_at);

    -- NOTE: the index on sender_printer_id is deliberately NOT created here.
    -- On an existing database, "CREATE TABLE IF NOT EXISTS messages" above is a
    -- no-op, so the sender_printer_id column doesn't exist yet — it's added by
    -- the ALTER TABLE migration below. Creating an index on it here would throw
    -- "no such column", aborting this whole exec() and preventing that very
    -- migration from running. The index is created after the migration instead.

    CREATE TABLE IF NOT EXISTS subscriptions (
      id            TEXT PRIMARY KEY,
      printer_id    TEXT NOT NULL,
      name          TEXT NOT NULL,
      feed_url      TEXT NOT NULL,
      feed_type     TEXT NOT NULL DEFAULT 'rss',
      last_item_id  TEXT,
      last_checked  TEXT,
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (printer_id) REFERENCES printers(id)
    );
  `);

  // Migrate existing databases that don't have columns/font_size yet
  const cols = db.prepare("PRAGMA table_info(printers)").all().map(r => r.name);
  if (!cols.includes("columns"))   db.exec("ALTER TABLE printers ADD COLUMN columns   INTEGER NOT NULL DEFAULT 22");
  if (!cols.includes("font_size")) db.exec("ALTER TABLE printers ADD COLUMN font_size INTEGER NOT NULL DEFAULT 9");
  const msgCols = db.prepare("PRAGMA table_info(messages)").all().map(r => r.name);
  if (!msgCols.includes("word_wrap")) db.exec("ALTER TABLE messages ADD COLUMN word_wrap INTEGER NOT NULL DEFAULT 1");
  if (!msgCols.includes("font_size")) db.exec("ALTER TABLE messages ADD COLUMN font_size INTEGER");
  // Sender attribution for the "messages I sent" history. Existing rows stay NULL,
  // which correctly means "sender unknown" — we can't retroactively attribute them.
  // Note: SQLite can't add a column with a FK constraint via ALTER TABLE, so on
  // migrated DBs this is a plain column. It's only ever written from a verified
  // API key lookup, so referential integrity is enforced in application code.
  if (!msgCols.includes("sender_printer_id")) {
    db.exec("ALTER TABLE messages ADD COLUMN sender_printer_id TEXT");
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_sender_printer
             ON messages(sender_printer_id, created_at)`);
  const pCols = db.prepare("PRAGMA table_info(printers)").all().map(r => r.name);
  if (!pCols.includes("hidden")) db.exec("ALTER TABLE printers ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
  // Soft-delete ("retire") support. We never hard-delete a printer because its id
  // is referenced by messages (both as recipient and as sender_printer_id) that
  // power history and two-sided threading. A retired printer keeps its row — so
  // names still resolve and conversations stay intact — but its API key stops
  // working and it disappears from the directory and from being a send target.
  if (!pCols.includes("deleted_at")) db.exec("ALTER TABLE printers ADD COLUMN deleted_at TEXT");
}

// ── Printers ──────────────────────────────────────────────────────────────────

function listPrinters(activeOnly = true) {
  const db = getDb();
  // Retired (soft-deleted) printers are excluded from BOTH views — the public
  // directory and the admin/superadmin list. Their row still exists so message
  // history and threading keep resolving names, but they're no longer a live
  // printer anyone can see or send to.
  const sql = activeOnly
    ? `SELECT id, name, description, location, columns, font_size, created_at, last_seen FROM printers WHERE active = 1 AND hidden = 0 AND deleted_at IS NULL ORDER BY name`
    : `SELECT id, name, description, location, active, hidden, api_key, columns, font_size, created_at, last_seen FROM printers WHERE deleted_at IS NULL ORDER BY name`;
  return db.prepare(sql).all();
}

function getPrinterById(id) {
  return getDb().prepare(`SELECT * FROM printers WHERE id = ?`).get(id);
}

function getPrinterByApiKey(apiKey) {
  // No `active` filter — an inactive printer must still be able to log into its
  // own admin page to reactivate itself. But a RETIRED (soft-deleted) printer is
  // gone for good: its key no longer authenticates, so it can't log in, send, or
  // be reactivated. (Its row lives on only so historical messages resolve.)
  return getDb().prepare(`SELECT * FROM printers WHERE api_key = ? AND deleted_at IS NULL`).get(apiKey);
}

function createPrinter({ id, name, description, location, api_key, columns, font_size }) {
  getDb().prepare(
    `INSERT INTO printers (id, name, description, location, api_key, columns, font_size)
     VALUES (@id, @name, @description, @location, @api_key, @columns, @font_size)`
  ).run({ id, name, description, location, api_key, columns, font_size });
  return getPrinterById(id);
}

function updatePrinterLastSeen(id) {
  getDb().prepare(`UPDATE printers SET last_seen = datetime('now') WHERE id = ?`).run(id);
}

function deactivatePrinter(id) {
  getDb().prepare(`UPDATE printers SET active = 0 WHERE id = ?`).run(id);
}

// ── Messages ─────────────────────────────────────────────────────────────────

function createMessage({ id, printer_id, source, sender_name, sender_email, body, image_path, word_wrap, font_size, sender_printer_id }) {
  getDb().prepare(
    `INSERT INTO messages (id, printer_id, source, sender_name, sender_email, body, image_path, word_wrap, font_size, sender_printer_id)
     VALUES (@id, @printer_id, @source, @sender_name, @sender_email, @body, @image_path, @word_wrap, @font_size, @sender_printer_id)`
  ).run({
    id, printer_id, source, sender_name, sender_email, body,
    image_path:        image_path || null,
    word_wrap:         word_wrap ?? 1,
    font_size:         font_size || null,
    sender_printer_id: sender_printer_id || null,
  });
  return getMessageById(id);
}

function getMessageById(id) {
  return getDb().prepare(`SELECT * FROM messages WHERE id = ?`).get(id);
}

function getPendingMessages(printer_id) {
  return getDb().prepare(
    `SELECT * FROM messages WHERE printer_id = ? AND status = 'pending' ORDER BY created_at ASC`
  ).all(printer_id);
}

function getRecentMessages(printer_id, limit = 50) {
  return getDb().prepare(
    `SELECT * FROM messages WHERE printer_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(printer_id, limit);
}

function setMessageStatus(id, status, error = null) {
  getDb().prepare(
    `UPDATE messages
     SET status = @status,
         error  = @error,
         printed_at = CASE WHEN @status = 'printed' THEN datetime('now') ELSE printed_at END
     WHERE id = @id`
  ).run({ id, status, error });
}

// ── Sent history ──────────────────────────────────────────────────────────────
// Messages this printer's owner SENT to other printers (the mirror image of
// getPrinterMessages, which returns messages RECEIVED). Joins printers so the UI
// can show the recipient's name rather than a bare UUID; LEFT JOIN so a message
// still appears in history even if its recipient printer was later deleted.
function getSentMessages(sender_printer_id, { limit = 50, offset = 0 } = {}) {
  return getDb().prepare(
    `SELECT m.*,
            p.name AS recipient_name
       FROM messages m
       LEFT JOIN printers p ON p.id = m.printer_id
      WHERE m.sender_printer_id = ?
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?`
  ).all(sender_printer_id, limit, offset);
}

function getSentStats(sender_printer_id) {
  return getDb().prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status='printed' THEN 1 ELSE 0 END) AS printed,
       SUM(CASE WHEN status='failed'  THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
       COUNT(DISTINCT printer_id)                        AS recipients
     FROM messages WHERE sender_printer_id = ?`
  ).get(sender_printer_id);
}

function getStats(printer_id) {
  return getDb().prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status='pending'  THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status='printed'  THEN 1 ELSE 0 END) AS printed,
       SUM(CASE WHEN status='failed'   THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN source='web'      THEN 1 ELSE 0 END) AS from_web,
       SUM(CASE WHEN source='email'    THEN 1 ELSE 0 END) AS from_email,
       SUM(CASE WHEN source='api'      THEN 1 ELSE 0 END) AS from_api
     FROM messages WHERE printer_id = ?`
  ).get(printer_id);
}


function updatePrinter(id, fields) {
  getDb().prepare(
    `UPDATE printers
     SET name = @name, description = @description, location = @location,
         columns = @columns, font_size = @font_size, active = @active, hidden = @hidden
     WHERE id = @id`
  ).run({ ...fields, id });
}

function softDeletePrinter(id) {
  // "Retire" a printer: keep the row and every message intact so history and
  // two-sided threading keep working (names still resolve, conversations stay
  // whole), but stamp deleted_at so it's excluded from listings, auth, and
  // sending. This is the user-facing delete — reversible in principle by an
  // admin clearing deleted_at, and safe for all the references we care about.
  getDb().prepare(`UPDATE printers SET deleted_at = datetime('now') WHERE id = ?`).run(id);
}

function hardDeletePrinter(id) {
  const db = getDb();
  // Messages this printer RECEIVED go away with it.
  db.prepare(`DELETE FROM messages WHERE printer_id = ?`).run(id);
  // Messages this printer SENT to OTHER printers must survive — they belong to
  // the recipient's history. Just drop the sender attribution, otherwise we'd
  // leave a dangling sender_printer_id pointing at a row that no longer exists
  // (which would trip the FK on freshly-created databases). The recipient still
  // sees the message; it simply reads as coming from an unknown sender.
  db.prepare(`UPDATE messages SET sender_printer_id = NULL WHERE sender_printer_id = ?`).run(id);
  db.prepare(`DELETE FROM printers WHERE id = ?`).run(id);
}

function getAllMessages({ limit = 100, offset = 0, printer_id = null }) {
  const db = getDb();
  if (printer_id) {
    return db.prepare(
      `SELECT m.*, p.name as printer_name FROM messages m
       JOIN printers p ON p.id = m.printer_id
       WHERE m.printer_id = ?
       ORDER BY m.created_at DESC LIMIT ? OFFSET ?`
    ).all(printer_id, limit, offset);
  }
  return db.prepare(
    `SELECT m.*, p.name as printer_name FROM messages m
     JOIN printers p ON p.id = m.printer_id
     ORDER BY m.created_at DESC LIMIT ? OFFSET ?`
  ).all(limit, offset);
}

function getGlobalStats() {
  return getDb().prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status='pending'  THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status='printed'  THEN 1 ELSE 0 END) AS printed,
       SUM(CASE WHEN status='failed'   THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN source='web'      THEN 1 ELSE 0 END) AS from_web,
       SUM(CASE WHEN source='email'    THEN 1 ELSE 0 END) AS from_email,
       SUM(CASE WHEN source='api'      THEN 1 ELSE 0 END) AS from_api
     FROM messages`
  ).get();
}

// Lightweight, non-sensitive counters for the public directory.
// created_at is stored via SQLite datetime('now'), which is UTC, so we compare
// against UTC windows. "delivered" = messages that actually printed; the week
// and today windows count all messages created in those spans regardless of
// status, since from a visitor's view those represent site activity.
function getPublicStats() {
  return getDb().prepare(
    `SELECT
       SUM(CASE WHEN status='printed' THEN 1 ELSE 0 END)                    AS delivered,
       SUM(CASE WHEN created_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) AS this_week,
       SUM(CASE WHEN created_at >= datetime('now','start of day') THEN 1 ELSE 0 END) AS today
     FROM messages`
  ).get();
}


// ── Subscriptions ─────────────────────────────────────────────────────────────

function getSubscriptionsByPrinter(printer_id) {
  return getDb().prepare(
    `SELECT * FROM subscriptions WHERE printer_id = ? ORDER BY created_at ASC`
  ).all(printer_id);
}

function getSubscriptionById(id) {
  return getDb().prepare(`SELECT * FROM subscriptions WHERE id = ?`).get(id);
}

function getActiveSubscriptions() {
  return getDb().prepare(`SELECT * FROM subscriptions WHERE active = 1`).all();
}

function createSubscription({ id, printer_id, name, feed_url, feed_type }) {
  getDb().prepare(
    `INSERT INTO subscriptions (id, printer_id, name, feed_url, feed_type)
     VALUES (@id, @printer_id, @name, @feed_url, @feed_type)`
  ).run({ id, printer_id, name, feed_url, feed_type });
  return getSubscriptionById(id);
}

function updateSubscription(id, { name, feed_url, feed_type, active }) {
  getDb().prepare(
    `UPDATE subscriptions SET name=@name, feed_url=@feed_url, feed_type=@feed_type, active=@active WHERE id=@id`
  ).run({ id, name, feed_url, feed_type, active });
}

function updateSubscriptionChecked(id, last_item_id) {
  getDb().prepare(
    `UPDATE subscriptions SET last_item_id=@last_item_id, last_checked=datetime('now') WHERE id=@id`
  ).run({ id, last_item_id });
}

function deleteSubscription(id) {
  getDb().prepare(`DELETE FROM subscriptions WHERE id = ?`).run(id);
}


// ── Printer Admin queries ─────────────────────────────────────────────────────

function getPrinterMessages(printer_id, { limit = 50, offset = 0, sender = null }) {
  if (sender) {
    return getDb().prepare(
      `SELECT * FROM messages
       WHERE printer_id = ? AND sender_name = ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(printer_id, sender, limit, offset);
  }
  return getDb().prepare(
    `SELECT * FROM messages
     WHERE printer_id = ?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(printer_id, limit, offset);
}

// ── Threads ───────────────────────────────────────────────────────────────────
// A thread is a conversation with one counterparty. There are two kinds:
//
//   1. PRINTER threads (two-sided). The counterparty is another registered
//      printer, so we can correlate BOTH directions:
//        received: printer_id = me        AND sender_printer_id = them
//        sent:     sender_printer_id = me AND printer_id        = them
//      Keyed by the counterparty's printer id — the only trustworthy identity.
//      sender_name can't be used for this: a guest typing "Bob" isn't Bob.
//
//   2. GUEST threads (one-sided, unchanged behaviour). The sender has no
//      printer, so there's no reply channel and nothing to correlate. Grouped
//      by sender_name among messages where sender_printer_id IS NULL.
//
// Both kinds are returned in one list, newest-active first, so the UI can show
// a single unified inbox.
function getPrinterThreads(printer_id) {
  const db = getDb();

  // Two-sided conversations with other printers.
  const printerThreads = db.prepare(
    `WITH convo AS (
       SELECT
         CASE WHEN m.printer_id = @me THEN m.sender_printer_id ELSE m.printer_id END AS other_id,
         m.body, m.image_path, m.created_at,
         CASE WHEN m.printer_id = @me THEN 'in' ELSE 'out' END AS direction
       FROM messages m
       WHERE (m.printer_id = @me AND m.sender_printer_id IS NOT NULL)
          OR (m.sender_printer_id = @me)
     )
     SELECT
       'printer'                AS kind,
       c.other_id               AS counterparty_id,
       p.name                   AS counterparty_name,
       NULL                     AS sender_name,
       COUNT(*)                 AS message_count,
       MAX(c.created_at)        AS latest_at,
       (SELECT body       FROM convo c2 WHERE c2.other_id = c.other_id
         ORDER BY c2.created_at DESC LIMIT 1) AS latest_body,
       (SELECT image_path FROM convo c3 WHERE c3.other_id = c.other_id
          AND c3.image_path IS NOT NULL
         ORDER BY c3.created_at DESC LIMIT 1) AS latest_image,
       (SELECT direction  FROM convo c4 WHERE c4.other_id = c.other_id
         ORDER BY c4.created_at DESC LIMIT 1) AS latest_direction
     FROM convo c
     LEFT JOIN printers p ON p.id = c.other_id
     GROUP BY c.other_id
     ORDER BY latest_at DESC`
  ).all({ me: printer_id });

  // One-sided threads from guests (no printer, so no reply channel).
  const guestThreads = db.prepare(
    `SELECT
       'guest'           AS kind,
       NULL              AS counterparty_id,
       NULL              AS counterparty_name,
       m.sender_name     AS sender_name,
       COUNT(*)          AS message_count,
       MAX(m.created_at) AS latest_at,
       (SELECT body FROM messages m2
         WHERE m2.printer_id = m.printer_id
           AND m2.sender_printer_id IS NULL
           AND m2.sender_name IS m.sender_name
         ORDER BY m2.created_at DESC LIMIT 1) AS latest_body,
       (SELECT image_path FROM messages m3
         WHERE m3.printer_id = m.printer_id
           AND m3.sender_printer_id IS NULL
           AND m3.sender_name IS m.sender_name
           AND m3.image_path IS NOT NULL
         ORDER BY m3.created_at DESC LIMIT 1) AS latest_image,
       'in'              AS latest_direction
     FROM messages m
     WHERE m.printer_id = ?
       AND m.sender_printer_id IS NULL
     GROUP BY m.sender_name
     ORDER BY latest_at DESC`
  ).all(printer_id);

  return [...printerThreads, ...guestThreads]
    .sort((a, b) => (a.latest_at < b.latest_at ? 1 : -1));
}

// Full message list for one thread, oldest-first (chat order), each tagged with
// its direction so the UI can align sent/received on opposite sides.
//
// For a printer thread pass counterparty_id; for a guest thread pass sender_name.
function getThreadMessages(printer_id, { counterparty_id = null, sender_name = undefined } = {}) {
  const db = getDb();

  if (counterparty_id) {
    return db.prepare(
      `SELECT m.*,
              CASE WHEN m.printer_id = @me THEN 'in' ELSE 'out' END AS direction
         FROM messages m
        WHERE (m.printer_id = @me    AND m.sender_printer_id = @other)
           OR (m.sender_printer_id = @me AND m.printer_id    = @other)
        ORDER BY m.created_at ASC`
    ).all({ me: printer_id, other: counterparty_id });
  }

  // Guest thread — always inbound. `IS` (not `=`) so a NULL sender_name, which
  // is a legitimate group, matches instead of silently returning nothing.
  return db.prepare(
    `SELECT m.*, 'in' AS direction
       FROM messages m
      WHERE m.printer_id = ?
        AND m.sender_printer_id IS NULL
        AND m.sender_name IS ?
      ORDER BY m.created_at ASC`
  ).all(printer_id, sender_name ?? null);
}

// Recent activity in BOTH directions — powers the "Your recent messages" panel
// on the send page for logged-in users.
function getRecentActivity(printer_id, { limit = 10 } = {}) {
  return getDb().prepare(
    `SELECT m.*,
            CASE WHEN m.printer_id = @me THEN 'in' ELSE 'out' END AS direction,
            CASE WHEN m.printer_id = @me
                 THEN COALESCE(sp.name, m.sender_name)
                 ELSE rp.name
            END AS counterparty_name
       FROM messages m
       LEFT JOIN printers sp ON sp.id = m.sender_printer_id
       LEFT JOIN printers rp ON rp.id = m.printer_id
      WHERE m.printer_id = @me OR m.sender_printer_id = @me
      ORDER BY m.created_at DESC
      LIMIT @limit`
  ).all({ me: printer_id, limit });
}

module.exports = {
  getDb,
  listPrinters, getPrinterById, getPrinterByApiKey,
  createPrinter, updatePrinterLastSeen, deactivatePrinter,
  createMessage, getMessageById, getPendingMessages,
  getRecentMessages, setMessageStatus, getStats,
  updatePrinter, hardDeletePrinter, softDeletePrinter, getAllMessages, getGlobalStats, getPublicStats,
  getSubscriptionsByPrinter, getSubscriptionById, getActiveSubscriptions,
  getPrinterMessages, getPrinterThreads, getThreadMessages, getRecentActivity,
  getSentMessages, getSentStats,
  createSubscription, updateSubscription, updateSubscriptionChecked, deleteSubscription,
};
