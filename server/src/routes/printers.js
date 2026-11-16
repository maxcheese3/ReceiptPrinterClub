const express = require("express");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { DEFAULT_WIDTH_DOTS, normalizeWidthDots } = require("../lib/printerWidth");
const { registrationLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

// GET /api/printers — public list including print_width_dots for the web UI
router.get("/", (_req, res) => {
  return res.json({ printers: db.listPrinters(true) });
});

// GET /api/printers/stats — lightweight public activity counters for the directory
router.get("/stats", (_req, res) => {
  const s = db.getPublicStats();
  return res.json({
    delivered: s.delivered || 0,
    this_week: s.this_week || 0,
    today:     s.today     || 0,
  });
});

// POST /api/printers — register a new printer
router.post("/", registrationLimiter, (req, res) => {
  const { name, description, location, print_width_dots } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Printer name is required" });
  }

  const widthDots = normalizeWidthDots(print_width_dots) ?? DEFAULT_WIDTH_DOTS;

  try {
    const printer = db.createPrinter({
      id:          uuidv4(),
      name:        name.trim(),
      description: description || null,
      location:    location    || null,
      api_key:     uuidv4(),
      print_width_dots: widthDots,
    });

    return res.status(201).json({
      success: true,
      printer: db.printerInfo(printer),
      api_key: printer.api_key,
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

// GET /api/printers/:id/stats
router.get("/:id/stats", (req, res) => {
  const printer = db.getPrinterById(req.params.id);
  if (!printer || !printer.active || printer.deleted_at) {
    return res.status(404).json({ error: "Printer not found" });
  }
  return res.json({ printer_id: printer.id, name: printer.name, stats: db.getStats(printer.id) });
});

// DELETE /api/printers/:id — deactivate
router.delete("/:id", (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) return res.status(401).json({ error: "X-API-Key header required" });
  const printer = db.getPrinterByApiKey(apiKey);
  if (!printer || printer.id !== req.params.id) return res.status(403).json({ error: "Forbidden" });
  db.deactivatePrinter(printer.id);
  return res.json({ success: true });
});

module.exports = router;
