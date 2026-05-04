/**
 * PrintBridge Windows Print Client
 *
 * Polls the PrintBridge server for pending messages and prints them
 * directly via Win32 GDI through PowerShell's System.Drawing.Printing.
 * No third-party applications required.
 *
 * - Text  → print-text.ps1  → System.Drawing.Printing.PrintDocument
 * - Image → print-image.ps1 → System.Drawing.Printing.PrintDocument
 *
 * Requirements: Node.js on Windows, PowerShell (built into Windows)
 *
 * Usage: node client.js
 */

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
const PRINTER_NAME = process.env.PRINTER_NAME || "";  // blank = Windows default

// Paths to the bundled PowerShell print scripts (same folder as client.js)
const SCRIPT_DIR   = __dirname;
const PS_TEXT      = path.join(SCRIPT_DIR, "print-text.ps1");
const PS_IMAGE     = path.join(SCRIPT_DIR, "print-image.ps1");

if (!API_KEY) {
  console.error("[FATAL] API_KEY is not set in .env. Exiting.");
  process.exit(1);
}

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
// Runs a .ps1 script with given args. If stdinData is provided it is piped in.
function runPowerShell(scriptPath, args = [], stdinData = null) {
  return new Promise((resolve, reject) => {
    const psArgs = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-File", scriptPath,
      ...args,
    ];

    const ps = spawn("powershell.exe", psArgs, { stdio: ["pipe", "pipe", "pipe"] });

    let stderr = "";
    ps.stderr.on("data", (d) => { stderr += d.toString(); });
    ps.stdout.on("data", (d) => { log.debug("[PS]", d.toString().trim()); });

    ps.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
      }
    });

    ps.on("error", (err) => reject(new Error("Failed to start PowerShell: " + err.message)));

    if (stdinData) {
      ps.stdin.write(stdinData);
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
      if (candidate.length > maxCols && line) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
    out.push("");
  }
  return out;
}

function buildTextPayload(message) {
  const SEP  = "=".repeat(58);
  const SEP2 = "-".repeat(58);
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
    lines.push(...wordWrap(message.body.trim(), 58));
  }

  lines.push("");
  lines.push(SEP);
  return lines.join("\r\n");
}

async function printText(message) {
  const payload = buildTextPayload(message);
  const args = PRINTER_NAME ? ["-PrinterName", PRINTER_NAME] : [];
  // Pipe the text into the PowerShell script via stdin
  await runPowerShell(PS_TEXT, args, payload);
}

// ── Image printing ────────────────────────────────────────────────────────────
async function printImage(imageBuffer) {
  // Decode with jimp (handles JPG/PNG/GIF/WebP/BMP), save as BMP to temp file
  const img = await Jimp.read(imageBuffer);


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
      for (const msg of messages) {
        await processMessage(msg);
      }
    } else {
      log.debug("No pending messages");
    }
  } catch (err) {
    if (err.response) {
      log.warn(`Server error ${err.response.status}: ${JSON.stringify(err.response.data)}`);
    } else {
      log.warn("Poll error:", err.message);
    }
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
