/**
 * Admin API — password protected via simple HMAC token
 *
 * POST   /api/admin/login           exchange password for token
 * GET    /api/admin/printers        list all printers (inc. inactive)
 * PATCH  /api/admin/printers/:id    update printer fields
 * DELETE /api/admin/printers/:id    hard-delete printer + messages
 * GET    /api/admin/messages        paginated message archive
 * GET    /api/admin/stats           global stats
 */

const express = require("express");
const crypto  = require("crypto");
const db      = require("../db");

const router = express.Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const TOKEN_TTL_MS   = 8 * 60 * 60 * 1000; // 8 hours

// Stable secret persists tokens across restarts when ADMIN_TOKEN_SECRET is set
const TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET && process.env.ADMIN_TOKEN_SECRET.length > 8
  ? process.env.ADMIN_TOKEN_SECRET
  : crypto.randomBytes(32).toString("hex");

// ── Token helpers ─────────────────────────────────────────────────────────────
function makeToken() {
  const payload = JSON.stringify({ ts: Date.now() });
  const payloadB64 = Buffer.from(payload).toString("base64");
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(payloadB64).digest("hex");
  return `${payloadB64}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string") return false;
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx < 1) return false;
  const payloadB64 = token.slice(0, dotIdx);
  const sig        = token.slice(dotIdx + 1);

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8"));
  } catch { return false; }

  const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(payloadB64).digest("hex");

  // timingSafeEqual requires identical buffer lengths.
  // Hash both values so they're always the same fixed size.
  const sigHash = crypto.createHash("sha256").update(sig).digest();
  const expHash = crypto.createHash("sha256").update(expected).digest();
  if (!crypto.timingSafeEqual(sigHash, expHash)) return false;

  if (!payload.ts || Date.now() - payload.ts > TOKEN_TTL_MS) return false;
  return true;
}

function requireAuth(req, res, next) {
  const auth  = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!verifyToken(token)) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ── POST /api/admin/login ─────────────────────────────────────────────────────
router.post("/login", (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({
      error: "Admin password not configured. Add ADMIN_PASSWORD to your server .env file."
    });
  }

  const { password } = req.body;
  if (!password || typeof password !== "string") {
    return res.status(400).json({ error: "Password required" });
  }

  // Constant-time compare — must use same-length buffers
  const givenBuf    = Buffer.alloc(256);
  const expectedBuf = Buffer.alloc(256);
  givenBuf.write(password, "utf8");
  expectedBuf.write(ADMIN_PASSWORD, "utf8");

  let match;
  try { match = crypto.timingSafeEqual(givenBuf, expectedBuf); }
  catch { match = false; }
  // Also verify exact string match (timing-safe compare uses fixed-length buffers)
  match = match && (password === ADMIN_PASSWORD);

  if (!match) return res.status(403).json({ error: "Incorrect password" });

  return res.json({ token: makeToken(), expires_in: TOKEN_TTL_MS / 1000 });
});

// ── GET /api/admin/printers ───────────────────────────────────────────────────
router.get("/printers", requireAuth, (_req, res) => {
  return res.json({ printers: db.listPrinters(false) });
});

// ── PATCH /api/admin/printers/:id ────────────────────────────────────────────
router.patch("/printers/:id", requireAuth, (req, res) => {
  const printer = db.getPrinterById(req.params.id);
  if (!printer) return res.status(404).json({ error: "Printer not found" });

  const { name, description, location, columns, font_size, active } = req.body;

  if (name && name.trim() !== printer.name) {
    const dup = db.listPrinters(false).find(p => p.name === name.trim() && p.id !== printer.id);
    if (dup) return res.status(409).json({ error: "A printer with that name already exists" });
  }

  db.updatePrinter(req.params.id, {
    name:        name        !== undefined ? name.trim()                                        : printer.name,
    description: description !== undefined ? (description.trim() || null)                       : printer.description,
    location:    location    !== undefined ? (location.trim()    || null)                       : printer.location,
    columns:     columns     !== undefined ? Math.max(10, Math.min(200, parseInt(columns, 10))) : printer.columns,
    font_size:   font_size   !== undefined ? Math.max(6,  Math.min(72,  parseInt(font_size, 10))): printer.font_size,
    active:      active      !== undefined ? (active ? 1 : 0)                                   : printer.active,
  });

  return res.json({ success: true, printer: db.getPrinterById(req.params.id) });
});

// ── DELETE /api/admin/printers/:id ───────────────────────────────────────────
router.delete("/printers/:id", requireAuth, (req, res) => {
  if (!db.getPrinterById(req.params.id)) {
    return res.status(404).json({ error: "Printer not found" });
  }
  db.hardDeletePrinter(req.params.id);
  return res.json({ success: true });
});

// ── GET /api/admin/messages ───────────────────────────────────────────────────
router.get("/messages", requireAuth, (req, res) => {
  const limit      = Math.min(500, Math.max(1, parseInt(req.query.limit  || "100", 10)));
  const offset     = Math.max(0, parseInt(req.query.offset || "0", 10));
  const printer_id = req.query.printer_id || null;
  return res.json({ messages: db.getAllMessages({ limit, offset, printer_id }) });
});

// ── GET /api/admin/stats ──────────────────────────────────────────────────────
router.get("/stats", requireAuth, (_req, res) => {
  return res.json({ stats: db.getGlobalStats() });
});

module.exports = router;
