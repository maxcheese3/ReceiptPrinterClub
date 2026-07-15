/**
 * Printer Admin routes — authenticated by the printer's own API key.
 * Gives a printer owner visibility into their own messages and
 * the ability to update their printer settings.
 *
 * GET    /api/printer-admin/me           — printer info
 * PATCH  /api/printer-admin/me           — update name/description/location/columns
 * GET    /api/printer-admin/messages     — all messages RECEIVED (paginated, optional ?sender filter)
 * GET    /api/printer-admin/threads      — conversations (two-sided with printers, one-sided from guests)
 * GET    /api/printer-admin/thread       — full message list for one conversation, both directions
 * GET    /api/printer-admin/recent       — most recent messages in both directions
 * GET    /api/printer-admin/sent         — all messages SENT to other printers (paginated)
 */

"use strict";

const express = require("express");
const db      = require("../db");

const router  = express.Router();

function requireApiKey(req, res, next) {
  const key     = req.headers["x-api-key"];
  if (!key) return res.status(401).json({ error: "X-API-Key header required" });
  const printer = db.getPrinterByApiKey(key);
  if (!printer)  return res.status(403).json({ error: "Invalid API key" });
  req.printer = printer;
  next();
}

// ── GET /api/printer-admin/me ─────────────────────────────────────────────────
router.get("/me", requireApiKey, (req, res) => {
  const { id, name, description, location, columns, font_size, active, hidden, created_at, last_seen } = req.printer;
  const stats = db.getStats(id);
  return res.json({ printer: { id, name, description, location, columns, font_size, active, hidden, created_at, last_seen }, stats });
});

// ── PATCH /api/printer-admin/me ───────────────────────────────────────────────
router.patch("/me", requireApiKey, (req, res) => {
  const p = req.printer;
  const { name, description, location, columns, active, hidden } = req.body;

  // Name uniqueness check
  if (name && name.trim() !== p.name) {
    const dup = db.listPrinters(false).find(x => x.name === name.trim() && x.id !== p.id);
    if (dup) return res.status(409).json({ error: "A printer with that name already exists" });
  }

  db.updatePrinter(p.id, {
    name:        name        !== undefined ? name.trim()                                         : p.name,
    description: description !== undefined ? (description.trim() || null)                        : p.description,
    location:    location    !== undefined ? (location.trim()    || null)                        : p.location,
    columns:     columns     !== undefined ? Math.max(10, Math.min(200, parseInt(columns, 10)))  : p.columns,
    font_size:   p.font_size,
    active:      active      !== undefined ? (active ? 1 : 0)                                    : p.active,
    hidden:      hidden      !== undefined ? (hidden ? 1 : 0)                                    : (p.hidden || 0),
  });

  const updated = db.getPrinterById(p.id);
  const { api_key, ...safe } = updated;
  return res.json({ success: true, printer: safe });
});

// ── DELETE /api/printer-admin/me ──────────────────────────────────────────────
// Requires the printer name as confirmation. This RETIRES the printer (soft
// delete): the row and all its messages are kept so history and threading stay
// intact for everyone who ever talked to it, but the API key stops working and
// the printer disappears from the directory and from being a send target.
router.delete("/me", requireApiKey, (req, res) => {
  const { confirm_name } = req.body;
  if (!confirm_name || confirm_name.trim() !== req.printer.name) {
    return res.status(400).json({ error: "Printer name confirmation does not match" });
  }
  db.softDeletePrinter(req.printer.id);
  return res.json({ success: true });
});

// ── GET /api/printer-admin/messages ──────────────────────────────────────────
// ?limit=50&offset=0&sender=<name>
router.get("/messages", requireApiKey, (req, res) => {
  const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit  || "50",  10)));
  const offset = Math.max(0,              parseInt(req.query.offset  || "0",   10));
  const sender = req.query.sender || null;

  const messages = db.getPrinterMessages(req.printer.id, { limit, offset, sender });
  return res.json({ messages });
});

// ── GET /api/printer-admin/threads ───────────────────────────────────────────
// Conversations, newest-active first. Two kinds in one list:
//   kind='printer' — two-sided conversation with another printer (has counterparty_id)
//   kind='guest'   — one-sided messages from a guest (has sender_name)
router.get("/threads", requireApiKey, (req, res) => {
  const threads = db.getPrinterThreads(req.printer.id);
  return res.json({ threads });
});

// ── GET /api/printer-admin/thread ────────────────────────────────────────────
// Full message list for one conversation, oldest-first, each tagged with
// direction ('in' = received, 'out' = sent) so the UI can align them like a
// chat. Pass either ?counterparty_id=<printer id> or ?sender_name=<name>.
router.get("/thread", requireApiKey, (req, res) => {
  const { counterparty_id, sender_name } = req.query;

  if (!counterparty_id && sender_name === undefined) {
    return res.status(400).json({ error: "counterparty_id or sender_name is required" });
  }

  const messages = db.getThreadMessages(req.printer.id, {
    counterparty_id: counterparty_id || null,
    // A guest thread can legitimately have a NULL sender_name (anonymous), which
    // arrives as the empty string. Preserve that distinction.
    sender_name: counterparty_id ? undefined : (sender_name === "" ? null : sender_name),
  });
  return res.json({ messages });
});

// ── GET /api/printer-admin/recent ────────────────────────────────────────────
// Most recent messages in BOTH directions (sent and received), newest first.
// Powers the "Your recent messages" panel on the send page.
router.get("/recent", requireApiKey, (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "10", 10)));
  const messages = db.getRecentActivity(req.printer.id, { limit });
  return res.json({ messages });
});

// ── GET /api/printer-admin/sent ──────────────────────────────────────────────
// Messages this printer's owner SENT to other printers — the mirror of
// /messages, which lists what they RECEIVED. Scoped by sender_printer_id, which
// is only ever written from a verified API key, so a user can only ever read
// back their own sent messages.
router.get("/sent", requireApiKey, (req, res) => {
  const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit  || "50", 10)));
  const offset = Math.max(0,              parseInt(req.query.offset || "0",  10));

  const messages = db.getSentMessages(req.printer.id, { limit, offset });
  const stats    = db.getSentStats(req.printer.id);
  return res.json({ messages, stats });
});

module.exports = router;
