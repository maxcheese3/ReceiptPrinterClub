/**
 * Printer Admin routes — authenticated by the printer's own API key.
 * Gives a printer owner visibility into their own messages and
 * the ability to update their printer settings.
 *
 * GET    /api/printer-admin/me           — printer info
 * PATCH  /api/printer-admin/me           — update name/description/location/columns
 * GET    /api/printer-admin/messages     — all messages (paginated, optional ?sender filter)
 * GET    /api/printer-admin/threads      — messages grouped by sender_name
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
  const { name, description, location, columns } = req.body;

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
    active:      p.active,
    hidden:      p.hidden || 0,
  });

  const updated = db.getPrinterById(p.id);
  const { api_key, ...safe } = updated;
  return res.json({ success: true, printer: safe });
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
// Returns each unique sender_name with their message count and latest message time.
// The client can then request /messages?sender=<name> for a specific thread.
router.get("/threads", requireApiKey, (req, res) => {
  const threads = db.getPrinterThreads(req.printer.id);
  return res.json({ threads });
});

module.exports = router;
