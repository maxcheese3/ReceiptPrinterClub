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
      FOREIGN KEY (printer_id) REFERENCES printers(id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_printer_status
      ON messages(printer_id, status, created_at);
  `);

  // Migrate existing databases that don't have columns/font_size yet
  const cols = db.prepare("PRAGMA table_info(printers)").all().map(r => r.name);
  if (!cols.includes("columns"))   db.exec("ALTER TABLE printers ADD COLUMN columns   INTEGER NOT NULL DEFAULT 22");
  if (!cols.includes("font_size")) db.exec("ALTER TABLE printers ADD COLUMN font_size INTEGER NOT NULL DEFAULT 9");
  const msgCols = db.prepare("PRAGMA table_info(messages)").all().map(r => r.name);
  if (!msgCols.includes("word_wrap")) db.exec("ALTER TABLE messages ADD COLUMN word_wrap INTEGER NOT NULL DEFAULT 1");
  if (!msgCols.includes("font_size")) db.exec("ALTER TABLE messages ADD COLUMN font_size INTEGER");
  const pCols = db.prepare("PRAGMA table_info(printers)").all().map(r => r.name);
  if (!pCols.includes("hidden")) db.exec("ALTER TABLE printers ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
}

// ── Printers ──────────────────────────────────────────────────────────────────

function listPrinters(activeOnly = true) {
  const db = getDb();
  const sql = activeOnly
    ? `SELECT id, name, description, location, columns, font_size, created_at, last_seen FROM printers WHERE active = 1 AND hidden = 0 ORDER BY name`
    : `SELECT id, name, description, location, active, hidden, api_key, columns, font_size, created_at, last_seen FROM printers ORDER BY name`;
  return db.prepare(sql).all();
}

function getPrinterById(id) {
  return getDb().prepare(`SELECT * FROM printers WHERE id = ?`).get(id);
}

function getPrinterByApiKey(apiKey) {
  return getDb().prepare(`SELECT * FROM printers WHERE api_key = ? AND active = 1`).get(apiKey);
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

function createMessage({ id, printer_id, source, sender_name, sender_email, body, image_path, word_wrap, font_size }) {
  getDb().prepare(
    `INSERT INTO messages (id, printer_id, source, sender_name, sender_email, body, image_path, word_wrap, font_size)
     VALUES (@id, @printer_id, @source, @sender_name, @sender_email, @body, @image_path, @word_wrap, @font_size)`
  ).run({ id, printer_id, source, sender_name, sender_email, body, image_path: image_path || null, word_wrap: word_wrap ?? 1, font_size: font_size || null });
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

function hardDeletePrinter(id) {
  const db = getDb();
  db.prepare(`DELETE FROM messages WHERE printer_id = ?`).run(id);
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

module.exports = {
  getDb,
  listPrinters, getPrinterById, getPrinterByApiKey,
  createPrinter, updatePrinterLastSeen, deactivatePrinter,
  createMessage, getMessageById, getPendingMessages,
  getRecentMessages, setMessageStatus, getStats,
  updatePrinter, hardDeletePrinter, getAllMessages, getGlobalStats,
};
