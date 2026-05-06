require("dotenv").config();

const axios     = require("axios");
const fs        = require("fs");
const path      = require("path");
const os        = require("os");
const { spawn } = require("child_process");
const Jimp      = require("jimp");

// ── Config ────────────────────────────────────────────────────────────────────
const SERVER_URL      = (process.env.SERVER_URL || "http://localhost:3000").replace(/\/$/, "");
const API_KEY         = process.env.API_KEY;
const POLL_MS         = parseInt(process.env.POLL_INTERVAL_MS  || "5000", 10);
const TEMP_DIR        = process.env.TEMP_DIR || path.join(os.tmpdir(), "printbridge");
const LOG_LEVEL       = process.env.LOG_LEVEL || "info";
const PRINTER_NAME    = process.env.PRINTER_NAME   || "";
const PRINT_COLUMNS   = parseInt(process.env.PRINT_COLUMNS    || "22", 10);
const PRINT_FONT_SIZE = parseInt(process.env.PRINT_FONT_SIZE  || "9",  10);

const PS_TEXT  = path.join(__dirname, "print-text.ps1");
const PS_IMAGE = path.join(__dirname, "print-image.ps1");

if (!API_KEY) { console.error("[FATAL] API_KEY not set in .env"); process.exit(1); }
fs.mkdirSync(TEMP_DIR, { recursive: true });

// ── Logger ────────────────────────────────────────────────────────────────────
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const lvl = LEVELS[LOG_LEVEL] ?? 1;
const log = {
  debug: (...a) => lvl <= 0 && console.debug(ts(), "[DEBUG]", ...a),
  info:  (...a) => lvl <= 1 && console.info (ts(), "[INFO] ", ...a),
  warn:  (...a) => lvl <= 2 && console.warn (ts(), "[WARN] ", ...a),
  error: (...a) => lvl <= 3 && console.error(ts(), "[ERROR]", ...a),
};
function ts() { return new Date().toISOString().replace("T", " ").slice(0, 19); }

// ── HTTP ──────────────────────────────────────────────────────────────────────
const http = axios.create({
  baseURL: SERVER_URL,
  headers: { "X-API-Key": API_KEY },
  timeout: 10_000,
});

async function pollMessages() {
  return (await http.get("/api/messages/poll")).data.messages || [];
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

// ── PowerShell runner ─────────────────────────────────────────────────────────
function runPowerShell(scriptPath, args = [], stdinText = null) {
  return new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", scriptPath, ...args,
    ], { stdio: ["pipe", "pipe", "pipe"] });

    ps.stdin.setDefaultEncoding("utf8");
    let stderr = "";
    ps.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    ps.stdout.on("data", (d) => { log.debug("[PS]", d.toString("utf8").trim()); });
    ps.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `PS exit ${code}`)));
    ps.on("error", (err) => reject(new Error("PS spawn failed: " + err.message)));

    if (stdinText !== null) {
      ps.stdin.write("\uFEFF", "utf8"); // UTF-8 BOM so PowerShell reads as UTF-8
      ps.stdin.write(stdinText, "utf8");
    }
    ps.stdin.end();
  });
}

// ── Text helpers ──────────────────────────────────────────────────────────────
// Word-wraps preserving leading whitespace (for ASCII art indentation).
// Lines that start with spaces are wrapped at maxCols but the leading
// spaces of the first fragment are kept on each continuation too.
function wordWrap(text, maxCols) {
  const out = [];
  for (const para of text.split("\n")) {
    // Blank line — preserve as empty line
    if (para.trim() === "") { out.push(""); continue; }

    // Preserve leading whitespace (indentation / ASCII art)
    const leadMatch = para.match(/^(\s*)/);
    const lead = leadMatch ? leadMatch[1] : "";
    const rest = para.slice(lead.length);

    const words = rest.split(" ");
    let line = lead;
    for (const word of words) {
      const candidate = line === lead ? lead + word : line + " " + word;
      if ([...candidate].length > maxCols && line !== lead) {
        out.push(line);
        line = lead + word;
      } else {
        line = candidate;
      }
    }
    if (line !== lead || lead) out.push(line);
  }
  return out;
}

function buildHeader(message) {
  const SEP  = "=".repeat(PRINT_COLUMNS);
  const lines = [SEP];
  if (message.sender_name)  lines.push("From:     " + message.sender_name);
  if (message.sender_email) lines.push("Email:    " + message.sender_email);
  lines.push("Received: " + new Date(message.created_at + "Z").toLocaleString());
  lines.push(SEP);
  return lines;
}

function buildTextPayload(message, doWordWrap) {
  const lines = buildHeader(message);
  lines.push("");
  if (message.body && message.body.trim()) {
    if (doWordWrap) {
      lines.push(...wordWrap(message.body, PRINT_COLUMNS));
    } else {
      // No wrap — pass through as-is (user laid it out themselves)
      lines.push(...message.body.split("\n"));
    }
  }
  lines.push("");
  lines.push("=".repeat(PRINT_COLUMNS));
  return lines.join("\r\n");
}

// Minimal header for image-only jobs (sender name + date, no separators)
function buildImageHeader(message) {
  const lines = [];
  if (message.sender_name) {
    lines.push("From: " + message.sender_name);
  }
  lines.push("Time: " + new Date(message.created_at + "Z").toLocaleString());
  lines.push("-".repeat(PRINT_COLUMNS));
  return lines.join("\r\n");
}

// ── Print functions ───────────────────────────────────────────────────────────
async function printText(message, doWordWrap) {
  const payload  = buildTextPayload(message, doWordWrap);
  const fontSize = message.font_size || PRINT_FONT_SIZE;
  const args = ["-FontSize", String(fontSize)];
  if (PRINTER_NAME) args.push("-PrinterName", PRINTER_NAME);
  await runPowerShell(PS_TEXT, args, payload);
}

async function printImageHeader(message) {
  if (!message.sender_name && !message.created_at) return;
  const payload  = buildImageHeader(message);
  const fontSize = message.font_size || PRINT_FONT_SIZE;
  const args = ["-FontSize", String(fontSize)];
  if (PRINTER_NAME) args.push("-PrinterName", PRINTER_NAME);
  await runPowerShell(PS_TEXT, args, payload);
}

async function printImage(imageBuffer) {
  const img     = await Jimp.read(imageBuffer);
  const tmpFile = path.join(TEMP_DIR, `img-${Date.now()}.bmp`);
  await img.writeAsync(tmpFile);
  try {
    const args = ["-ImagePath", tmpFile];
    if (PRINTER_NAME) args.push("-PrinterName", PRINTER_NAME);
    await runPowerShell(PS_IMAGE, args);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ── Process one message ───────────────────────────────────────────────────────
async function processMessage(message) {
  log.info(`Processing message ${message.id} (source: ${message.source})`);

  // API/email always word-wrap. Web submissions send explicit word_wrap flag.
  const isApi      = message.source === "api" || message.source === "email";
  const doWordWrap = isApi || message.word_wrap !== 0;

  try {
    if (message.body && message.body.trim()) {
      await printText(message, doWordWrap);
      log.info("  ✓ Text printed");
    }

    if (message.image_path) {
      // Print a small header above the image so recipient knows who sent it
      await printImageHeader(message);
      const buf = await downloadBuffer(message.image_path);
      await printImage(buf);
      log.info("  ✓ Image printed");
    }

    await reportStatus(message.id, "printed");
    log.info(`  ✓ Message ${message.id} complete`);
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

log.info("PrintBridge Client starting…");
log.info(`  Server:        ${SERVER_URL}`);
log.info(`  Poll interval: ${POLL_MS}ms`);
log.info(`  Printer:       ${PRINTER_NAME || "(Windows default)"}`);
log.info(`  Columns:       ${PRINT_COLUMNS}  Font: ${PRINT_FONT_SIZE}pt`);

poll();
const interval = setInterval(poll, POLL_MS);
process.on("SIGINT",  () => { clearInterval(interval); log.info("Shutting down."); process.exit(0); });
process.on("SIGTERM", () => { clearInterval(interval); log.info("Shutting down."); process.exit(0); });
