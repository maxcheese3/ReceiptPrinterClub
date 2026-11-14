// Printer sizes and widths — how many characters fit on a line.
//
// Mirrors SIZES in client/layout.js, which is what actually prints. Keep the
// two in sync: if they drift, the column counter on the send page stops
// matching where the printer wraps.

export interface SizeStep {
  name: string;
  /** The value stored as a message's font_size. */
  pt: number;
  /** Character width in printer dots. */
  cellW: number;
}

export const SIZE_STEPS: SizeStep[] = [
  { name: 'Small', pt: 7, cellW: 9 },
  { name: 'Normal', pt: 9, cellW: 12 },
  { name: 'Medium', pt: 12, cellW: 18 },
  { name: 'Large', pt: 17, cellW: 24 },
  { name: 'X-Large', pt: 25, cellW: 36 },
];

/** Character heights in dots, used to snap any point size to the nearest step. */
const CELL_H: Record<number, number> = { 7: 17, 9: 24, 12: 34, 17: 48, 25: 72 };

export const DEFAULT_PT = 9;
export const DEFAULT_WIDTH_DOTS = 384;

// Printer width is chosen as "characters per line at Normal size", because
// that's what the test page's ruler shows — paper size doesn't tell you (80mm
// printers print either 42 or 48). The common widths map to the printheads'
// real dot widths so images fill the paper; anything else is cols × 12.
// Keep in sync with server/src/lib/printerWidth.js.
export const WIDTH_PRESETS = [
  { cols: 32, dots: 384, hint: 'most 58mm printers' },
  { cols: 42, dots: 512, hint: '80mm printers with a narrow print area' },
  { cols: 48, dots: 576, hint: 'most 80mm printers' },
];

const NORMAL_CELL_W = 12;

/** Printer width in dots for a number of Normal-size characters per line. */
export function dotsForCols(cols: number): number {
  const preset = WIDTH_PRESETS.find((p) => p.cols === cols);
  // Rounded up to a whole byte (the server stores multiples of 8), which still
  // reads back as the same number of characters.
  return preset ? preset.dots : Math.ceil(cols * NORMAL_CELL_W / 8) * 8;
}

/** Normal-size characters per line on a printer this many dots wide. */
export function normalCols(widthDots: number): number {
  return Math.floor((widthDots || DEFAULT_WIDTH_DOTS) / NORMAL_CELL_W);
}

/** Snaps a point size (including old values like 8, 10, 14) to a size step. */
export function stepForPt(pt: number): SizeStep {
  const target = (pt || DEFAULT_PT) * 203 / 72;
  return SIZE_STEPS.reduce((best, s) =>
    Math.abs(CELL_H[s.pt] - target) < Math.abs(CELL_H[best.pt] - target) ? s : best);
}

/** Characters per line at a size on a printer this many dots wide. */
export function colsFor(widthDots: number, pt: number): number {
  return Math.max(1, Math.floor((widthDots || DEFAULT_WIDTH_DOTS) / stepForPt(pt).cellW));
}

// Same emoji matching as client/layout.js: flags print as [US], keycaps as
// [1], and any other emoji (with skin tone or joined parts) as one 2-column
// picture.
const PICTO = '\\p{Extended_Pictographic}[\\uFE0E\\uFE0F]?\\p{Emoji_Modifier}?';
const EMOJI_RE = new RegExp(
  `(\\p{Regional_Indicator}{2})|([0-9#*]\\uFE0F?\\u20E3)|(${PICTO}(?:\\u200D${PICTO})*)`,
  'gu',
);

// Characters the printer can't show that print as more than one character.
const WIDE_REPLACEMENTS: Record<string, string> = {
  '©': '(c)', '®': '(R)', '™': 'TM', '…': '...',
  '€': 'EUR', '→': '->', '←': '<-', '\t': '    ',
};
const WIDE_RE = new RegExp(`[${Object.keys(WIDE_REPLACEMENTS).join('')}]\\uFE0F?`, 'g');

/** Printed width of text in columns: emoji take two. */
export function displayWidth(text: string): number {
  const printed = text
    .replace(WIDE_RE, (m) => WIDE_REPLACEMENTS[m[0]])
    .replace(EMOJI_RE, (_m, flag, keycap) => (flag ? '[XX]' : keycap ? '[0]' : 'XX'));
  return [...printed].length;
}
