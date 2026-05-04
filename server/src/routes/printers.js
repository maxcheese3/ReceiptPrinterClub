const express = require("express");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");

const router = express.Router();

// ── GET /api/printers  (public list for the web form) ────────────────────────
router.get("/", (_req, res) => {
  const printers = db.listPrinters(true);
  return res.json({ printers });
});

// ── POST /api/printers  (register a new printer) ─────────────────────────────
// No auth required — anyone can register a printer. The returned api_key
// is then used by the Windows client.
router.post("/", (req, res) => {
  const { name, description, location } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Printer name is required" });
  }

  try {
    const printer = db.createPrinter({
      id:          uuidv4(),
      name:        name.trim(),
      description: description || null,
      location:    location    || null,
      api_key:     uuidv4(),   // generated server-side
    });

    // Return api_key only on creation — never again via the API
    const full = db.getPrinterById(printer.id);
    const { api_key, ...safeFields } = full;
    return res.status(201).json({
      success: true,
      printer: safeFields,
      api_key, // show once
      message: "Save your API key – it will not be shown again.",
    });
  } catch (err) {
    if (err.message && err.message.includes("UNIQUE")) {
      return res.status(409).json({ error: "A printer with that name already exists" });
    }
    console.error("POST /api/printers error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/printers/:id/stats ───────────────────────────────────────────────
router.get("/:id/stats", (req, res) => {
  const printer = db.getPrinterById(req.params.id);
  if (!printer || !printer.active) return res.status(404).json({ error: "Printer not found" });
  const stats = db.getStats(printer.id);
  return res.json({ printer_id: printer.id, name: printer.name, stats });
});

// ── DELETE /api/printers/:id  (deactivate) ────────────────────────────────────
router.delete("/:id", (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) return res.status(401).json({ error: "X-API-Key header required" });

  const printer = db.getPrinterByApiKey(apiKey);
  if (!printer || printer.id !== req.params.id) {
    return res.status(403).json({ error: "Forbidden" });
  }

  db.deactivatePrinter(printer.id);
  return res.json({ success: true });
});

module.exports = router;
