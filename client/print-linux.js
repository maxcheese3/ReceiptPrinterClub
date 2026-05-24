/**
 * print-linux.js
 * Linux/macOS printing with two backends:
 *
 * 1. RAW / ESC-POS  (recommended for USB thermal printers)
 *    Set PRINTER_DEVICE=/dev/usb/lp0 (or /dev/lp0)
 *    Text and images are sent as ESC/POS commands directly to the device.
 *    No CUPS, no drivers needed. Works with virtually all thermal receipt printers.
 *    The node process needs read/write access to the device:
 *      sudo usermod -aG lp $USER   (then log out and back in)
 *    Or run once with sudo to test.
 *
 * 2. CUPS  (if PRINTER_DEVICE is not set)
 *    Text is rendered to PNG via node-canvas and sent via `lp`.
 *    Requires: npm install canvas  +  apt install libcairo2-dev libpango1.0-dev
 *
 * Environment variables:
 *   PRINTER_DEVICE   - raw device path e.g. /dev/usb/lp0  (enables ESC/POS mode)
 *   PRINTER_NAME     - CUPS destination name (used in CUPS mode)
 *   PRINT_FONT_SIZE  - body font size in points (default 9)
 *   PRINT_COLUMNS    - chars per line (default 24)
 *   PRINT_DPI        - PNG render DPI for CUPS mode (default 203)
 *   PRINT_WIDTH_MM   - paper width mm (default 58)
 */

"use strict";

const fs            = require("fs");
const path          = require("path");
const { execFile }  = require("child_process");
const Jimp          = require("jimp");

// ── Config ────────────────────────────────────────────────────────────────────
function cfg() {
  return {
    device:      process.env.PRINTER_DEVICE  || "",
    printerName: process.env.PRINTER_NAME    || "",
    fontSize:    parseInt(process.env.PRINT_FONT_SIZE || "9",   10),
    columns:     parseInt(process.env.PRINT_COLUMNS   || "24",  10),
    dpi:         parseInt(process.env.PRINT_DPI        || "203", 10),
    widthMm:     parseFloat(process.env.PRINT_WIDTH_MM || "58"),
  };
}

function mmToPx(mm, dpi) { return Math.round(mm * dpi / 25.4); }
function ptToPx(pt, dpi) { return Math.round(pt * dpi / 72); }

// ── ESC/POS constants ─────────────────────────────────────────────────────────
const ESC = 0x1b;
const GS  = 0x1d;
const NUL = 0x00;

const CMD = {
  INIT:           Buffer.from([ESC, 0x40]),                // Initialize printer
  ALIGN_LEFT:     Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER:   Buffer.from([ESC, 0x61, 0x01]),
  BOLD_ON:        Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF:       Buffer.from([ESC, 0x45, 0x00]),
  DOUBLE_HEIGHT:  Buffer.from([ESC, 0x21, 0x10]),
  NORMAL_SIZE:    Buffer.from([ESC, 0x21, 0x00]),
  FEED_LINES:     (n) => Buffer.from([ESC, 0x64, n]),      // Feed n lines
  CUT:            Buffer.from([GS,  0x56, 0x41, 0x00]),    // Partial cut
  LF:             Buffer.from([0x0a]),
  SET_LINE_SPACING: (n) => Buffer.from([ESC, 0x33, n]),    // n/180 inch line spacing
};

// ── Write raw bytes to device ─────────────────────────────────────────────────
function writeToDevice(device, buffers) {
  return new Promise((resolve, reject) => {
    // Open in write mode — O_WRONLY | O_NONBLOCK
    const fd = fs.openSync(device, "w");
    try {
      for (const buf of buffers) {
        fs.writeSync(fd, buf, 0, buf.length);
      }
      resolve();
    } catch (err) {
      reject(new Error(`Device write failed (${device}): ${err.message}\n` +
        `Make sure you have write permission: sudo usermod -aG lp $USER`));
    } finally {
      try { fs.closeSync(fd); } catch {}
    }
  });
}

// ── ESC/POS text printing ─────────────────────────────────────────────────────
async function escposText(textPayload, device) {
  const buffers = [];

  buffers.push(CMD.INIT);
  buffers.push(CMD.ALIGN_LEFT);
  // Tight line spacing: 24/180 inch ≈ 3.4mm — adjust if lines overlap
  buffers.push(CMD.SET_LINE_SPACING(24));

  const lines = textPayload.split(/\r?\n/);

  function isMetaLine(line) {
    return /^(From:|Email:|Time:|={3,}|-{3,})/.test(line);
  }

  for (const line of lines) {
    const isMeta = isMetaLine(line);

    if (isMeta) {
      buffers.push(CMD.BOLD_ON);
      buffers.push(CMD.NORMAL_SIZE);
    } else {
      buffers.push(CMD.BOLD_ON);
      buffers.push(CMD.NORMAL_SIZE);
    }

    // Encode as CP437 (ESC/POS default code page) — safe ASCII fallback
    // For full Unicode, a font cartridge or UTF-8 capable printer is needed.
    // Most characters in the ASCII range print fine; extended chars degrade gracefully.
    buffers.push(Buffer.from(line, "ascii"));
    buffers.push(CMD.LF);
  }

  // Feed and cut
  buffers.push(CMD.BOLD_OFF);
  buffers.push(CMD.FEED_LINES(4));
  buffers.push(CMD.CUT);

  await writeToDevice(device, buffers);
}

// ── ESC/POS image printing (raster graphics) ──────────────────────────────────
// Converts image to 1-bit raster and sends via GS v 0 command.
async function escposImage(imageBuffer, device) {
  const c       = cfg();
  // At 203dpi, 58mm = ~464 dots. Round down to nearest byte (8 dots).
  const widthPx = Math.floor(mmToPx(c.widthMm, c.dpi) / 8) * 8;

  // Load and resize to printer width, convert to grayscale
  const img = await Jimp.read(imageBuffer);
  img.resize(widthPx, Jimp.AUTO);
  img.greyscale();

  const imgW  = img.getWidth();
  const imgH  = img.getHeight();
  const byteW = Math.ceil(imgW / 8); // bytes per row

  // Brightness lift before dithering — thermal paper prints darker than it looks
  // on screen. Lifting brightness here compensates so output matches Windows GDI.
  // Tune with PRINT_BRIGHTNESS env var (0-255 additive lift, default 40).
  const brightness = parseInt(process.env.PRINT_BRIGHTNESS || "40", 10);

  // Build a float32 grayscale buffer for dithering
  const gray = new Float32Array(imgW * imgH);
  for (let y = 0; y < imgH; y++) {
    for (let x = 0; x < imgW; x++) {
      const pixel = Jimp.intToRGBA(img.getPixelColor(x, y));
      const luma  = (pixel.r * 299 + pixel.g * 587 + pixel.b * 114) / 1000;
      // Clamp lifted value to 255
      gray[y * imgW + x] = Math.min(255, luma + brightness);
    }
  }

  // Floyd-Steinberg dithering — spreads quantization error to neighbours,
  // producing natural-looking grayscale on a 1-bit thermal printer.
  //        [ *  7 ]
  //    [ 3  5  1 ] / 16
  for (let y = 0; y < imgH; y++) {
    for (let x = 0; x < imgW; x++) {
      const idx   = y * imgW + x;
      const old   = gray[idx];
      const nw    = old < 128 ? 0 : 255;
      gray[idx]   = nw;
      const err   = old - nw;

      if (x + 1 < imgW)               gray[idx + 1]          += err * 7 / 16;
      if (y + 1 < imgH && x > 0)      gray[idx + imgW - 1]   += err * 3 / 16;
      if (y + 1 < imgH)               gray[idx + imgW]        += err * 5 / 16;
      if (y + 1 < imgH && x + 1 < imgW) gray[idx + imgW + 1] += err * 1 / 16;
    }
  }

  // Convert dithered buffer to 1-bit raster rows
  const rasterRows = [];
  for (let y = 0; y < imgH; y++) {
    const row = Buffer.alloc(byteW, 0);
    for (let x = 0; x < imgW; x++) {
      if (gray[y * imgW + x] < 128) {
        row[Math.floor(x / 8)] |= (0x80 >> (x % 8));
      }
    }
    rasterRows.push(row);
  }

  const buffers = [];
  buffers.push(CMD.INIT);
  buffers.push(CMD.ALIGN_CENTER);

  // GS v 0 — raster bit image
  // Format: GS 'v' '0' m xL xH yL yH [data]
  // m=0 normal density, xL/xH = bytes per row, yL/yH = rows
  const xL = byteW & 0xff;
  const xH = (byteW >> 8) & 0xff;
  const yL = imgH & 0xff;
  const yH = (imgH >> 8) & 0xff;

  buffers.push(Buffer.from([GS, 0x76, 0x30, 0x00, xL, xH, yL, yH]));
  for (const row of rasterRows) {
    buffers.push(row);
  }

  buffers.push(CMD.FEED_LINES(4));
  buffers.push(CMD.CUT);

  await writeToDevice(device, buffers);
}

// ── CUPS fallback ─────────────────────────────────────────────────────────────
function lpPrint(filePath, printerName) {
  return new Promise((resolve, reject) => {
    const args = printerName ? ["-d", printerName, filePath] : [filePath];
    execFile("lp", args, (err, stdout, stderr) => {
      if (err) reject(new Error("lp failed: " + (stderr || err.message)));
      else resolve();
    });
  });
}

async function cupsText(textPayload, fontSize, tempDir) {
  // Lazy-load canvas only when needed (not installed on all systems)
  let createCanvas, registerFont;
  try {
    const canvasLib = require("canvas");
    createCanvas  = canvasLib.createCanvas;
    registerFont  = canvasLib.registerFont;
  } catch (e) {
    throw new Error("canvas module not found. Run: npm install canvas  or set PRINTER_DEVICE for raw ESC/POS mode.");
  }

  const c        = cfg();
  const dpi      = c.dpi;
  const widthPx  = mmToPx(c.widthMm, dpi);
  const bodyPtPx = ptToPx(fontSize || c.fontSize, dpi);
  const metaPtPx = ptToPx(9, dpi);

  const IS_MAC = process.platform === "darwin";

  const fontCandidates = [
    // ── Linux paths ──────────────────────────────────────────────────────────
    "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeMono.ttf",
    "/usr/share/fonts/liberation-mono/LiberationMono-Bold.ttf",
    "/usr/share/fonts/liberation/LiberationMono-Bold.ttf",
    // ── macOS paths ──────────────────────────────────────────────────────────
    // Homebrew-installed Liberation fonts (Apple Silicon & Intel)
    "/opt/homebrew/share/fonts/liberation-fonts/LiberationMono-Bold.ttf",
    "/usr/local/share/fonts/liberation/LiberationMono-Bold.ttf",
    // User-installed via Font Book
    `${process.env.HOME}/Library/Fonts/LiberationMono-Bold.ttf`,
    // Courier New ships with macOS (in Supplemental on 10.15+, root on older)
    "/System/Library/Fonts/Supplemental/Courier New Bold.ttf",
    "/Library/Fonts/Courier New Bold.ttf",
    // Fallback: plain Courier New (not bold, but readable)
    "/System/Library/Fonts/Supplemental/Courier New.ttf",
    "/Library/Fonts/Courier New.ttf",
  ];
  let registeredFamily = "monospace";
  for (const f of fontCandidates) {
    if (fs.existsSync(f)) {
      try { registerFont(f, { family: "PrintMono", weight: "bold" }); registeredFamily = "PrintMono"; }
      catch {}
      break;
    }
  }

  const bodyFont = `bold ${bodyPtPx}px ${registeredFamily}`;
  const metaFont = `bold ${metaPtPx}px ${registeredFamily}`;
  const LINE_MULT = 0.72;

  function isMetaLine(l) { return /^(From:|Email:|Time:|={3,}|-{3,})/.test(l); }
  function lineH(ptPx) { return Math.ceil(ptPx * LINE_MULT); }

  const lines  = textPayload.split(/\r?\n/);
  let totalH   = 20;
  for (const line of lines) totalH += lineH(isMetaLine(line) ? metaPtPx : bodyPtPx);

  const canvas = createCanvas(widthPx, totalH);
  const ctx    = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, widthPx, totalH);
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "top";

  let y = 1;
  for (const line of lines) {
    const ptPx = isMetaLine(line) ? metaPtPx : bodyPtPx;
    ctx.font = isMetaLine(line) ? metaFont : bodyFont;
    if (line.length > 0) {
      let x = 0;
      for (const char of line) {
        const w = ctx.measureText(char).width;
        if (char !== " ") ctx.fillText(char, x, y);
        x += char === " " ? ctx.measureText("M").width * 0.6 : w;
      }
    }
    y += lineH(ptPx);
  }

  const tmpFile = path.join(tempDir, `text-${Date.now()}.png`);
  fs.writeFileSync(tmpFile, canvas.toBuffer("image/png"));
  try { await lpPrint(tmpFile, c.printerName); }
  finally { try { fs.unlinkSync(tmpFile); } catch {} }
}

async function cupsImage(imageBuffer, tempDir) {
  const c       = cfg();
  const widthPx = mmToPx(c.widthMm, c.dpi);
  const img     = await Jimp.read(imageBuffer);
  img.resize(widthPx, Jimp.AUTO);
  const tmpFile = path.join(tempDir, `img-${Date.now()}.png`);
  await img.writeAsync(tmpFile);
  try { await lpPrint(tmpFile, c.printerName); }
  finally { try { fs.unlinkSync(tmpFile); } catch {} }
}

// ── Public API ────────────────────────────────────────────────────────────────
async function printText(textPayload, fontSize, tempDir) {
  const device = cfg().device;
  if (device) {
    await escposText(textPayload, device);
  } else {
    await cupsText(textPayload, fontSize, tempDir);
  }
}

async function printImage(imageBuffer, tempDir) {
  const device = cfg().device;
  if (device) {
    await escposImage(imageBuffer, device);
  } else {
    await cupsImage(imageBuffer, tempDir);
  }
}

module.exports = { printText, printImage };
