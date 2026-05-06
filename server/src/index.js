require("dotenv").config();

const express  = require("express");
const path     = require("path");
const cors     = require("cors");
const helmet   = require("helmet");
const morgan   = require("morgan");

const { apiLimiter }   = require("./middleware/rateLimiter");
const messagesRouter   = require("./routes/messages");
const printersRouter   = require("./routes/printers");
const adminRouter         = require("./routes/admin");
const { startSmtpServer } = require("./services/smtp");

const app  = express();

// Trust Caddy/Cloudflare proxy so req.ip reflects the real client IP
if (process.env.TRUST_PROXY) app.set("trust proxy", parseInt(process.env.TRUST_PROXY, 10) || 1);
const PORT = parseInt(process.env.PORT || "3000", 10);

// ── Security & logging ────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],   // needed for inline scripts in UI
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:"],
    },
  },
}));
app.use(cors());
app.use(morgan("combined"));

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Static files ──────────────────────────────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, "../public");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "../../data/uploads");

app.use(express.static(PUBLIC_DIR));
app.use("/uploads", express.static(UPLOAD_DIR));

// ── API routes ────────────────────────────────────────────────────────────────
app.use("/api", apiLimiter);
app.use("/api/printers", printersRouter);
app.use("/api/messages", messagesRouter);
app.use("/api/admin",    adminRouter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok", ts: new Date().toISOString() }));

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[HTTP] PrintBridge server running on port ${PORT}`);
});

startSmtpServer();
