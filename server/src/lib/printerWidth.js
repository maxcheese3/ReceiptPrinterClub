/**
 * Printer width — the one physical fact the server stores about a printer.
 *
 * Measured in printhead dots. Owners pick it as Normal-size characters per
 * line (what the test page shows): 32 = 384 dots (most 58mm), 42 = 512 (80mm
 * with a narrow print area), 48 = 576 (most 80mm). Everything else (characters
 * per line at each size, image width) is derived from it by the client and the
 * web UI (frontend/src/lib/printerGeometry.ts).
 */

"use strict";

const DEFAULT_WIDTH_DOTS = 384;
const MIN_WIDTH_DOTS     = 128;
const MAX_WIDTH_DOTS     = 1024;

// Clamp to a sane range and round down to a whole byte (raster rows are sent
// 8 dots per byte). Returns null for anything that isn't a number.
function normalizeWidthDots(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.max(MIN_WIDTH_DOTS, Math.min(MAX_WIDTH_DOTS, n));
  return Math.floor(clamped / 8) * 8;
}

const EMOJI_MODES = ["glyph", "text"];

function normalizeEmojiMode(value) {
  return EMOJI_MODES.includes(value) ? value : null;
}

module.exports = {
  DEFAULT_WIDTH_DOTS,
  normalizeWidthDots,
  normalizeEmojiMode,
};
