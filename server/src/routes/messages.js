const express  = require("express");
const { v4: uuidv4 } = require("uuid");
const db       = require("../db");
const upload   = require("../middleware/upload");
const { messageLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

// ── POST /api/messages  (web form + JSON API) ─────────────────────────────────
router.post(
  "/",
  messageLimiter,
  upload.single("image"),
  (req, res) => {
    try {
      const { printer_id, sender_name, sender_email, body } = req.body;

      if (!printer_id) {
        return res.status(400).json({ error: "printer_id is required" });
      }
      if (!body && !req.file) {
        return res.status(400).json({ error: "A message body or image is required" });
      }

      const printer = db.getPrinterById(printer_id);
      if (!printer || !printer.active) {
        return res.status(404).json({ error: "Printer not found or inactive" });
      }

      // Determine source: API key in header → 'api', else 'web'
      const authHeader = req.headers["x-api-key"];
      let source = "web";
      if (authHeader) {
        const keyPrinter = db.getPrinterByApiKey(authHeader);
        if (keyPrinter && keyPrinter.id === printer_id) {
          source = "api";
        }
      }

      const message = db.createMessage({
        id:           uuidv4(),
        printer_id,
        source,
        sender_name:  sender_name  || null,
        sender_email: sender_email || null,
        body:         body         || null,
        image_path:   req.file ? req.file.filename : null,
      });

      return res.status(201).json({
        success: true,
        message_id: message.id,
        status: message.status,
      });
    } catch (err) {
      console.error("POST /api/messages error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ── GET /api/messages/poll  (printer client polls for pending) ────────────────
// Auth: X-API-Key header
router.get("/poll", (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) return res.status(401).json({ error: "X-API-Key header required" });

  const printer = db.getPrinterByApiKey(apiKey);
  if (!printer) return res.status(403).json({ error: "Invalid API key" });

  db.updatePrinterLastSeen(printer.id);

  const messages = db.getPendingMessages(printer.id);

  // Mark them as 'printing' atomically
  for (const m of messages) {
    db.setMessageStatus(m.id, "printing");
  }

  return res.json({ printer_id: printer.id, messages });
});

// ── PATCH /api/messages/:id  (printer client reports result) ─────────────────
router.patch("/:id", (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) return res.status(401).json({ error: "X-API-Key header required" });

  const printer = db.getPrinterByApiKey(apiKey);
  if (!printer) return res.status(403).json({ error: "Invalid API key" });

  const msg = db.getMessageById(req.params.id);
  if (!msg) return res.status(404).json({ error: "Message not found" });
  if (msg.printer_id !== printer.id) return res.status(403).json({ error: "Forbidden" });

  const { status, error } = req.body;
  if (!["printed", "failed"].includes(status)) {
    return res.status(400).json({ error: "status must be 'printed' or 'failed'" });
  }

  db.setMessageStatus(msg.id, status, error || null);
  return res.json({ success: true });
});

// ── GET /api/messages/:printer_id/recent  (last 50 messages) ─────────────────
router.get("/:printer_id/recent", (req, res) => {
  const printer = db.getPrinterById(req.params.printer_id);
  if (!printer || !printer.active) return res.status(404).json({ error: "Printer not found" });
  const messages = db.getRecentMessages(printer.id, 50);
  return res.json({ messages });
});

module.exports = router;
