/**
 * output.js — gets a finished job to the printer.
 *
 * Normal path (PRINT_MODE=escpos, the default): raw ESC/POS bytes from
 * escpos.js, delivered one of three ways —
 *   PRINTER_DEVICE set   → written straight to the device file
 *                          (/dev/usb/lp0, Bluetooth /dev/rfcomm0, macOS /dev/cu.*)
 *   Windows              → the Windows print spooler as a RAW job (print-raw.ps1)
 *   macOS / Linux        → CUPS with `lp -o raw`, so CUPS passes bytes untouched
 *
 * Fallback (PRINT_MODE=driver): for printers that ignore ESC/POS, such as the
 * raster-only Star TSP100. The same receipt model is handed to the OS driver —
 * plain text through CUPS on macOS/Linux, GDI drawing on Windows. Line breaks
 * and sizes match the ESC/POS output; bold, underline and banners are
 * best-effort.
 */

"use strict";

const fs           = require("fs");
const path         = require("path");
const { spawn, execFile } = require("child_process");
const Jimp         = require("jimp");
const { colsFor }  = require("./layout");
const { lineSpacing } = require("./escpos");

const IS_WINDOWS = process.platform === "win32";
const DOTS_PER_INCH = 203;

const PS_RAW   = path.join(__dirname, "print-raw.ps1");
const PS_TEXT  = path.join(__dirname, "print-text.ps1");
const PS_IMAGE = path.join(__dirname, "print-image.ps1");

function config() {
  const mode = (process.env.PRINT_MODE || "escpos").toLowerCase();
  return {
    device:      process.env.PRINTER_DEVICE || "",
    printerName: process.env.PRINTER_NAME   || "",
    mode:        mode === "driver" ? "driver" : "escpos",
    cupsMedia:   process.env.PRINT_CUPS_MEDIA || "",
  };
}

function tempFile(tempDir, ext) {
  return path.join(tempDir, `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
}

async function withTempFile(tempDir, ext, contents, fn) {
  const file = tempFile(tempDir, ext);
  fs.writeFileSync(file, contents);
  try { return await fn(file); }
  finally { try { fs.unlinkSync(file); } catch {} }
}

// ── Transports ────────────────────────────────────────────────────────────────
function writeToDevice(device, bytes) {
  let fd;
  try {
    fd = fs.openSync(device, "w");
    fs.writeSync(fd, bytes, 0, bytes.length);
  } catch (err) {
    throw new Error(`Device write failed (${device}): ${err.message}\n` +
      "Make sure you have write permission: sudo usermod -aG lp $USER");
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}

function lp(filePath, printerName, options) {
  return new Promise((resolve, reject) => {
    const args = [...options];
    if (printerName) args.push("-d", printerName);
    args.push(filePath);
    execFile("lp", args, (err, _stdout, stderr) => {
      if (err) reject(new Error("lp failed: " + (stderr || err.message)));
      else resolve();
    });
  });
}

function runPowerShell(scriptPath, args = [], stdinText = null) {
  return new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", scriptPath, ...args,
    ], { stdio: ["pipe", "pipe", "pipe"] });

    let stderr = "";
    ps.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    ps.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `PowerShell exit ${code}`)));
    ps.on("error", (err) => reject(new Error("PowerShell spawn failed: " + err.message)));

    if (stdinText !== null) {
      ps.stdin.write("﻿", "utf8"); // BOM so PowerShell reads UTF-8
      ps.stdin.write(stdinText, "utf8");
    }
    ps.stdin.end();
  });
}

/** Sends a raw ESC/POS job. */
async function sendRaw(bytes, { tempDir }) {
  const c = config();
  if (c.device) return writeToDevice(c.device, bytes);
  if (IS_WINDOWS) {
    return withTempFile(tempDir, "bin", bytes, (file) => {
      const args = ["-Path", file];
      if (c.printerName) args.push("-PrinterName", c.printerName);
      return runPowerShell(PS_RAW, args);
    });
  }
  return withTempFile(tempDir, "bin", bytes, (file) => lp(file, c.printerName, ["-o", "raw"]));
}

// ── Driver fallback ───────────────────────────────────────────────────────────
// Splits the model into print jobs: consecutive text lines, then each image.
// A gap joins the text job before it, as an empty line of its own height.
function driverJobs(model) {
  const jobs = [];
  for (const block of model) {
    const last = jobs[jobs.length - 1];
    if (block.type === "line" || block.type === "gap") {
      if (last && last.type === "text") last.lines.push(block);
      else if (block.type === "line") jobs.push({ type: "text", lines: [block] });
    } else {
      jobs.push(block);
    }
  }
  return jobs;
}

function spanText(span, realEmoji) {
  if (!span.emoji) return span.text;
  return realEmoji ? span.raw : span.fallback;
}

async function rasterToImage(rows, widthDots) {
  const img = new Jimp(widthDots, rows.length, 0xffffffff);
  rows.forEach((row, y) => {
    for (let x = 0; x < widthDots; x++) {
      if (row[x >> 3] & (0x80 >> (x & 7))) img.setPixelColor(0x000000ff, x, y);
    }
  });
  return img;
}

async function blockImage(block, widthDots) {
  if (block.type === "raster") return rasterToImage(block.rows, block.widthDots);
  const img = await Jimp.read(block.buffer);
  return img.resize(widthDots, Jimp.AUTO);
}

// CUPS plain text: one cpi/lpi per job, so each run of same-size lines is its
// own job. cpi is set so a line of `cols` characters fills the printable width,
// which keeps line breaks identical to ESC/POS output.
const CUPS_PAGE = [
  "-o", "orientation-requested=3", // portrait — never auto-rotate
  "-o", "page-left=0", "-o", "page-right=0",
  "-o", "page-top=0",  "-o", "page-bottom=0",
];
const NO_CUT = ["-o", "DocCutType=0NoCutDoc"]; // Star driver: don't cut between jobs

async function cupsDriver(model, { widthDots, tempDir }) {
  const c = config();
  const widthIn = widthDots / DOTS_PER_INCH;
  // Star's long receipt media for the paper width; override with PRINT_CUPS_MEDIA.
  const media = c.cupsMedia || (widthDots >= 500 ? "X72MMY2000MM" : "X50D8MMY2000MM");

  const jobs = [];
  for (const job of driverJobs(model)) {
    if (job.type !== "text") { jobs.push(job); continue; }
    for (const l of job.lines) {
      // A text job has one line pitch, so a gap can't be sized independently
      // of the text; it's left out.
      if (l.type === "gap") continue;
      const last = jobs[jobs.length - 1];
      if (last && last.type === "text" && last.size === l.size) last.lines.push(l);
      else jobs.push({ type: "text", size: l.size, lines: [l] });
    }
  }

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const cut = i === jobs.length - 1 ? [] : NO_CUT;
    if (job.type === "text") {
      const cpi = (colsFor(widthDots, job.size) / widthIn).toFixed(2);
      const lpi = (DOTS_PER_INCH / lineSpacing(job.size, false)).toFixed(2);
      const text = job.lines.map((l) => l.spans.map((s) => spanText(s, false)).join("")).join("\n");
      const options = [...CUPS_PAGE, "-o", `media=${media}`, "-o", `cpi=${cpi}`, "-o", `lpi=${lpi}`, ...cut];
      await withTempFile(tempDir, "txt", text, (file) => lp(file, c.printerName, options));
    } else {
      const img = await blockImage(job, widthDots);
      const widthMm  = (widthDots / DOTS_PER_INCH * 25.4).toFixed(1);
      // Page sized to the image; on long receipt media the image would be
      // centred on a 2m page with a metre of blank paper before it.
      const heightMm = Math.min(2000, Math.max(25.4, img.getHeight() * 25.4 / DOTS_PER_INCH)).toFixed(1);
      const options = [
        ...CUPS_PAGE, "-o", `media=Custom.${widthMm}x${heightMm}mm`,
        "-o", `ppi=${DOTS_PER_INCH}`, ...cut,
      ];
      await withTempFile(tempDir, "png", await img.getBufferAsync(Jimp.MIME_PNG), (file) => lp(file, c.printerName, options));
    }
  }
}

// Windows GDI: print-text.ps1 draws each line in Lucida Console at a point
// size chosen so `cols` characters fill the width (Lucida's advance is 0.6em).
async function windowsDriver(model, { widthDots, tempDir }) {
  const c = config();
  const nameArgs = c.printerName ? ["-PrinterName", c.printerName] : [];
  const widthPt = widthDots / DOTS_PER_INCH * 72;

  for (const job of driverJobs(model)) {
    if (job.type === "text") {
      const lines = job.lines.map((l) => l.type === "gap" ? {
        pt: 1,
        lh: +(l.dots / DOTS_PER_INCH * 72).toFixed(2),
        invert: false,
        spans: [],
      } : ({
        pt: +(widthPt / (colsFor(widthDots, l.size) * 0.6)).toFixed(2),
        lh: +(lineSpacing(l.size, l.tight) / DOTS_PER_INCH * 72).toFixed(2),
        invert: l.invert,
        spans: l.spans.map((s) => ({ t: spanText(s, true), b: s.bold, u: s.underline })),
      }));
      await runPowerShell(PS_TEXT, nameArgs, JSON.stringify({ lines }));
    } else {
      const img = await blockImage(job, widthDots);
      await withTempFile(tempDir, "bmp", await img.getBufferAsync(Jimp.MIME_BMP),
        (file) => runPowerShell(PS_IMAGE, ["-ImagePath", file, ...nameArgs]));
    }
  }
}

/** Prints a receipt model through the OS print driver (PRINT_MODE=driver). */
async function printViaDriver(model, opts) {
  return IS_WINDOWS ? windowsDriver(model, opts) : cupsDriver(model, opts);
}

/** Where jobs go, for the startup log. */
function describe() {
  const c = config();
  const where = c.device ? `device ${c.device}`
    : c.printerName ? `${IS_WINDOWS ? "Windows printer" : "CUPS queue"} "${c.printerName}"`
    : IS_WINDOWS ? "Windows default printer" : "CUPS default printer";
  return `${where} (${c.mode === "driver" ? "driver mode" : "ESC/POS"})`;
}

module.exports = { config, sendRaw, printViaDriver, describe, IS_WINDOWS };
