const express        = require("express");
const { v4: uuidv4 } = require("uuid");
const path           = require("path");
const fs             = require("fs");
const https          = require("https");
const http           = require("http");
const db             = require("../db");
const upload         = require("../middleware/upload");
const { messageLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "../../../data/uploads");
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

// ── Image URL fetcher ─────────────────────────────────────────────────────────
// Downloads an image from a URL, saves it to the upload directory,
// and returns the saved filename. Follows one redirect.
function fetchImageFromUrl(imageUrl) {
  return new Promise((resolve, reject) => {
    // Basic URL validation
    let parsed;
    try {
      parsed = new URL(imageUrl);
    } catch {
      return reject(new Error("Invalid image_url: not a valid URL"));
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return reject(new Error("image_url must be http or https"));
    }

    // Derive file extension from URL path, defaulting to .jpg
    const urlPath = parsed.pathname;
    let ext = path.extname(urlPath).toLowerCase().split("?")[0];
    if (!ALLOWED_EXTENSIONS.has(ext)) ext = ".jpg";

    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const destPath = path.join(UPLOAD_DIR, filename);
    const file     = fs.createWriteStream(destPath);

    const lib = parsed.protocol === "https:" ? https : http;
    let totalBytes = 0;

    const doRequest = (url, redirectCount = 0) => {
      if (redirectCount > 3) return reject(new Error("Too many redirects fetching image_url"));

      const reqUrl = new URL(url);
      const reqLib = reqUrl.protocol === "https:" ? https : http;

      reqLib.get(url, { timeout: 15000 }, (res) => {
        // Follow redirects
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          return doRequest(res.headers.location, redirectCount + 1);
        }

        if (res.statusCode !== 200) {
          file.destroy();
          fs.unlink(destPath, () => {});
          return reject(new Error(`image_url returned HTTP ${res.statusCode}`));
        }

        // Detect extension from Content-Type if URL gave no clue
        const ct = res.headers["content-type"] || "";
        if (ext === ".jpg") {
          if      (ct.includes("png"))  { /* keep .jpg as fallback */ }
          else if (ct.includes("gif"))  ext === ".gif";
          else if (ct.includes("webp")) ext === ".webp";
        }

        res.on("data", (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_IMAGE_BYTES) {
            res.destroy();
            file.destroy();
            fs.unlink(destPath, () => {});
            return reject(new Error("image_url file exceeds 10 MB limit"));
          }
        });

        res.pipe(file);

        file.on("finish", () => {
          file.close();
          resolve(filename);
        });

        file.on("error", (err) => {
          fs.unlink(destPath, () => {});
          reject(new Error("Failed to save image: " + err.message));
        });

        res.on("error", (err) => {
          fs.unlink(destPath, () => {});
          reject(new Error("Failed to download image: " + err.message));
        });
      }).on("error", (err) => {
        fs.unlink(destPath, () => {});
        reject(new Error("Failed to fetch image_url: " + err.message));
      });
    };

    doRequest(imageUrl);
  });
}

// ── POST /api/messages ────────────────────────────────────────────────────────
// Accepts:
//   - multipart/form-data  with an `image` file field  (web form / curl)
//   - application/json     with an `image_url` field   (simple JSON API)
//   - application/json     with just `body`            (text only)
router.post(
  "/",
  messageLimiter,
  upload.single("image"),
  async (req, res) => {
    try {
      const { printer_id, sender_name, sender_email, body, image_url } = req.body;

      if (!printer_id) {
        return res.status(400).json({ error: "printer_id is required" });
      }

      const printer = db.getPrinterById(printer_id);
      if (!printer || !printer.active) {
        return res.status(404).json({ error: "Printer not found or inactive" });
      }

      // Determine source
      const authHeader = req.headers["x-api-key"];
      let source = "web";
      if (authHeader) {
        const keyPrinter = db.getPrinterByApiKey(authHeader);
        if (keyPrinter) source = "api";
      }

      // Resolve image — uploaded file takes priority, then image_url
      let image_path = null;

      if (req.file) {
        image_path = req.file.filename;
      } else if (image_url && image_url.trim()) {
        try {
          image_path = await fetchImageFromUrl(image_url.trim());
        } catch (err) {
          return res.status(400).json({ error: err.message });
        }
      }

      if (!body && !image_path) {
        return res.status(400).json({ error: "A message body, image file, or image_url is required" });
      }

      const message = db.createMessage({
        id:           uuidv4(),
        printer_id,
        source,
        sender_name:  sender_name  || null,
        sender_email: sender_email || null,
        body:         body         || null,
        image_path,
      });

      return res.status(201).json({
        success:    true,
        message_id: message.id,
        status:     message.status,
      });
    } catch (err) {
      console.error("POST /api/messages error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ── GET /api/messages/poll ────────────────────────────────────────────────────
router.get("/poll", (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) return res.status(401).json({ error: "X-API-Key header required" });

  const printer = db.getPrinterByApiKey(apiKey);
  if (!printer) return res.status(403).json({ error: "Invalid API key" });

  db.updatePrinterLastSeen(printer.id);

  const messages = db.getPendingMessages(printer.id);
  for (const m of messages) db.setMessageStatus(m.id, "printing");

  return res.json({ printer_id: printer.id, messages });
});

// ── PATCH /api/messages/:id ───────────────────────────────────────────────────
router.patch("/:id", (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) return res.status(401).json({ error: "X-API-Key header required" });

  const printer = db.getPrinterByApiKey(apiKey);
  if (!printer) return res.status(403).json({ error: "Invalid API key" });

  const msg = db.getMessageById(req.params.id);
  if (!msg) return res.status(404).json({ error: "Message not found" });
  if (msg.printer_id !== printer.id) return res.status(403).json({ error: "Forbidden" });

  const { status, error } = req.body;
  if (!["printed", "failed"].includes(status)) {
    return res.status(400).json({ error: "status must be 'printed' or 'failed'" });
  }

  db.setMessageStatus(msg.id, status, error || null);
  return res.json({ success: true });
});

// ── GET /api/messages/:printer_id/recent ─────────────────────────────────────
router.get("/:printer_id/recent", (req, res) => {
  const printer = db.getPrinterById(req.params.printer_id);
  if (!printer || !printer.active) return res.status(404).json({ error: "Printer not found" });
  const messages = db.getRecentMessages(printer.id, 50);
  return res.json({ messages });
});

module.exports = router;
