/**
 * build-emoji-glyphs.js — regenerates client/emoji-glyphs.json.
 *
 * Dev-only. Run once when updating the emoji set; the JSON it writes is
 * committed, so printing never needs a font renderer at runtime.
 *
 *   npm install            (pulls the devDependencies below)
 *   node scripts/build-emoji-glyphs.js "/path/to/NotoEmoji[wght].ttf"
 *
 * Font: Noto Emoji (monochrome), SIL Open Font License 1.1
 *   https://github.com/google/fonts/tree/main/ofl/notoemoji
 *
 * Each emoji is rendered twice, sized for the printer's two built-in fonts,
 * because ESC/POS custom characters are defined per font:
 *   Font A: 24×24 dots → two 12×24 character cells
 *   Font B: 17×17 dots, centred in two 9×24 cells (Font B only prints the
 *           top 17 rows)
 *
 * Bitmaps are stored in ESC & column format: for each column left to right,
 * 3 bytes covering rows 0-7, 8-15, 16-23, most significant bit at the top.
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
const opentype = require("opentype.js");

const OUT_FILE   = path.join(__dirname, "..", "emoji-glyphs.json");
const FAMILY     = "PrintBridgeEmoji";
const WEIGHT     = 700;  // the heaviest weight; thin strokes vanish at 1-bit
const SUPERSAMPLE = 8;   // render 8× larger, then average down to dots
const THRESHOLD  = 0.4;  // fraction of a dot that must be ink to print it

const FONT_A = { cellW: 12, glyphW: 24, glyphH: 24 };
const FONT_B = { cellW: 9,  glyphW: 17, glyphH: 17 };

function renderDots(ch, w, h) {
  const canvas = createCanvas(w * SUPERSAMPLE, h * SUPERSAMPLE);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.font = `${WEIGHT} ${canvas.height}px ${FAMILY}`;

  // Scale the glyph's ink box (not its em box) to fill the cell, centred.
  const m  = ctx.measureText(ch);
  const bw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  const bh = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  if (!(bw > 0 && bh > 0)) return null;
  const scale = Math.min(canvas.width / bw, canvas.height / bh) * 0.98;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(scale, scale);
  ctx.fillText(ch,
    -(m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2,
    (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);

  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const dots = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < SUPERSAMPLE; dy++) {
        for (let dx = 0; dx < SUPERSAMPLE; dx++) {
          sum += px[((y * SUPERSAMPLE + dy) * canvas.width + x * SUPERSAMPLE + dx) * 4];
        }
      }
      row.push(1 - sum / (SUPERSAMPLE * SUPERSAMPLE * 255) >= THRESHOLD);
    }
    dots.push(row);
  }
  return dots;
}

// Places a glyph in a two-cell, 24-row box and packs it column by column.
function packColumns(dots, font) {
  const boxW = font.cellW * 2;
  const offX = Math.floor((boxW - font.glyphW) / 2);
  const out  = Buffer.alloc(boxW * 3);
  for (let y = 0; y < font.glyphH; y++) {
    for (let x = 0; x < font.glyphW; x++) {
      if (!dots[y][x]) continue;
      const col = x + offX;
      out[col * 3 + (y >> 3)] |= 0x80 >> (y & 7);
    }
  }
  return out.toString("base64");
}

function main() {
  const fontPath = process.argv[2];
  if (!fontPath || !fs.existsSync(fontPath)) {
    console.error('Usage: node scripts/build-emoji-glyphs.js "/path/to/NotoEmoji[wght].ttf"');
    process.exit(1);
  }

  GlobalFonts.registerFromPath(fontPath, FAMILY);
  const font = opentype.parse(fs.readFileSync(fontPath));

  // Only code points the font actually has, so the renderer never falls back
  // to a system emoji font.
  const codePoints = Object.keys(font.tables.cmap.glyphIndexMap)
    .map(Number)
    .filter((cp) => /\p{Extended_Pictographic}/u.test(String.fromCodePoint(cp)))
    .sort((a, b) => a - b);

  const glyphs = {};
  for (const cp of codePoints) {
    const ch = String.fromCodePoint(cp);
    const a  = renderDots(ch, FONT_A.glyphW, FONT_A.glyphH);
    const b  = renderDots(ch, FONT_B.glyphW, FONT_B.glyphH);
    if (!a || !b) continue;
    glyphs[cp.toString(16)] = [packColumns(a, FONT_A), packColumns(b, FONT_B)];
  }

  const data = {
    source: "Noto Emoji, SIL Open Font License 1.1 — https://github.com/google/fonts/tree/main/ofl/notoemoji",
    format: "glyphs[codepoint hex] = [fontA, fontB]; base64, ESC & column format (3 bytes per column, MSB top). Font A: 24 columns, Font B: 18 columns.",
    glyphs,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(data) + "\n");
  console.log(`Wrote ${Object.keys(glyphs).length} emoji to ${path.relative(process.cwd(), OUT_FILE)}`);
}

main();
