/**
 * print-linux.js
 * Linux/macOS printing with two transports, sharing ONE rendering pipeline:
 *
 * 1. RAW / ESC-POS  (recommended for USB thermal printers)
 *    Set PRINTER_DEVICE=/dev/usb/lp0 (or /dev/lp0, or /dev/cu.usbserial-* on macOS)
 *    Text and images are sent as ESC/POS commands directly to the device.
 *    No CUPS, no drivers needed. Works with virtually all thermal receipt printers.
 *    The node process needs read/write access to the device:
 *      sudo usermod -aG lp $USER   (then log out and back in)
 *
 * 2. CUPS  (if PRINTER_DEVICE is not set)
 *    Default mode ("raw"): the SAME ESC/POS bytes used in device mode are sent
 *    through CUPS with `lp -o raw`, which tells CUPS to skip all filtering and
 *    stream the bytes straight to the printer. This is the standard way to
 *    drive a thermal receipt printer through CUPS, and is what almost every
 *    "generic"/"raw" CUPS queue for this class of printer expects.
 *
 *    Legacy mode ("image", opt-in via PRINT_CUPS_MODE=image): renders text to a
 *    PNG via node-canvas and lets CUPS' own filter chain interpret the PNG.
 *    Only useful if your CUPS queue has a real image-capable driver (uncommon
 *    for thermal receipt printers). Requires: npm install canvas
 *    + apt install libcairo2-dev libpango1.0-dev.
 *
 * Why "raw" is the default: sending a PNG file to a CUPS queue that has no
 * image filter (the normal setup for USB/network thermal printers, which are
 * almost always registered as a "raw" or "generic text-only" queue) does NOT
 * fail loudly — CUPS just streams the literal PNG bytes to the printer, which
 * is sitting in plain-text mode and prints every byte as its ASCII character,
 * producing a receipt full of garbled symbols. This is the #1 cause of
 * "images print as random characters" reports, and it's inconsistent across
 * machines because it depends entirely on how each printer's CUPS queue
 * happens to be configured — not on anything about the image itself. Using
 * `-o raw` with real ESC/POS bytes sidesteps the whole problem: it behaves
 * identically to the direct-device path, just delivered through CUPS instead
 * of a raw file handle.
 *
 * Environment variables:
 *   PRINTER_DEVICE   - raw device path e.g. /dev/usb/lp0  (enables ESC/POS device mode)
 *   PRINTER_NAME     - CUPS destination name (used in CUPS mode)
 *   PRINT_CUPS_MODE  - raw (default) | image  — see above
 *   PRINT_FONT_SIZE  - body font size in points (default 9)
 *   PRINT_COLUMNS    - chars per line (default 24)
 *   PRINT_DPI        - image scaling DPI (default 203)
 *   PRINT_WIDTH_MM   - paper width mm (default 58)
 *   PRINT_BRIGHTNESS - image brightness lift before dithering, 0-255 (default 40)
 *   PRINT_RASTER_CHUNK_ROWS - max raster lines per ESC/POS graphics command
 *                             (default 256). Large single commands can overflow
 *                             a printer's internal buffer and desync it, which
 *                             also shows up as garbled character output — this
 *                             caps each command to a safe size regardless of
 *                             how tall the source image is.
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
    cupsMode:    (process.env.PRINT_CUPS_MODE || "raw").toLowerCase(), // raw | image
    fontSize:    parseInt(process.env.PRINT_FONT_SIZE || "9",   10),
    columns:     parseInt(process.env.PRINT_COLUMNS   || "24",  10),
    dpi:         parseInt(process.env.PRINT_DPI        || "203", 10),
    widthMm:     parseFloat(process.env.PRINT_WIDTH_MM || "58"),
    brightness:  parseInt(process.env.PRINT_BRIGHTNESS || "40",  10),
    chunkRows:   parseInt(process.env.PRINT_RASTER_CHUNK_ROWS || "256", 10),
  };
}

function mmToPx(mm, dpi) { return Math.round(mm * dpi / 25.4); }
function ptToPx(pt, dpi) { return Math.round(pt * dpi / 72); }

// ── ESC/POS constants ─────────────────────────────────────────────────────────
const ESC = 0x1b;
const GS  = 0x1d;

const CMD = {
  INIT:             Buffer.from([ESC, 0x40]),                // Initialize printer
  ALIGN_LEFT:       Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER:     Buffer.from([ESC, 0x61, 0x01]),
  BOLD_ON:          Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF:         Buffer.from([ESC, 0x45, 0x00]),
  NORMAL_SIZE:      Buffer.from([ESC, 0x21, 0x00]),
  FEED_LINES:       (n) => Buffer.from([ESC, 0x64, n]),      // Feed n lines
  CUT:              Buffer.from([GS,  0x56, 0x41, 0x00]),    // Partial cut
  LF:               Buffer.from([0x0a]),
  SET_LINE_SPACING: (n) => Buffer.from([ESC, 0x33, n]),      // n/180 inch line spacing
};

// ── Write raw bytes to a device file ────────────────────────────────────────────
function writeToDevice(device, buffers) {
  return new Promise((resolve, reject) => {
    let fd;
    try {
      fd = fs.openSync(device, "w");
      for (const buf of buffers) fs.writeSync(fd, buf, 0, buf.length);
      resolve();
    } catch (err) {
      reject(new Error(`Device write failed (${device}): ${err.message}\n` +
        `Make sure you have write permission: sudo usermod -aG lp $USER`));
    } finally {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    }
  });
}

// ── Shared: build ESC/POS text command buffers ──────────────────────────────────
// Used by BOTH the direct-device path and the CUPS raw-queue path, so the two
// transports can never produce different output for the same message.
function buildEscPosTextBuffers(textPayload) {
  const buffers = [];
  buffers.push(CMD.INIT);
  buffers.push(CMD.ALIGN_LEFT);
  // Tight line spacing: 24/180 inch ≈ 3.4mm — adjust if lines overlap
  buffers.push(CMD.SET_LINE_SPACING(24));

  for (const line of textPayload.split(/\r?\n/)) {
    buffers.push(CMD.BOLD_ON);
    buffers.push(CMD.NORMAL_SIZE);
    // Encode as CP437 (ESC/POS default code page) — safe ASCII fallback.
    // For full Unicode, a font cartridge or UTF-8 capable printer is needed.
    buffers.push(Buffer.from(line, "ascii"));
    buffers.push(CMD.LF);
  }

  buffers.push(CMD.BOLD_OFF);
  buffers.push(CMD.FEED_LINES(4));
  buffers.push(CMD.CUT);
  return buffers;
}

// ── Shared: dither + rasterize an image into ESC/POS graphics commands ─────────
// Chunks the raster into bands of at most `chunkRows` lines, each with its own
// GS v 0 header, instead of one command covering the whole image. A single
// oversized raster command can overflow a thermal printer's internal image
// buffer — when that happens the printer loses sync with the command stream
// and starts printing the raw following bytes as literal characters, which
// looks identical to the "PNG sent to a raw queue" failure. Chunking removes
// this failure mode regardless of image height or printer buffer size.
async function buildEscPosImageBuffers(imageBuffer, c) {
  const widthPx = Math.floor(mmToPx(c.widthMm, c.dpi) / 8) * 8;

  const img = await Jimp.read(imageBuffer);
  img.resize(widthPx, Jimp.AUTO);
  img.greyscale();

  const imgW  = img.getWidth();
  const imgH  = img.getHeight();
  const byteW = Math.ceil(imgW / 8); // bytes per row

  // Brightness lift before dithering — thermal paper prints darker than it
  // looks on screen. Lifting brightness here compensates so output matches
  // Windows GDI output. Tune with PRINT_BRIGHTNESS.
  const gray = new Float32Array(imgW * imgH);
  for (let y = 0; y < imgH; y++) {
    for (let x = 0; x < imgW; x++) {
      const pixel = Jimp.intToRGBA(img.getPixelColor(x, y));
      const luma  = (pixel.r * 299 + pixel.g * 587 + pixel.b * 114) / 1000;
      gray[y * imgW + x] = Math.min(255, luma + c.brightness);
    }
  }

  // Floyd-Steinberg dithering — spreads quantization error to neighbours,
  // producing natural-looking grayscale on a 1-bit thermal printer.
  //        [ *  7 ]
  //    [ 3  5  1 ] / 16
  for (let y = 0; y < imgH; y++) {
    for (let x = 0; x < imgW; x++) {
      const idx = y * imgW + x;
      const old = gray[idx];
      const nw  = old < 128 ? 0 : 255;
      gray[idx] = nw;
      const err = old - nw;
      if (x + 1 < imgW)                  gray[idx + 1]          += err * 7 / 16;
      if (y + 1 < imgH && x > 0)         gray[idx + imgW - 1]   += err * 3 / 16;
      if (y + 1 < imgH)                  gray[idx + imgW]        += err * 5 / 16;
      if (y + 1 < imgH && x + 1 < imgW)  gray[idx + imgW + 1]   += err * 1 / 16;
    }
  }

  // Convert dithered buffer to 1-bit raster rows
  const rasterRows = [];
  for (let y = 0; y < imgH; y++) {
    const row = Buffer.alloc(byteW, 0);
    for (let x = 0; x < imgW; x++) {
      if (gray[y * imgW + x] < 128) row[Math.floor(x / 8)] |= (0x80 >> (x % 8));
    }
    rasterRows.push(row);
  }

  const chunkRows = Math.max(1, c.chunkRows || 256);
  const buffers = [CMD.INIT, CMD.ALIGN_CENTER];

  // GS v 0 — raster bit image, sent in bands of `chunkRows` lines at a time.
  // Format per band: GS 'v' '0' m xL xH yL yH [data]
  // m=0 normal density, xL/xH = bytes per row, yL/yH = rows in THIS band.
  for (let start = 0; start < imgH; start += chunkRows) {
    const band  = rasterRows.slice(start, Math.min(start + chunkRows, imgH));
    const bandH = band.length;
    const xL = byteW & 0xff, xH = (byteW >> 8) & 0xff;
    const yL = bandH & 0xff, yH = (bandH >> 8) & 0xff;
    buffers.push(Buffer.from([GS, 0x76, 0x30, 0x00, xL, xH, yL, yH]));
    for (const row of band) buffers.push(row);
  }

  buffers.push(CMD.FEED_LINES(4));
  buffers.push(CMD.CUT);
  return buffers;
}

// ── Direct-device (ESC/POS) transport ───────────────────────────────────────────
async function escposText(textPayload, device) {
  await writeToDevice(device, buildEscPosTextBuffers(textPayload));
}

async function escposImage(imageBuffer, device, c) {
  const buffers = await buildEscPosImageBuffers(imageBuffer, c);
  await writeToDevice(device, buffers);
}

// ── CUPS transport ──────────────────────────────────────────────────────────────
function lpPrint(filePath, printerName, raw) {
  return new Promise((resolve, reject) => {
    const args = raw ? ["-o", "raw"] : [];
    if (printerName) args.push("-d", printerName);
    args.push(filePath);
    execFile("lp", args, (err, _stdout, stderr) => {
      if (err) reject(new Error("lp failed: " + (stderr || err.message)));
      else resolve();
    });
  });
}

// Default CUPS transport: same ESC/POS bytes as the direct-device path,
// delivered via `lp -o raw` so CUPS streams them through untouched.
async function cupsTextRaw(textPayload, tempDir, c) {
  const buffers = buildEscPosTextBuffers(textPayload);
  const tmpFile = path.join(tempDir, `text-${Date.now()}.bin`);
  fs.writeFileSync(tmpFile, Buffer.concat(buffers));
  try { await lpPrint(tmpFile, c.printerName, true); }
  finally { try { fs.unlinkSync(tmpFile); } catch {} }
}

async function cupsImageRaw(imageBuffer, tempDir, c) {
  const buffers = await buildEscPosImageBuffers(imageBuffer, c);
  const tmpFile = path.join(tempDir, `img-${Date.now()}.bin`);
  fs.writeFileSync(tmpFile, Buffer.concat(buffers));
  try { await lpPrint(tmpFile, c.printerName, true); }
  finally { try { fs.unlinkSync(tmpFile); } catch {} }
}

// ── Legacy CUPS transport (opt-in via PRINT_CUPS_MODE=image) ───────────────────
// Renders to PNG and lets CUPS' own filter chain handle it. Only useful for a
// CUPS queue with a real image-capable driver — most thermal receipt printer
// queues do not have one, which is exactly the setup that produces garbled
// "random character" output, so this is no longer the default.
const FONT_CANDIDATES = [
  // Linux
  "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
  "/usr/share/fonts/truetype/freefont/FreeMono.ttf",
  "/usr/share/fonts/liberation-mono/LiberationMono-Bold.ttf",
  "/usr/share/fonts/liberation/LiberationMono-Bold.ttf",
  // macOS
  "/opt/homebrew/share/fonts/liberation-fonts/LiberationMono-Bold.ttf",
  "/usr/local/share/fonts/liberation/LiberationMono-Bold.ttf",
  `${process.env.HOME}/Library/Fonts/LiberationMono-Bold.ttf`,
  "/System/Library/Fonts/Supplemental/Courier New Bold.ttf",
  "/Library/Fonts/Courier New Bold.ttf",
  "/System/Library/Fonts/Supplemental/Courier New.ttf",
  "/Library/Fonts/Courier New.ttf",
];

async function cupsTextImage(textPayload, fontSize, tempDir, c) {
  let createCanvas, registerFont;
  try {
    const canvasLib = require("canvas");
    createCanvas  = canvasLib.createCanvas;
    registerFont  = canvasLib.registerFont;
  } catch (e) {
    throw new Error("canvas module not found. Run: npm install canvas  " +
      "or unset PRINT_CUPS_MODE=image to use the default raw ESC/POS mode instead.");
  }

  const dpi      = c.dpi;
  const widthPx  = mmToPx(c.widthMm, dpi);
  const bodyPtPx = ptToPx(fontSize || c.fontSize, dpi);
  const metaPtPx = ptToPx(9, dpi);

  let registeredFamily = "monospace";
  for (const f of FONT_CANDIDATES) {
    if (fs.existsSync(f)) {
      try { registerFont(f, { family: "PrintMono", weight: "bold" }); registeredFamily = "PrintMono"; }
      catch {}
      break;
    }
  }

  const bodyFont  = `bold ${bodyPtPx}px ${registeredFamily}`;
  const metaFont  = `bold ${metaPtPx}px ${registeredFamily}`;
  const LINE_MULT = 0.72;
  const isMetaLine = (l) => /^(From:|Email:|Time:|={3,}|-{3,})/.test(l);
  const lineH      = (ptPx) => Math.ceil(ptPx * LINE_MULT);

  const lines = textPayload.split(/\r?\n/);
  let totalH  = 20;
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
    ctx.font   = isMetaLine(line) ? metaFont : bodyFont;
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
  try { await lpPrint(tmpFile, c.printerName, false); }
  finally { try { fs.unlinkSync(tmpFile); } catch {} }
}

async function cupsImagePng(imageBuffer, tempDir, c) {
  const widthPx = mmToPx(c.widthMm, c.dpi);
  const img     = await Jimp.read(imageBuffer);
  img.resize(widthPx, Jimp.AUTO);
  const tmpFile = path.join(tempDir, `img-${Date.now()}.png`);
  await img.writeAsync(tmpFile);
  try { await lpPrint(tmpFile, c.printerName, false); }
  finally { try { fs.unlinkSync(tmpFile); } catch {} }
}

// ── Public API ────────────────────────────────────────────────────────────────
async function printText(textPayload, fontSize, tempDir) {
  const c = cfg();
  if (c.device) {
    await escposText(textPayload, c.device);
  } else if (c.cupsMode === "image") {
    await cupsTextImage(textPayload, fontSize, tempDir, c);
  } else {
    await cupsTextRaw(textPayload, tempDir, c);
  }
}

async function printImage(imageBuffer, tempDir) {
  const c = cfg();
  if (c.device) {
    await escposImage(imageBuffer, c.device, c);
  } else if (c.cupsMode === "image") {
    await cupsImagePng(imageBuffer, tempDir, c);
  } else {
    await cupsImageRaw(imageBuffer, tempDir, c);
  }
}

module.exports = { printText, printImage };
