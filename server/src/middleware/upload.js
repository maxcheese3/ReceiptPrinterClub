const multer = require("multer");
const path   = require("path");
const fs     = require("fs");
const sharp  = require("sharp");

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "../../../data/uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Receipt printers are ~58 mm wide at 203 DPI ≈ 464 px.
// Storing anything wider than MAX_IMAGE_WIDTH is pure waste and causes
// out-of-memory errors in the Jimp-based client when it decodes a large bitmap.
const MAX_IMAGE_WIDTH = parseInt(process.env.MAX_IMAGE_WIDTH || "800", 10);

// Formats that Jimp 0.22.x can decode on the client.
// Everything else must be converted to JPEG before storage.
const JIMP_SUPPORTED_FORMATS = new Set(["jpeg", "png", "bmp", "tiff", "gif"]);

/**
 * Ensures the image at filePath is:
 *   1. No wider than MAX_IMAGE_WIDTH (receipt printers are ~464px wide)
 *   2. In a format the Jimp-based client can decode (JPEG/PNG/BMP/TIFF/GIF)
 *
 * Uses sharp, which streams large images without loading the full bitmap into
 * RAM — so a 5000×7000 WebP or JPEG is handled without hitting any memory
 * ceiling.  Overwrites the file in-place via an atomic tmp-rename.
 */
async function resizeIfNeeded(filePath) {
  try {
    const meta         = await sharp(filePath).metadata();
    const format       = meta.format || "";          // e.g. "webp", "jpeg", "png"
    const needsResize  = (meta.width || 0) > MAX_IMAGE_WIDTH;
    const needsConvert = !JIMP_SUPPORTED_FORMATS.has(format);

    if (!needsResize && !needsConvert) return; // already fine

    let pipeline = sharp(filePath);
    if (needsResize)  pipeline = pipeline.resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true });
    if (needsConvert) pipeline = pipeline.jpeg({ quality: 90 });

    const tmpPath = filePath + ".processing";
    await pipeline.toFile(tmpPath);
    fs.renameSync(tmpPath, filePath);

    const ops = [
      needsResize  && `resized to ${MAX_IMAGE_WIDTH}px`,
      needsConvert && `converted ${format} → jpeg`,
    ].filter(Boolean);
    console.log(`[upload] ${ops.join(", ")}: ${path.basename(filePath)}`);
  } catch (err) {
    console.warn(`[upload] Could not process ${path.basename(filePath)}: ${err.message}`);
  }
}

// Use memory storage so we can inspect / resize before writing to disk.
const storage = multer.memoryStorage();

const fileFilter = (_req, file, cb) => {
  // Accept everything sharp can read — unsupported formats are converted to
  // JPEG by resizeIfNeeded() before the client ever downloads them.
  const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif", ".avif", ".heic", ".heif"];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${ext}`));
  }
};

const _multer = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB — server resizes before storing
});

/**
 * Drop-in replacement for upload.single("image").
 * Runs multer into memory, resizes if needed, then writes to UPLOAD_DIR.
 */
function single(fieldName) {
  return async (req, res, next) => {
    _multer.single(fieldName)(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) return next();

      const ext      = path.extname(req.file.originalname).toLowerCase();
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      const destPath = path.join(UPLOAD_DIR, filename);

      try {
        // Write the raw buffer, then resize in-place if too wide.
        fs.writeFileSync(destPath, req.file.buffer);
        await resizeIfNeeded(destPath);
        // Mimic multer diskStorage's req.file.filename so the rest of the
        // route code works without changes.
        req.file.filename = filename;
        req.file.path     = destPath;
        next();
      } catch (writeErr) {
        next(writeErr);
      }
    });
  };
}

module.exports = { single, resizeIfNeeded };

