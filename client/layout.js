/**
 * layout.js — turns a message into a receipt model: the exact lines to print,
 * already wrapped to the printer's width, plus any images.
 *
 * escpos.js turns the model into printer bytes (the normal path on every OS);
 * output.js has a fallback that hands the same model to an OS print driver.
 *
 * A message is usually one receipt. buildJobs() returns a list of models, each
 * printed and cut on its own, so a printer set to print images on a separate
 * receipt gets the image as a second job.
 *
 * Model blocks:
 *   { type: "line",   size, invert, tight, spans: [Span] }
 *   { type: "image",  buffer }                     image file bytes
 *   { type: "raster", widthDots, rows: [Buffer] }  ready-made 1-bit rows
 *
 * Span:
 *   { text, bold, underline }
 *   { emoji, raw, fallback, bold, underline }      prints 2 columns wide
 *
 * Every character in a text span is printable in code page 437; sanitize()
 * guarantees it.
 */

"use strict";

// ── Sizes ─────────────────────────────────────────────────────────────────────
// The printer's built-in sizes. Senders pick a size in points (that's what the
// API stores); each point size maps to the built-in size whose character height
// is closest at 203 dpi. Keep in sync with frontend/src/lib/printerGeometry.ts.
const SIZES = [
  { name: "Small",   pt: 7,  font: "b", mult: 1, cellW: 9,  cellH: 17 },
  { name: "Normal",  pt: 9,  font: "a", mult: 1, cellW: 12, cellH: 24 },
  { name: "Medium",  pt: 12, font: "b", mult: 2, cellW: 18, cellH: 34 },
  { name: "Large",   pt: 17, font: "a", mult: 2, cellW: 24, cellH: 48 },
  { name: "X-Large", pt: 25, font: "a", mult: 3, cellW: 36, cellH: 72 },
];
const NORMAL     = SIZES[1];
const X_LARGE    = SIZES[SIZES.length - 1];
const DEFAULT_PT = 9;  // messages with no size (API, email, feeds): Normal

// A message of only this many emoji or fewer prints at X-Large, like iMessage.
const BIG_EMOJI_MAX = 3;
const DOTS_PER_PT = 203 / 72;

const DEFAULT_WIDTH_DOTS = 384;

// Distinct emoji per receipt: each takes two of the 94 custom character codes.
const MAX_EMOJI = 47;

// Space between a message's text and its picture, in dots (3mm). Fixed rather
// than a blank line, so a large text size doesn't push the picture far down.
const IMAGE_GAP_DOTS = 24;

function sizeForPt(pt) {
  const target = (Number(pt) || DEFAULT_PT) * DOTS_PER_PT;
  let best = SIZES[0];
  for (const s of SIZES) {
    if (Math.abs(s.cellH - target) < Math.abs(best.cellH - target)) best = s;
  }
  return best;
}

function colsFor(widthDots, size) {
  return Math.max(1, Math.floor(widthDots / size.cellW));
}

// Printer width for a number of Normal-size characters per line: the common
// widths map to real printhead widths, anything else to cols × 12 rounded up
// to a whole byte. Same as dotsForCols in frontend/src/lib/printerGeometry.ts.
const WIDTH_PRESETS = { 32: 384, 42: 512, 48: 576 };
function dotsForCols(cols) {
  return WIDTH_PRESETS[cols] || Math.ceil(cols * NORMAL.cellW / 8) * 8;
}

// ── Characters ────────────────────────────────────────────────────────────────
// Code page 437, bytes 0x80-0xFF. Bytes 0x20-0x7E are plain ASCII.
const CP437_HIGH = [..."ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ "];
const CP437_BYTE = new Map();
for (let b = 0x20; b < 0x7f; b++) CP437_BYTE.set(String.fromCharCode(b), b);
CP437_HIGH.forEach((ch, i) => CP437_BYTE.set(ch, 0x80 + i));

// Common characters that aren't in code page 437.
const TEXT_REPLACEMENTS = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"',
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-",
  "…": "...", "•": "*", "‹": "<", "›": ">", "⁄": "/",
  "©": "(c)", "®": "(R)", "™": "TM", "€": "EUR",
  "×": "x", "→": "->", "←": "<-", "\t": "    ",
};

// Printed in place of an emoji when the printer can't draw it (Emoji: Text on
// the My Printer page), or when a receipt has more than MAX_EMOJI distinct ones.
// Keyed by the emoji's first code point. Anything not listed is left out.
const EMOJI_STAND_INS = {
  "1f600": ":D", "1f603": ":D", "1f604": ":D", "1f601": ":D", "1f605": ":D",
  "1f606": "XD", "1f602": "XD", "1f923": "XD",
  "1f60a": ":)", "1f642": ":)", "263a": ":)", "1f609": ";)", "1f60f": ";)",
  "1f60d": "<3", "1f970": "<3", "1f618": ":*", "1f617": ":*",
  "1f61b": ":P", "1f61c": ";P", "1f61d": "XP", "1f60e": "B)",
  "1f914": ":?", "1f610": ":|", "1f611": "-_-", "1f644": "-_-",
  "1f612": ":/", "1f615": ":/", "1f641": ":(", "2639": ":(", "1f61e": ":(",
  "1f622": ":'(", "1f62d": ":'(", "1f620": ">:(", "1f621": ">:(",
  "1f62e": ":O", "1f632": ":O", "1f631": ":O", "1f633": "O_O", "1f440": "o_o",
  "1f634": "Zzz", "1f607": "O:)", "1f608": ">:)", "1f480": "x_x", "1f917": "*hug*",
  "2764": "<3", "2665": "<3", "1f495": "<3", "1f496": "<3", "1f497": "<3",
  "1f499": "<3", "1f49a": "<3", "1f49b": "<3", "1f49c": "<3", "1f5a4": "<3",
  "1f90d": "<3", "1f9e1": "<3", "1f494": "</3",
  "1f44d": "(y)", "1f44e": "(n)", "1f44f": "*clap*", "1f64f": "*thanks*",
  "1f44b": "o/", "270c": "V", "1f4aa": "*flex*",
  "1f389": "*party*", "1f382": "*cake*", "1f381": "*gift*", "1f525": "*fire*",
  "2b50": "*", "1f31f": "*", "2728": "*", "1f4af": "100",
  "2705": "[x]", "2714": "[x]", "2611": "[x]", "274c": "X", "2716": "x",
  "26a0": "(!)", "2757": "!", "2753": "?",
  "2600": "*sun*", "2615": "*coffee*", "1f355": "*pizza*", "1f37a": "*beer*",
  "1f436": "*dog*", "1f431": "*cat*", "1f680": "*rocket*", "1f4a9": "*poop*",
};

// An emoji with its modifiers: flags, keycaps, or a pictograph with optional
// presentation selector, skin tone, and zero-width-joined parts.
const PICTO = "\\p{Extended_Pictographic}[\\uFE0E\\uFE0F]?\\p{Emoji_Modifier}?";
const TOKEN_RE = new RegExp(
  `(\\p{Regional_Indicator}{2})|([0-9#*]\\uFE0F?\\u20E3)|(${PICTO}(?:\\u200D${PICTO})*)|([\\s\\S])`,
  "gu"
);
const DROPPED_RE = /[\p{Cc}\p{Cf}\p{Mn}︎️\p{Emoji_Modifier}⃣]/u;

let emojiGlyphs;
function glyphTable() {
  if (emojiGlyphs === undefined) {
    try { emojiGlyphs = require("./emoji-glyphs.json").glyphs; }
    catch { emojiGlyphs = null; }
  }
  return emojiGlyphs;
}

function emojiGlyph(key) {
  const table = glyphTable();
  return table ? table[key] || null : null;
}

// Per-receipt state: which emoji get custom characters.
function newContext(emojiMode) {
  return { emojiMode: emojiMode === "text" ? "text" : "glyph", emoji: new Set() };
}

// One printable character, or one emoji. Width is in printer columns.
function charAtoms(text, style) {
  return [...text].map((ch) => ({ ch, ...style }));
}

function sanitizeChar(ch) {
  if (CP437_BYTE.has(ch)) return ch;
  if (TEXT_REPLACEMENTS[ch] !== undefined) return TEXT_REPLACEMENTS[ch];
  if (DROPPED_RE.test(ch)) return "";
  // Accented letters outside code page 437 lose their accent: ō → o.
  const plain = ch.normalize("NFKD").replace(/\p{M}/gu, "");
  return plain && [...plain].every((c) => CP437_BYTE.has(c)) ? plain : "?";
}

// Text → atoms, with emoji resolved to custom characters or stand-ins.
function toAtoms(text, style, ctx) {
  const atoms = [];
  for (const m of text.replace(/\r/g, "").matchAll(TOKEN_RE)) {
    const [, flag, keycap, emoji, single] = m;
    if (single !== undefined) {
      atoms.push(...charAtoms(sanitizeChar(single), style));
    } else if (flag) {
      const letters = [...flag].map((c) => String.fromCharCode(c.codePointAt(0) - 0x1f1e6 + 65)).join("");
      atoms.push(...charAtoms(`[${letters}]`, style));
    } else if (keycap) {
      atoms.push(...charAtoms(`[${keycap[0]}]`, style));
    } else if (TEXT_REPLACEMENTS[String.fromCodePoint(emoji.codePointAt(0))]) {
      // ©, ® and ™ count as emoji in Unicode, but read better as (c), (R), TM.
      atoms.push(...charAtoms(TEXT_REPLACEMENTS[String.fromCodePoint(emoji.codePointAt(0))], style));
    } else {
      const key = emoji.codePointAt(0).toString(16);
      const fallback = EMOJI_STAND_INS[key] || "";
      const canDraw = ctx.emojiMode === "glyph" && emojiGlyph(key)
        && (ctx.emoji.has(key) || ctx.emoji.size < MAX_EMOJI);
      if (canDraw) {
        ctx.emoji.add(key);
        atoms.push({ emoji: key, raw: emoji, fallback, ...style });
      } else {
        atoms.push(...charAtoms(fallback, style));
      }
    }
  }
  return atoms;
}

// True when the body is 1 to BIG_EMOJI_MAX emoji and nothing else (spaces and
// newlines allowed), so it prints at X-Large whatever size the sender chose.
function isBigEmoji(body) {
  let count = 0;
  for (const [, , , emoji, single] of body.matchAll(TOKEN_RE)) {
    if (single !== undefined) {
      if (/\s/.test(single) || DROPPED_RE.test(single)) continue;
      return false;
    }
    // ©, ® and ™ are emoji to Unicode but print as text.
    if (emoji && TEXT_REPLACEMENTS[String.fromCodePoint(emoji.codePointAt(0))]) return false;
    if (++count > BIG_EMOJI_MAX) return false;
  }
  return count > 0;
}

function atomWidth(a) { return a.emoji ? 2 : 1; }
function widthOf(atoms) { return atoms.reduce((w, a) => w + atomWidth(a), 0); }
function isSpace(a) { return !a.emoji && a.ch === " "; }

// Merges adjacent atoms with the same style back into spans.
function toSpans(atoms) {
  const spans = [];
  for (const a of atoms) {
    const style = { bold: !!a.bold, underline: !!a.underline };
    if (a.emoji) { spans.push({ emoji: a.emoji, raw: a.raw, fallback: a.fallback, ...style }); continue; }
    const last = spans[spans.length - 1];
    if (last && !last.emoji && last.bold === style.bold && last.underline === style.underline) last.text += a.ch;
    else spans.push({ text: a.ch, ...style });
  }
  return spans;
}

// ── Wrapping ──────────────────────────────────────────────────────────────────
// Word-wraps one paragraph of atoms to `cols`. Leading whitespace (indentation,
// ASCII art) is repeated on continuation lines; words longer than a line are
// broken.
function wrapAtoms(atoms, cols) {
  let leadLen = 0;
  while (leadLen < atoms.length && isSpace(atoms[leadLen])) leadLen++;
  if (leadLen === atoms.length) return [[]];
  // Keep at least half the line for text.
  const lead = atoms.slice(0, Math.min(leadLen, Math.floor(cols / 2)));

  // Each word keeps the space atom before it, so underlining carries across.
  const words = [{ sep: null, atoms: [] }];
  for (const a of atoms.slice(leadLen)) {
    if (isSpace(a)) words.push({ sep: a, atoms: [] });
    else words[words.length - 1].atoms.push(a);
  }

  const lines = [];
  let line = [...lead];
  let hasWord = false;
  for (const { sep, atoms: word } of words) {
    if (hasWord && widthOf(line) + 1 + widthOf(word) > cols) {
      lines.push(line);
      line = [...lead, ...word];
    } else {
      line = [...line, ...(hasWord ? [sep] : []), ...word];
    }
    hasWord = true;
    // Hard-break anything still too long, without splitting an emoji.
    while (widthOf(line) > cols) {
      let w = 0, cut = 0;
      while (cut < line.length && w + atomWidth(line[cut]) <= cols) w += atomWidth(line[cut++]);
      if (cut <= lead.length) cut = lead.length + 1; // always make progress
      lines.push(line.slice(0, cut));
      line = [...lead, ...line.slice(cut)];
    }
  }
  lines.push(line);
  return lines;
}

// ── Markup ────────────────────────────────────────────────────────────────────
// Inline **bold** and __underline__. A marker without a partner later in the
// line prints as-is.
function parseInline(text) {
  const parts = text.split(/(\*\*|__)/);
  const isMarker = (p) => p === "**" || p === "__";
  const counts = { "**": 0, "__": 0 };
  for (const p of parts) if (isMarker(p)) counts[p]++;
  const toggles = { "**": counts["**"] - (counts["**"] % 2), "__": counts["__"] - (counts["__"] % 2) };

  const segments = [];
  let bold = false, underline = false;
  for (const p of parts) {
    if (isMarker(p) && toggles[p] > 0) {
      toggles[p]--;
      if (p === "**") bold = !bold; else underline = !underline;
    } else if (p) {
      segments.push({ text: p, style: { bold, underline } });
    }
  }
  return segments;
}

function styledAtoms(text, ctx, base = {}) {
  return parseInline(text).flatMap((s) => toAtoms(s.text, {
    bold: base.bold || s.style.bold,
    underline: base.underline || s.style.underline,
  }, ctx));
}

function centred(atoms, width, fill = " ") {
  const pad = Math.max(0, width - widthOf(atoms));
  const left = Math.floor(pad / 2);
  return [...charAtoms(fill.repeat(left), {}), ...atoms, ...charAtoms(fill.repeat(pad - left), {})];
}

function line(size, atoms, opts = {}) {
  return { type: "line", size, invert: !!opts.invert, tight: !!opts.tight, spans: toSpans(atoms) };
}

function ruleLine(size, cols, ch) {
  return line(size, charAtoms(ch.repeat(cols), {}), { tight: true });
}

// Headers, loudest to quietest:
//   # Title     double-line box, one size larger than the message
//   ## Title    white text on a black bar
//   ### Title   ──── Title ──── divider
//   #### Title  bold, underlined, centred
// All span the full width whatever the message's alignment.

// The next size up (X-Large stays X-Large).
function sizeUp(size) {
  return SIZES[Math.min(SIZES.indexOf(size) + 1, SIZES.length - 1)];
}

// "# Title": a double-line box sized to the printer, title centred and bold.
function headerBox(text, size, cols, ctx) {
  const inner = cols - 2;
  const titleLines = wrapAtoms(styledAtoms(text, ctx, { bold: true }), Math.max(1, inner - 2));
  if (inner < 4) return titleLines.map((l) => line(size, centred(l, cols)));
  const edge = (l, r) => line(size, charAtoms(l + "═".repeat(inner) + r, {}), { tight: true });
  return [
    edge("╔", "╗"),
    ...titleLines.map((l) => line(size, [...charAtoms("║", {}), ...centred(l, inner), ...charAtoms("║", {})], { tight: true })),
    edge("╚", "╝"),
  ];
}

// "## Title": white text on a full-width black bar.
function banner(text, size, cols, ctx) {
  return wrapAtoms(styledAtoms(text, ctx, { bold: true }), Math.max(1, cols - 2))
    .map((l) => line(size, centred(l, cols), { invert: true, tight: true }));
}

// "### Title": a divider with the title in the middle. A title too long for
// one line goes between two full dividers instead.
function lineTitle(text, size, cols, ctx) {
  const atoms = styledAtoms(text, ctx, { bold: true });
  const oneLine = wrapAtoms(atoms, Math.max(1, cols - 4));
  if (oneLine.length > 1) {
    return [
      ruleLine(size, cols, "─"),
      ...wrapAtoms(atoms, cols).map((l) => line(size, centred(trimEnd(l), cols))),
      ruleLine(size, cols, "─"),
    ];
  }
  const title = trimEnd(oneLine[0]);
  const fill = Math.max(0, cols - widthOf(title) - 2);
  const left = Math.floor(fill / 2);
  return [line(size, [
    ...charAtoms("─".repeat(left) + " ", {}),
    ...title,
    ...charAtoms(" " + "─".repeat(fill - left), {}),
  ])];
}

// "#### Title": bold, underlined and centred, with no decoration.
function underlinedTitle(text, size, cols, ctx) {
  return wrapAtoms(styledAtoms(text, ctx, { bold: true, underline: true }), cols)
    .map((l) => line(size, centred(trimEnd(l), cols)));
}

// ── Alignment ─────────────────────────────────────────────────────────────────
// The sender's alignment applies to ordinary text only: header boxes, banners
// and dividers always span the full width. Lines are padded with spaces rather
// than using the printer's alignment command, so driver mode matches.
function trimEnd(atoms) {
  let end = atoms.length;
  while (end > 0 && isSpace(atoms[end - 1])) end--;
  return atoms.slice(0, end);
}

function indent(atoms, n) {
  return n > 0 ? [...charAtoms(" ".repeat(n), {}), ...atoms] : atoms;
}

function alignOffset(width, cols, align) {
  const pad = Math.max(0, cols - width);
  return align === "center" ? Math.floor(pad / 2) : align === "right" ? pad : 0;
}

function bodyLines(body, size, widthDots, wrap, align, ctx) {
  const cols = colsFor(widthDots, size);
  const sources = body.split(/\r?\n/);

  if (!wrap) {
    // As typed (ASCII art): no markup, no wrapping. Alignment moves the whole
    // block by the same amount so the picture stays intact.
    const rows = sources.map((src) => trimEnd(toAtoms(src, {}, ctx)));
    const offset = alignOffset(Math.max(0, ...rows.map(widthOf)), cols, align);
    return rows.map((atoms) => line(size, atoms.length ? indent(atoms, offset) : atoms));
  }

  const out = [];
  for (const src of sources) {
    let m;
    if ((m = src.match(/^#\s+(.+)$/))) {
      const big = sizeUp(size);
      out.push(...headerBox(m[1].trim(), big, colsFor(widthDots, big), ctx));
    }
    else if ((m = src.match(/^##\s+(.+)$/)))   out.push(...banner(m[1].trim(), size, cols, ctx));
    else if ((m = src.match(/^###\s+(.+)$/)))  out.push(...lineTitle(m[1].trim(), size, cols, ctx));
    else if ((m = src.match(/^####\s+(.+)$/))) out.push(...underlinedTitle(m[1].trim(), size, cols, ctx));
    else if (/^\s*-{3,}\s*$/.test(src)) out.push(ruleLine(size, cols, "─"));
    else {
      // Indentation only means something for left-aligned text.
      const atoms = styledAtoms(align === "left" ? src : src.trim(), ctx);
      out.push(...wrapAtoms(atoms, cols).map((l) => {
        const text = trimEnd(l);
        return line(size, align === "left" ? l : indent(text, alignOffset(widthOf(text), cols, align)));
      }));
    }
  }
  return out;
}

// From / Email / Time between double rules, always at Normal size.
function headerLines(message, widthDots, ctx) {
  const cols = colsFor(widthDots, NORMAL);
  const field = (label, value) => wrapAtoms([
    ...charAtoms(label, { bold: true }),
    ...toAtoms(" " + value, {}, ctx),
  ], cols).map((l) => line(NORMAL, l));

  const out = [ruleLine(NORMAL, cols, "═")];
  if (message.sender_name)  out.push(...field("From:", message.sender_name));
  if (message.sender_email) out.push(...field("Email:", message.sender_email));
  out.push(...field("Time:", new Date(message.created_at + "Z").toLocaleString()));
  out.push(ruleLine(NORMAL, cols, "═"));
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * @param message   message row from the server
 * @param opts.widthDots   printer width in dots
 * @param opts.emojiMode   "glyph" | "text"
 * @param opts.wrap        word-wrap and apply markup to the body
 * (message.align — "center" | "right", otherwise left — positions body text)
 * @param opts.imageBuffer the message's image, if any
 */
function buildReceipt(message, { widthDots = DEFAULT_WIDTH_DOTS, emojiMode = "glyph", wrap = true, imageBuffer = null } = {}) {
  const ctx   = newContext(emojiMode);
  const hasBody = Boolean(message.body && message.body.trim());
  const size  = hasBody && isBigEmoji(message.body) ? X_LARGE : sizeForPt(message.font_size);
  const align = message.align === "center" || message.align === "right" ? message.align : "left";

  const model = headerLines(message, widthDots, ctx);
  if (hasBody) model.push(...bodyLines(message.body, size, widthDots, wrap, align, ctx));
  if (imageBuffer) {
    if (hasBody) model.push({ type: "gap", dots: IMAGE_GAP_DOTS });
    model.push({ type: "image", buffer: imageBuffer });
  }
  // The header already ends with a rule, so a header-only receipt (the first
  // half of an image-only message printed separately) doesn't get a second one.
  if (hasBody || imageBuffer) model.push(ruleLine(NORMAL, colsFor(widthDots, NORMAL), "═"));
  return model;
}

/**
 * The print jobs for a message, each printed and cut on its own. Normally one
 * receipt; with imageCut "separate" a message's image follows on a receipt of
 * its own, with nothing else on it.
 *
 * Takes buildReceipt's options plus:
 * @param opts.imageCut    "same" | "separate"
 * @returns [model, ...]
 */
function buildJobs(message, opts = {}) {
  const { imageBuffer = null, imageCut = "same" } = opts;
  if (!imageBuffer || imageCut !== "separate") return [buildReceipt(message, opts)];
  return [
    buildReceipt(message, { ...opts, imageBuffer: null }),
    [{ type: "image", buffer: imageBuffer }],
  ];
}

// Tick marks every 8 dots, taller every 64, and solid bars at both edges, so
// the owner can see whether the configured width reaches the paper edge.
function edgeRuler(widthDots) {
  const byteW = widthDots / 8;
  const height = 40;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(byteW, 0);
    const set = (x) => { row[x >> 3] |= 0x80 >> (x & 7); };
    for (let x = 0; x < widthDots; x++) {
      const edge  = x < 4 || x >= widthDots - 4;
      const major = x % 64 === 0 && y >= height - 24;
      const minor = x % 8 === 0 && y >= height - 12;
      const base  = y >= height - 3;
      if (edge || major || minor || base) set(x);
    }
    rows.push(row);
  }
  return { type: "raster", widthDots, rows };
}

function columnRuler(length) {
  const chars = Array(length).fill(".");
  for (let n = 5; n <= length; n += 5) {
    const label = String(n);
    label.split("").forEach((c, i) => { chars[n - label.length + i] = c; });
  }
  return chars.join("");
}

/**
 * Calibration page: rulers to check the paper width, one sample per size, the
 * formatting options, and an emoji row that always tries custom characters so
 * the owner can tell whether this printer supports them.
 */
function buildTestPage({ widthDots = DEFAULT_WIDTH_DOTS } = {}) {
  const ctx    = newContext("glyph");
  const cols   = colsFor(widthDots, NORMAL);
  const text   = (s, size = NORMAL) => wrapAtoms(styledAtoms(s, ctx), colsFor(widthDots, size)).map((l) => line(size, l));
  const blank  = () => line(NORMAL, []);
  const emoji  = "😀 ❤️ 👍 🎉 🐱 ☕";

  return [
    ...banner("PRINTER TEST PAGE", NORMAL, cols, ctx),
    ...text(`Set to: ${cols} characters per line (${widthDots} dots)`),
    blank(),
    ...text("**1. Characters per line**"),
    ...text("The last number on the first ruler line is how many Normal-size characters fit."),
    line(NORMAL, charAtoms(columnRuler(80), {})),
    ...text(`Expected: ${cols}. If it's different, set Characters per line on My Printer to that number.`),
    blank(),
    ...text("**2. Edge check**"),
    ...text("Both thick edge bars should print. If the right one is missing, Characters per line is set too high."),
    edgeRuler(widthDots),
    blank(),
    ...text("**3. Sizes** - each bar should fit on one line:"),
    ...SIZES.map((s) => {
      const c = colsFor(widthDots, s);
      // "Small 42 ------|", or just "10 ------|" when the name doesn't fit.
      const label = c > `${s.name} ${c}`.length + 1 ? `${s.name} ${c}` : String(c);
      const bar = c > label.length + 1 ? `${label} ${"-".repeat(c - label.length - 2)}|` : "|".repeat(c);
      return line(s, charAtoms(bar, {}));
    }),
    blank(),
    ...text("**4. Formatting**"),
    ...text("**bold** __underline__ plain"),
    // The marker is part of each title so the page shows what to type.
    ...bodyLines("# # Box\n## ## Banner\n### ### Title\n#### #### Subtitle", NORMAL, widthDots, true, "left", ctx),
    ...text("Accents: é ñ ü ß £ ½ °"),
    blank(),
    ...text("**5. Emoji**"),
    ...text("If these print as pictures, set Emoji to Pictures on My Printer. If you see letters or symbols, set it to Text."),
    line(NORMAL, toAtoms(emoji, {}, ctx)),
    line(SIZES[2], toAtoms(emoji, {}, ctx)),
    ...text("Text version:"),
    line(NORMAL, toAtoms(emoji, {}, newContext("text"))),
    ruleLine(NORMAL, cols, "═"),
  ];
}

module.exports = {
  SIZES, DEFAULT_PT, DEFAULT_WIDTH_DOTS, MAX_EMOJI,
  sizeForPt, colsFor, dotsForCols, emojiGlyph, CP437_BYTE,
  buildReceipt, buildJobs, buildTestPage,
  // exported for tests
  wrapAtoms, toAtoms, parseInline, newContext, isBigEmoji,
};
