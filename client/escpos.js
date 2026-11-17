/**
 * escpos.js — turns a receipt model (see layout.js) into one ESC/POS job.
 *
 * Used on every OS and every connection type, so a message prints the same
 * whether it goes to /dev/usb/lp0, a CUPS queue, or a Windows printer.
 *
 * One job per receipt: init, emoji definitions, every line, any image, then a
 * single feed + cut. A message is one receipt unless its printer prints images
 * on a separate receipt (layout.buildJobs).
 */

"use strict";

const Jimp = require("jimp");
const { CP437_BYTE, emojiGlyph } = require("./layout");

const ESC = 0x1b;
const GS  = 0x1d;

const CMD = {
  INIT:            Buffer.from([ESC, 0x40]),
  CODEPAGE_437:    Buffer.from([ESC, 0x74, 0x00]),
  ALIGN_LEFT:      Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER:    Buffer.from([ESC, 0x61, 0x01]),
  DEFAULT_SPACING: Buffer.from([ESC, 0x32]),
  USER_CHARS_ON:   Buffer.from([ESC, 0x25, 0x01]),
  USER_CHARS_OFF:  Buffer.from([ESC, 0x25, 0x00]),
  LF:              Buffer.from([0x0a]),
  CUT:             Buffer.from([GS, 0x56, 0x41, 0x00]),  // feed + partial cut
  font:      (f) => Buffer.from([ESC, 0x4d, f === "b" ? 1 : 0]),
  size:      (m) => Buffer.from([GS, 0x21, ((m - 1) << 4) | (m - 1)]),
  spacing:   (n) => Buffer.from([ESC, 0x33, Math.min(255, n)]),
  bold:      (on) => Buffer.from([ESC, 0x45, on ? 1 : 0]),
  underline: (on) => Buffer.from([ESC, 0x2d, on ? 1 : 0]),
  invert:    (on) => Buffer.from([GS, 0x42, on ? 1 : 0]),
  feed:      (n) => Buffer.from([ESC, 0x64, n]),
  feedDots:  (n) => Buffer.from([ESC, 0x4a, Math.max(0, Math.min(255, n))]),
};

// Custom character cells, per font: Font A is 12 dots wide, Font B 9. Each
// emoji spans two cells; see scripts/build-emoji-glyphs.js for the format.
const CELL_COLUMNS = { a: 12, b: 9 };
const FIRST_CODE   = 33;

function encodeText(text) {
  return Buffer.from([...text].map((ch) => CP437_BYTE.get(ch) ?? 0x3f));
}

// Line spacing: character height plus a small gap that grows with size. Tight
// lines (boxes, rules, banners) have no gap so borders join up.
function lineSpacing(size, tight) {
  return size.cellH + (tight ? 0 : 2 + 2 * size.mult);
}

// ── Emoji ─────────────────────────────────────────────────────────────────────
// Every distinct emoji gets two codes, shared across fonts. Each font that
// shows an emoji gets its own definition, since custom characters are stored
// per font.
function emojiPlan(model) {
  const codes = new Map();
  const byFont = { a: new Set(), b: new Set() };
  for (const block of model) {
    if (block.type !== "line") continue;
    for (const span of block.spans) {
      if (!span.emoji) continue;
      if (!codes.has(span.emoji)) codes.set(span.emoji, FIRST_CODE + codes.size * 2);
      byFont[block.size.font].add(span.emoji);
    }
  }
  return { codes, byFont };
}

function defineEmoji(font, keys, codes) {
  const out = [CMD.font(font)];
  const cols = CELL_COLUMNS[font];
  for (const key of keys) {
    const glyph = emojiGlyph(key);
    const data = Buffer.from(glyph[font === "a" ? 0 : 1], "base64");
    const code = codes.get(key);
    // ESC & y c1 c2, then for each code: width, then width × 3 bytes.
    out.push(Buffer.from([ESC, 0x26, 3, code, code + 1]));
    out.push(Buffer.from([cols]), data.subarray(0, cols * 3));
    out.push(Buffer.from([cols]), data.subarray(cols * 3, cols * 6));
  }
  return out;
}

// ── Text lines ────────────────────────────────────────────────────────────────
function lineCommands(block, codes) {
  const { size } = block;
  const out = [
    CMD.font(size.font),
    CMD.size(size.mult),
    CMD.spacing(lineSpacing(size, block.tight)),
    CMD.invert(block.invert),
  ];
  let bold = false, underline = false;
  for (const span of block.spans) {
    if (span.bold !== bold)           { bold = span.bold;           out.push(CMD.bold(bold)); }
    if (span.underline !== underline) { underline = span.underline; out.push(CMD.underline(underline)); }
    if (span.emoji) {
      const code = codes.get(span.emoji);
      out.push(CMD.USER_CHARS_ON, Buffer.from([code, code + 1]), CMD.USER_CHARS_OFF);
    } else {
      out.push(encodeText(span.text));
    }
  }
  if (bold)         out.push(CMD.bold(false));
  if (underline)    out.push(CMD.underline(false));
  if (block.invert) out.push(CMD.invert(false));
  out.push(CMD.LF);
  return out;
}

// ── Images ────────────────────────────────────────────────────────────────────
// Scales to the printer width, lifts brightness (thermal paper prints darker
// than a screen), and Floyd-Steinberg dithers to 1 bit.
async function imageRows(imageBuffer, widthDots, brightness) {
  const img = await Jimp.read(imageBuffer);
  img.resize(widthDots, Jimp.AUTO);
  img.greyscale();

  const w = img.getWidth();
  const h = img.getHeight();
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = Jimp.intToRGBA(img.getPixelColor(x, y));
      gray[y * w + x] = Math.min(255, (p.r * 299 + p.g * 587 + p.b * 114) / 1000 + brightness);
    }
  }

  //        [ *  7 ]
  //    [ 3  5  1 ] / 16
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = gray[i];
      const nw = old < 128 ? 0 : 255;
      gray[i] = nw;
      const err = old - nw;
      if (x + 1 < w)              gray[i + 1]     += err * 7 / 16;
      if (y + 1 < h && x > 0)     gray[i + w - 1] += err * 3 / 16;
      if (y + 1 < h)              gray[i + w]     += err * 5 / 16;
      if (y + 1 < h && x + 1 < w) gray[i + w + 1] += err * 1 / 16;
    }
  }

  const byteW = Math.ceil(w / 8);
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(byteW, 0);
    for (let x = 0; x < w; x++) {
      if (gray[y * w + x] < 128) row[x >> 3] |= 0x80 >> (x & 7);
    }
    rows.push(row);
  }
  return rows;
}

// GS v 0 raster, sent in bands of `chunkRows` lines. One oversized command can
// overflow a printer's buffer and desync it, which prints garbage characters.
function rasterCommands(rows, chunkRows) {
  if (!rows.length) return [];
  const byteW = rows[0].length;
  const out = [CMD.ALIGN_CENTER];
  for (let start = 0; start < rows.length; start += chunkRows) {
    const band = rows.slice(start, start + chunkRows);
    out.push(Buffer.from([
      GS, 0x76, 0x30, 0x00,
      byteW & 0xff, (byteW >> 8) & 0xff,
      band.length & 0xff, (band.length >> 8) & 0xff,
    ]));
    out.push(...band);
  }
  out.push(CMD.ALIGN_LEFT);
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * @param model             from layout.buildReceipt / buildTestPage
 * @param opts.widthDots    printer width in dots
 * @param opts.brightness   image brightness lift, 0-255
 * @param opts.chunkRows    max raster rows per GS v 0 command
 * @returns Buffer — the complete job
 */
async function build(model, { widthDots, brightness = 40, chunkRows = 256 }) {
  const out = [CMD.INIT, CMD.CODEPAGE_437];

  const { codes, byFont } = emojiPlan(model);
  for (const font of ["a", "b"]) {
    if (byFont[font].size) out.push(...defineEmoji(font, byFont[font], codes));
  }

  for (const block of model) {
    if (block.type === "line") {
      out.push(...lineCommands(block, codes));
    } else if (block.type === "image") {
      out.push(...rasterCommands(await imageRows(block.buffer, widthDots, brightness), Math.max(1, chunkRows)));
    } else if (block.type === "raster") {
      out.push(...rasterCommands(block.rows, Math.max(1, chunkRows)));
    } else if (block.type === "gap") {
      out.push(CMD.feedDots(block.dots));
    }
  }

  out.push(CMD.font("a"), CMD.size(1), CMD.DEFAULT_SPACING, CMD.feed(4), CMD.CUT);
  return Buffer.concat(out);
}

module.exports = { build, imageRows, lineSpacing };
