require("dotenv").config();

const axios      = require("axios");
const fs         = require("fs");
const path       = require("path");
const os         = require("os");
const { spawn }  = require("child_process");
const Jimp       = require("jimp");

// ── Config ────────────────────────────────────────────────────────────────────
const SERVER_URL   = (process.env.SERVER_URL || "http://localhost:3000").replace(/\/$/, "");
const API_KEY      = process.env.API_KEY;
const POLL_MS      = parseInt(process.env.POLL_INTERVAL_MS || "5000", 10);
const TEMP_DIR     = process.env.TEMP_DIR || path.join(os.tmpdir(), "printbridge");
const LOG_LEVEL    = process.env.LOG_LEVEL || "info";
const PRINTER_NAME  = process.env.PRINTER_NAME  || "";
const PRINT_COLUMNS  = parseInt(process.env.PRINT_COLUMNS  || "22", 10);
const PRINT_FONT_SIZE = parseInt(process.env.PRINT_FONT_SIZE || "9",  10);

const SCRIPT_DIR = __dirname;
const PS_TEXT    = path.join(SCRIPT_DIR, "print-text.ps1");
const PS_IMAGE   = path.join(SCRIPT_DIR, "print-image.ps1");

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

// ── HTTP helpers ──────────────────────────────────────────────────────────────
const http = axios.create({
  baseURL: SERVER_URL,
  headers: { "X-API-Key": API_KEY },
  timeout: 10_000,
});

async function pollMessages() {
  const res = await http.get("/api/messages/poll");
  return res.data.messages || [];
}

async function reportStatus(messageId, status, error = null) {
  await http.patch(`/api/messages/${messageId}`, { status, error });
}

async function downloadBuffer(filename) {
  const url = `${SERVER_URL}/uploads/${filename}`;
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    headers: { "X-API-Key": API_KEY },
    timeout: 30_000,
  });
  return Buffer.from(res.data);
}

// ── PowerShell runner ─────────────────────────────────────────────────────────
function runPowerShell(scriptPath, args = [], stdinText = null) {
  return new Promise((resolve, reject) => {
    const psArgs = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-File", scriptPath,
      ...args,
    ];

    const ps = spawn("powershell.exe", psArgs, { stdio: ["pipe", "pipe", "pipe"] });

    // Ensure Node sends UTF-8 on this pipe
    ps.stdin.setDefaultEncoding("utf8");

    let stderr = "";
    ps.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    ps.stdout.on("data", (d) => { log.debug("[PS]", d.toString("utf8").trim()); });

    ps.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
    });
    ps.on("error", (err) => reject(new Error("Failed to start PowerShell: " + err.message)));

    if (stdinText) {
      // UTF-8 BOM tells PowerShell's [Console]::In to decode as UTF-8
      // instead of the Windows system codepage (often CP1252 which breaks emoji)
      ps.stdin.write("\uFEFF", "utf8");
      ps.stdin.write(stdinText, "utf8");
    }
    ps.stdin.end();
  });
}

// ── Text printing ─────────────────────────────────────────────────────────────
function wordWrap(text, maxCols) {
  const out = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) { out.push(""); continue; }
    const words = para.split(" ");
    let line = "";
    for (const word of words) {
      const candidate = line ? line + " " + word : word;
      if (candidate.length > maxCols && line) { out.push(line); line = word; }
      else line = candidate;
    }
    if (line) out.push(line);
    out.push("");
  }
  return out;
}

function buildTextPayload(message) {
  const SEP  = "=".repeat(PRINT_COLUMNS);
  const SEP2 = "-".repeat(PRINT_COLUMNS);
  const lines = [];
  lines.push(SEP);
  lines.push("  PrintBridge Message");
  lines.push(SEP);
  if (message.sender_name)  lines.push("From:     " + message.sender_name);
  if (message.sender_email) lines.push("Email:    " + message.sender_email);
  lines.push("Received: " + new Date(message.created_at + "Z").toLocaleString());
  lines.push("Via:      " + message.source);
  lines.push(SEP2);
  lines.push("");
  if (message.body && message.body.trim()) {
    lines.push(...wordWrap(message.body.trim(), PRINT_COLUMNS));
  }
  lines.push("");
  lines.push(SEP);
  return lines.join("\r\n");
}

async function printText(message) {
  const payload = buildTextPayload(message);
  const args = ["-FontSize", PRINT_FONT_SIZE.toString()];
  if (PRINTER_NAME) args.push("-PrinterName", PRINTER_NAME);
  await runPowerShell(PS_TEXT, args, payload);
}

// ── Image printing ────────────────────────────────────────────────────────────
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
  try {
    if (message.body && message.body.trim()) {
      await printText(message);
      log.info("  ✓ Text sent to printer");
    }
    if (message.image_path) {
      const buf = await downloadBuffer(message.image_path);
      await printImage(buf);
      log.info("  ✓ Image sent to printer");
    }
    await reportStatus(message.id, "printed");
    log.info(`  ✓ Message ${message.id} complete`);
  } catch (err) {
    log.error(`  ✗ Failed:`, err.message);
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

// ── Startup ───────────────────────────────────────────────────────────────────
log.info("PrintBridge Client starting…");
log.info(`  Server:        ${SERVER_URL}`);
log.info(`  Poll interval: ${POLL_MS}ms`);
log.info(`  Printer:       ${PRINTER_NAME || "(Windows default)"}`);

poll();
const interval = setInterval(poll, POLL_MS);
process.on("SIGINT",  () => { clearInterval(interval); log.info("Shutting down."); process.exit(0); });
process.on("SIGTERM", () => { clearInterval(interval); log.info("Shutting down."); process.exit(0); });
