const path = require("path");
// .env next to this file is the client's only config — including when run as a
// service, whose working directory may be somewhere else.
require("dotenv").config({ path: path.join(__dirname, ".env") });

const axios = require("axios");
const fs    = require("fs");
const os    = require("os");

const layout = require("./layout");
const escpos = require("./escpos");
const output = require("./output");
const { version: CLIENT_VERSION } = require("./package.json");

// ── Config ────────────────────────────────────────────────────────────────────
const SERVER_URL      = (process.env.SERVER_URL || "http://localhost:3000").replace(/\/$/, "");
const API_KEY         = process.env.API_KEY;
const POLL_MS         = parseInt(process.env.POLL_INTERVAL_MS  || "5000", 10);
const TEMP_DIR        = process.env.TEMP_DIR || path.join(os.tmpdir(), "printbridge");
const LOG_LEVEL       = process.env.LOG_LEVEL || "info";
const ARCHIVE_ENABLED = process.env.ARCHIVE_ENABLED !== "false";
const ARCHIVE_DIR     = process.env.ARCHIVE_DIR || path.join(__dirname, "archive");
const BRIGHTNESS      = parseInt(process.env.PRINT_BRIGHTNESS || "40", 10);
const CHUNK_ROWS      = parseInt(process.env.PRINT_RASTER_CHUNK_ROWS || "256", 10);

// Settings that no longer do anything, and what replaced them.
// LEGACY(old-client): helps people upgrading from a pre-4.0 .env — remove once
// every printer reports a new client.
const RETIRED_VARS = {
  PRINT_COLUMNS:   "characters per line is set on the My Printer page",
  PRINT_WIDTH_MM:  "characters per line is set on the My Printer page",
  PRINT_DPI:       "characters per line is set on the My Printer page",
  PRINT_FONT_SIZE: "each sender picks a size",
  PRINT_CUPS_MODE: "use PRINT_MODE=driver for printers that ignore ESC/POS",
};

if (!API_KEY) { console.error("[FATAL] API_KEY not set in .env"); process.exit(1); }
fs.mkdirSync(TEMP_DIR, { recursive: true });

// ── Logger ────────────────────────────────────────────────────────────────────
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const lvl = LEVELS[LOG_LEVEL] !== undefined ? LEVELS[LOG_LEVEL] : 1;
const log = {
  debug: (...a) => lvl <= 0 && console.debug(ts(), "[DEBUG]", ...a),
  info:  (...a) => lvl <= 1 && console.info (ts(), "[INFO] ", ...a),
  warn:  (...a) => lvl <= 2 && console.warn (ts(), "[WARN] ", ...a),
  error: (...a) => lvl <= 3 && console.error(ts(), "[ERROR]", ...a),
};
function ts() { return new Date().toISOString().replace("T", " ").slice(0, 19); }

// ── Printer settings ──────────────────────────────────────────────────────────
// Printer width and emoji mode are set on the My Printer page and arrive with
// every poll, so changes apply without restarting the client.
const printer = { widthDots: layout.DEFAULT_WIDTH_DOTS, emojiMode: "glyph" };
let warnedOldServer = false;
let lastSettings = "";

function applySettings(data) {
  // LEGACY(old-client): only reachable while a server from before 4.0 is still
  // running — remove once every printer reports a new client (keep the default).
  if (!data.print_width_dots) {
    if (!warnedOldServer) {
      log.warn(`Server didn't send a printer width (older server?) — using ${printer.widthDots} dots (32 characters per line).`);
      warnedOldServer = true;
    }
    return;
  }
  printer.widthDots = data.print_width_dots;
  printer.emojiMode = data.emoji_mode === "text" ? "text" : "glyph";
  const cols = layout.colsFor(printer.widthDots, layout.SIZES[1]);
  const summary = `${cols} characters per line (${printer.widthDots} dots), emoji: ${printer.emojiMode === "text" ? "text" : "pictures"}`;
  if (summary !== lastSettings) log.info(`[settings] ${summary}`);
  lastSettings = summary;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
const http = axios.create({
  baseURL: SERVER_URL,
  // The server shows the client version with the printer's info, so everyone
  // can see which printers still run an old client.
  headers: { "X-API-Key": API_KEY, "X-Client-Version": CLIENT_VERSION },
  timeout: 10_000,
});

async function pollMessages() {
  const { data } = await http.get("/api/messages/poll");
  applySettings(data);
  return data.messages || [];
}
async function reportStatus(id, status, error = null) {
  await http.patch(`/api/messages/${id}`, { status, error });
}
async function downloadBuffer(filename) {
  const res = await axios.get(`${SERVER_URL}/uploads/${filename}`, {
    responseType: "arraybuffer",
    headers: { "X-API-Key": API_KEY },
    timeout: 30_000,
  });
  return Buffer.from(res.data);
}

// ── Local archive ─────────────────────────────────────────────────────────────
// Saves a copy of every message (text + image) to the local filesystem.
// Archive structure: archive/YYYY-MM-DD/HH-MM-SS_<id8>_{text|image}.*
async function archiveMessage(message, imageBuffer = null) {
  if (!ARCHIVE_ENABLED) return;
  try {
    const d   = new Date(message.created_at + "Z");
    const day = d.toISOString().slice(0, 10);                         // 2026-05-06
    const hms = d.toISOString().slice(11, 19).replace(/:/g, "-");     // 14-30-22
    const id8 = message.id.slice(0, 8);
    const dir = path.join(ARCHIVE_DIR, day);
    fs.mkdirSync(dir, { recursive: true });

    const base = path.join(dir, `${hms}_${id8}`);

    // Save metadata + body as a text file
    const meta = [
      `ID:      ${message.id}`,
      `From:    ${message.sender_name  || "(none)"}`,
      `Email:   ${message.sender_email || "(none)"}`,
      `Source:  ${message.source}`,
      `Time:    ${d.toLocaleString()}`,
      `Printer: ${message.printer_id}`,
      `Status:  ${message.status}`,
      "",
      message.body || "",
    ].join("\n");
    fs.writeFileSync(base + ".txt", meta, "utf8");

    // Save image if present
    if (imageBuffer) {
      const ext  = (message.image_path || ".jpg").match(/\.[^.]+$/)?.[0] || ".jpg";
      fs.writeFileSync(base + ext, imageBuffer);
    }

    log.debug(`[archive] Saved ${path.basename(base)}`);
  } catch (err) {
    log.warn("[archive] Failed to archive message:", err.message);
  }
}

// ── Printing ──────────────────────────────────────────────────────────────────
// Driver mode on macOS/Linux sends plain text, which can't carry custom
// characters, so emoji always print as stand-ins there.
function emojiMode() {
  return output.config().mode === "driver" && !output.IS_WINDOWS ? "text" : printer.emojiMode;
}

async function printModel(model) {
  const opts = { widthDots: printer.widthDots, tempDir: TEMP_DIR };
  if (output.config().mode === "driver") return output.printViaDriver(model, opts);
  const job = await escpos.build(model, { widthDots: printer.widthDots, brightness: BRIGHTNESS, chunkRows: CHUNK_ROWS });
  await output.sendRaw(job, opts);
}

// ── Process one message ───────────────────────────────────────────────────────
async function processMessage(message) {
  log.info(`Processing message ${message.id} (source: ${message.source})`);

  // API/email always word-wrap. Web submissions send explicit word_wrap flag.
  const isApi = message.source === "api" || message.source === "email";
  const wrap  = isApi || message.word_wrap !== 0;

  try {
    let imageBuffer = null;
    if (message.image_path) imageBuffer = await downloadBuffer(message.image_path);
    // Archive before printing so we have a copy even if print fails
    await archiveMessage(message, imageBuffer);

    const model = message.kind === "test_page"
      ? layout.buildTestPage({ widthDots: printer.widthDots })
      : layout.buildReceipt(message, { widthDots: printer.widthDots, emojiMode: emojiMode(), wrap, imageBuffer });
    await printModel(model);

    await reportStatus(message.id, "printed");
    log.info(`  ✓ Message ${message.id} printed`);
  } catch (err) {
    log.error("  ✗ Failed:", err.message);
    await reportStatus(message.id, "failed", err.message).catch(() => {});
  }
}

// ── Poll loop ─────────────────────────────────────────────────────────────────
let running = false;
async function poll() {
  if (running) return;
  running = true;
  try {
    const messages = await pollMessages();
    if (messages.length > 0) {
      log.info(`Received ${messages.length} new message(s)`);
      for (const msg of messages) await processMessage(msg);
    } else {
      log.debug("No pending messages");
    }
  } catch (err) {
    if (err.response) log.warn(`Server error ${err.response.status}: ${JSON.stringify(err.response.data)}`);
    else log.warn("Poll error:", err.message);
  } finally {
    running = false;
  }
}

// `node client.js --test-page` prints the calibration page once and exits.
// Add `--cols 42` to try a width without changing the website setting (or
// before the server supports it); otherwise the width comes from the server.
async function printTestPageAndExit() {
  try {
    const colsArg = process.argv.indexOf("--cols");
    const cols = colsArg > 0 ? parseInt(process.argv[colsArg + 1], 10) : NaN;
    if (colsArg > 0 && !(cols >= 11 && cols <= 85)) {
      log.error("--cols needs a number of characters per line, e.g. --cols 42");
      process.exit(1);
    }
    if (cols) {
      printer.widthDots = layout.dotsForCols(cols);
    } else {
      const { data } = await http.get("/api/printer-admin/me");
      applySettings(data.printer || {});
    }
    log.info(`Printing test page at ${printer.widthDots} dots to ${output.describe()}…`);
    await printModel(layout.buildTestPage({ widthDots: printer.widthDots }));
    log.info("Test page sent.");
    process.exit(0);
  } catch (err) {
    log.error("Test page failed:", err.response ? `server ${err.response.status}` : err.message);
    process.exit(1);
  }
}

log.info(`PrintBridge Client ${CLIENT_VERSION} starting…`);
log.info(`  Server:        ${SERVER_URL}`);
log.info(`  Printer:       ${output.describe()}`);
log.info(`  Timezone:      ${process.env.TZ || "(unset — using system default; in Docker that's UTC)"}`);
log.info(`  Archive:       ${ARCHIVE_ENABLED ? ARCHIVE_DIR : "disabled"}`);
for (const [name, replacement] of Object.entries(RETIRED_VARS)) {
  if (process.env[name] !== undefined) log.warn(`  Ignoring ${name} — ${replacement}.`);
}

if (process.argv.includes("--test-page")) {
  printTestPageAndExit();
} else {
  log.info(`  Poll interval: ${POLL_MS}ms`);
  poll();
  const interval = setInterval(poll, POLL_MS);
  process.on("SIGINT",  () => { clearInterval(interval); log.info("Shutting down."); process.exit(0); });
  process.on("SIGTERM", () => { clearInterval(interval); log.info("Shutting down."); process.exit(0); });
}
