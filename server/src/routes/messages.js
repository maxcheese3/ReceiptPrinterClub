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

const UPLOAD_DIR         = process.env.UPLOAD_DIR || path.join(__dirname, "../../../data/uploads");
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);
const MAX_IMAGE_BYTES    = 50 * 1024 * 1024; // 50 MB — server resizes before storing

// ── OAuth2 client credentials token fetcher ───────────────────────────────────
// Genesys token endpoint: https://login.mypurecloud.com/oauth/token
// (region-specific: login.euw2.pure.cloud, login.aps1.pure.cloud, etc.)
// Returns a Bearer token string.
function fetchOAuthToken(tokenUrl, clientId, clientSecret) {
  return new Promise((resolve, reject) => {
    const body      = "grant_type=client_credentials";
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const parsed    = new URL(tokenUrl);
    const lib       = parsed.protocol === "https:" ? https : http;

    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path:     parsed.pathname,
      method:   "POST",
      timeout:  10000,
      headers: {
        "Authorization":  `Basic ${basicAuth}`,
        "Content-Type":   "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = lib.request(options, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`OAuth token request failed with HTTP ${res.statusCode}: ${data}`));
        }
        try {
          const json = JSON.parse(data);
          if (!json.access_token) return reject(new Error("OAuth response had no access_token"));
          console.log(`[oauth] Token obtained successfully (expires in ${json.expires_in}s)`);
          resolve(json.access_token);
        } catch {
          reject(new Error("OAuth response was not valid JSON"));
        }
      });
    });

    req.on("timeout", () => { req.destroy(); reject(new Error("OAuth token request timed out")); });
    req.on("error",   (err) => reject(new Error("OAuth request error: " + err.message)));
    req.write(body);
    req.end();
  });
}

// ── Image URL fetcher ─────────────────────────────────────────────────────────
function fetchImageFromUrl(imageUrl, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(imageUrl); }
    catch { return reject(new Error("Invalid image_url: not a valid URL")); }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return reject(new Error("image_url must be http or https"));
    }

    const urlExt = path.extname(parsed.pathname).toLowerCase().split("?")[0];
    let ext = ALLOWED_EXTENSIONS.has(urlExt) ? urlExt : ".jpg";

    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const destPath = path.join(UPLOAD_DIR, filename);

    console.log(`[image_url] Fetching: ${imageUrl}`);

    let totalBytes = 0;
    let settled    = false;

    function doRequest(url, redirectCount, headersForThisRequest) {
      if (redirectCount > 5) return reject(new Error("Too many redirects"));

      const reqParsed = new URL(url);
      const lib       = reqParsed.protocol === "https:" ? https : http;

      const req = lib.get(url, {
        timeout: 20000,
        headers: {
          "User-Agent": "PrintBridge/1.0",
          "Accept":     "image/*,*/*",
          ...headersForThisRequest,
        },
      }, (res) => {
        console.log(`[image_url] HTTP ${res.statusCode} content-type: ${res.headers["content-type"]} location: ${res.headers["location"] || "-"}`);

        // Follow redirects — strip auth on cross-origin redirects (e.g. S3)
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          const redirectUrl  = new URL(res.headers.location, url).href;
          const sameHost     = new URL(redirectUrl).hostname === new URL(url).hostname;
          return doRequest(redirectUrl, redirectCount + 1, sameHost ? headersForThisRequest : {});
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`image_url returned HTTP ${res.statusCode}`));
        }

        // Sniff type from Content-Type
        const ct = (res.headers["content-type"] || "").toLowerCase();
        if (ext === ".jpg") {
          if      (ct.includes("png"))  ext = ".png";
          else if (ct.includes("gif"))  ext = ".gif";
          else if (ct.includes("webp")) ext = ".webp";
          else if (ct.includes("bmp"))  ext = ".bmp";
        }

        // Sniff from Content-Disposition filename
        const cd = res.headers["content-disposition"] || "";
        const cdMatch = cd.match(/filename\*?=["']?(?:UTF-8'')?([^;"'\s]+)/i);
        if (cdMatch) {
          const cdExt = path.extname(cdMatch[1]).toLowerCase();
          if (ALLOWED_EXTENSIONS.has(cdExt)) ext = cdExt;
        }

        const file = fs.createWriteStream(destPath);

        res.on("data", (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_IMAGE_BYTES) {
            settled = true;
            res.destroy(); file.destroy();
            fs.unlink(destPath, () => {});
            reject(new Error("image_url exceeds 10 MB limit"));
          }
        });

        res.pipe(file);

        file.on("finish", () => {
          if (settled) return;
          settled = true;
          file.close(async () => {
            console.log(`[image_url] Saved ${totalBytes} bytes as ${filename}`);
            // Resize to printer-friendly width before the client downloads it.
            await upload.resizeIfNeeded(destPath);
            resolve(filename);
          });
        });

        file.on("error", (err) => {
          if (settled) return; settled = true;
          fs.unlink(destPath, () => {});
          reject(new Error("File write error: " + err.message));
        });

        res.on("error", (err) => {
          if (settled) return; settled = true;
          fs.unlink(destPath, () => {});
          reject(new Error("Download error: " + err.message));
        });
      });

      req.on("timeout", () => { req.destroy(); reject(new Error("Timed out fetching image_url")); });
      req.on("error",   (err) => { if (!settled) { settled = true; reject(new Error("Request error: " + err.message)); } });
    }

    doRequest(imageUrl, 0, extraHeaders);
  });
}

// ── POST /api/messages ────────────────────────────────────────────────────────
//
// JSON body fields:
//   printer_id      — required
//   body            — optional text message
//   sender_name     — optional
//   sender_email    — optional
//   image_url       — optional; server fetches the image from this URL
//   image_headers   — optional JSON object of extra headers for the image_url request
//                     e.g. {"Authorization":"Bearer token"}
//   oauth_token_url — optional; OAuth2 token endpoint to obtain a Bearer token
//                     e.g. "https://login.mypurecloud.com/oauth/token"
//   oauth_client_id — required if oauth_token_url is set
//   oauth_client_secret — required if oauth_token_url is set
//
// The OAuth flow: server calls oauth_token_url with client_id + client_secret
// using HTTP Basic auth + grant_type=client_credentials, gets back a Bearer
// token, then uses it to fetch image_url. The token is not cached or stored.
//
router.post(
  "/",
  messageLimiter,
  upload.single("image"),
  async (req, res) => {
    try {
      const {
        printer_id, sender_email, body, word_wrap, font_size,
        image_url, image_headers,
        oauth_token_url, oauth_client_id, oauth_client_secret,
      } = req.body;
      let sender_name = req.body.sender_name;

      console.log(`[messages] POST printer_id=${printer_id} image_url=${image_url || "(none)"} oauth=${oauth_token_url ? "yes" : "no"}`);

      if (!printer_id) {
        return res.status(400).json({ error: "printer_id is required" });
      }

      const printer = db.getPrinterById(printer_id);
      if (!printer || !printer.active) {
        return res.status(404).json({ error: "Printer not found or inactive" });
      }

      const authHeader = req.headers["x-api-key"];
      let source = "web";
      if (authHeader) {
        const keyPrinter = db.getPrinterByApiKey(authHeader);
        if (keyPrinter) source = "api";
      }

      // For web submissions with no sender name, fall back to client IP
      if (source === "web" && !sender_name) {
        const forwarded = req.headers["x-forwarded-for"];
        sender_name = forwarded
          ? forwarded.split(",")[0].trim()
          : (req.ip || req.socket.remoteAddress || "Unknown");
      }

      // Build headers for the image fetch
      let extraHeaders = {};

      // Option A: explicit headers provided
      if (image_headers) {
        try {
          extraHeaders = typeof image_headers === "object"
            ? image_headers
            : JSON.parse(image_headers);
        } catch {
          return res.status(400).json({ error: "image_headers must be valid JSON" });
        }
      }

      // Option B: OAuth2 client credentials — fetch a token first
      if (oauth_token_url) {
        if (!oauth_client_id || !oauth_client_secret) {
          return res.status(400).json({
            error: "oauth_client_id and oauth_client_secret are required when oauth_token_url is set",
          });
        }
        try {
          const token = await fetchOAuthToken(oauth_token_url, oauth_client_id, oauth_client_secret);
          extraHeaders["Authorization"] = `Bearer ${token}`;
        } catch (err) {
          console.error(`[messages] OAuth failed: ${err.message}`);
          return res.status(400).json({ error: "OAuth token fetch failed: " + err.message });
        }
      }

      // Resolve image
      let image_path = null;
      if (req.file) {
        image_path = req.file.filename;
      } else if (image_url && image_url.trim()) {
        try {
          image_path = await fetchImageFromUrl(image_url.trim(), extraHeaders);
        } catch (err) {
          console.error(`[messages] image fetch failed: ${err.message}`);
          return res.status(400).json({ error: err.message });
        }
      }

      if (!body && !image_path) {
        return res.status(400).json({ error: "A message body, image file, or image_url is required" });
      }

      const message = db.createMessage({
        id:           uuidv4(),
        word_wrap:    word_wrap === "0" || word_wrap === 0 ? 0 : 1,
        font_size:    font_size ? parseInt(font_size, 10) : null,
        printer_id,
        source,
        sender_name:  sender_name  || null,
        sender_email: sender_email || null,
        body:         body         || null,
        image_path,
      });

      console.log(`[messages] Created ${message.id} image_path=${message.image_path || "none"}`);

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
