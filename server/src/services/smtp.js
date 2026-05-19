/**
 * Embedded SMTP server for inbound email-to-print.
 *
 * Email format:
 *   To:      <printer-id>@print.local   (or any subdomain)
 *   Subject: (used as sender_name fallback)
 *   Body:    plain text or HTML (stripped to text)
 *   Attach:  image files are saved as the message image
 *
 * The printer is matched by the local part of the To address.
 * If the printer_id isn't found we try matching by name (slug).
 */

const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const { v4: uuidv4 }   = require("uuid");
const path = require("path");
const fs   = require("fs");
const db   = require("../db");
const upload = require("../middleware/upload");

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "../../data/uploads");
const SMTP_PORT  = parseInt(process.env.SMTP_PORT || "2525", 10);

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function resolvePrinter(toAddress) {
  // toAddress like: "abc-123@print.local" or "My Printer<abc@x.com>"
  const match = toAddress.match(/([^<@\s]+)@/);
  if (!match) return null;
  const localPart = match[1];

  // Try exact id
  let printer = db.getPrinterById(localPart);
  if (printer && printer.active) return printer;

  // Try slug match on name
  const all = db.listPrinters(true);
  printer = all.find((p) => slugify(p.name) === localPart || slugify(p.name) === slugify(localPart));
  return printer || null;
}

function startSmtpServer() {
  const server = new SMTPServer({
    // Accept without auth — this is an internal ingestion server
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    banner: "PrintBridge SMTP Receiver",
    size: 15 * 1024 * 1024, // 15 MB max message

    onData(stream, session, callback) {
      const chunks = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", async () => {
        const raw = Buffer.concat(chunks);
        try {
          const parsed = await simpleParser(raw);

          // Resolve printer from the first To address
          const toList = [].concat(parsed.to?.value || []);
          let printer = null;
          for (const addr of toList) {
            printer = resolvePrinter(addr.address || "");
            if (printer) break;
          }

          if (!printer) {
            console.warn("[SMTP] No printer matched for:", toList.map((a) => a.address));
            return callback(new Error("No such printer"));
          }

          // Extract body text
          let body = parsed.text?.trim() || "";
          if (!body && parsed.html) body = stripHtml(parsed.html);

          // Extract sender
          const fromAddr = parsed.from?.value?.[0];
          const senderName  = fromAddr?.name  || null;
          const senderEmail = fromAddr?.address || null;

          // Save first image attachment
          let imagePath = null;
          if (parsed.attachments?.length) {
            for (const att of parsed.attachments) {
              const ext = path.extname(att.filename || "").toLowerCase();
              if (IMAGE_EXTENSIONS.has(ext)) {
                const fname = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
                const fpath = path.join(UPLOAD_DIR, fname);
                fs.writeFileSync(fpath, att.content);
                await upload.resizeIfNeeded(fpath);
                imagePath = fname;
                break;
              }
            }
          }

          if (!body && !imagePath) {
            return callback(new Error("Empty message"));
          }

          const msg = db.createMessage({
            id:           uuidv4(),
            printer_id:   printer.id,
            source:       "email",
            sender_name:  senderName,
            sender_email: senderEmail,
            body:         body || null,
            image_path:   imagePath,
          });

          console.log(`[SMTP] Message ${msg.id} queued for printer "${printer.name}"`);
          callback();
        } catch (err) {
          console.error("[SMTP] Parse error:", err);
          callback(err);
        }
      });
    },
  });

  server.on("error", (err) => console.error("[SMTP] Server error:", err));

  server.listen(SMTP_PORT, () => {
    console.log(`[SMTP] Listening on port ${SMTP_PORT}`);
  });

  return server;
}

module.exports = { startSmtpServer };
