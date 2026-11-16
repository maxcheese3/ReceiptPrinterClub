/**
 * feedPoller.js
 * Polls RSS/Atom feeds and queues new items as print messages.
 *
 * Supports:
 *   - Generic RSS 2.0 / Atom feeds (prints title + description text)
 *   - Image extraction from feed enclosures and media:content
 *   - Special handler for XKCD (fetches comic image via JSON API)
 *
 * Runs on a configurable interval (default: 15 minutes).
 */

"use strict";

const https   = require("https");
const http    = require("http");
const fs      = require("fs");
const path    = require("path");
const { v4: uuidv4 } = require("uuid");
const db      = require("../db");
const { resizeIfNeeded } = require("../middleware/upload");
const { assertSafeUrl, safeLookup } = require("../lib/urlSafety");

const POLL_INTERVAL_MS = parseInt(process.env.FEED_POLL_INTERVAL_MS || "900000", 10); // 15 min
const UPLOAD_DIR       = process.env.UPLOAD_DIR || path.join(__dirname, "../../data/uploads");

const FEED_MAX_BYTES  = 5 * 1024 * 1024;  // 5 MB feed document
const IMAGE_MAX_BYTES = 25 * 1024 * 1024; // 25 MB feed image
const MAX_REDIRECTS   = 5;
const MAX_ITEMS_PER_POLL = 50;

// ── HTTP fetch helper ─────────────────────────────────────────────────────────
async function fetchUrl(url, options = {}, redirectCount = 0) {
  if (redirectCount > MAX_REDIRECTS) throw new Error("Too many redirects");

  const checked  = await assertSafeUrl(url);
  const maxBytes = options.maxBytes || FEED_MAX_BYTES;

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const lib = checked.protocol === "https:" ? https : http;
    const req = lib.get(checked.href, {
      timeout: 15000,
      lookup:  safeLookup,
      headers: { "User-Agent": "ReceiptPrinterClub-FeedPoller/1.0", ...options.headers },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        let redirectUrl;
        try {
          redirectUrl = new URL(res.headers.location, url).href;
        } catch {
          return fail(new Error("Feed returned an invalid redirect"));
        }
        // Handled entirely by the recursive call; ignore this request's events.
        settled = true;
        res.resume();
        fetchUrl(redirectUrl, options, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      let data = options.binary ? [] : "";
      let bytes = 0;

      const onData = (chunk) => {
        if (settled) return;
        bytes += chunk.length;
        if (bytes > maxBytes) {
          res.destroy();
          return fail(new Error("Feed response was too large"));
        }
        if (options.binary) data.push(chunk);
        else data += chunk;
      };
      const onEnd = () => {
        if (settled) return;
        settled = true;
        resolve({
          status:  res.statusCode,
          headers: res.headers,
          body:    options.binary ? Buffer.concat(data) : data,
        });
      };

      if (options.binary) {
        res.on("data", onData);
      } else {
        res.setEncoding("utf8");
        res.on("data", onData);
      }
      res.on("end", onEnd);
      res.on("error", fail);
    });
    req.on("timeout", () => { req.destroy(); fail(new Error("Request timed out")); });
    req.on("error", fail);
  });
}

// ── Save image from URL ───────────────────────────────────────────────────────
async function saveImageFromUrl(imageUrl) {
  try {
    const res = await fetchUrl(imageUrl, { binary: true, maxBytes: IMAGE_MAX_BYTES });
    if (res.status !== 200) return null;
    const ct  = (res.headers["content-type"] || "").toLowerCase();
    let ext = ".jpg";
    if      (ct.includes("png"))       ext = ".png";
    else if (ct.includes("gif"))       ext = ".gif";
    else if (ct.includes("webp"))      ext = ".webp";
    else if (ct.includes("avif"))      ext = ".avif";
    else if (ct.includes("heic"))      ext = ".heic";
    else if (ct.includes("heif"))      ext = ".heif";
    else if (ct.includes("tiff"))      ext = ".tiff";
    else if (ct.includes("bmp"))       ext = ".bmp";
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const destPath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(destPath, res.body);
    const ok = await resizeIfNeeded(destPath);
    if (!ok) {
      fs.unlink(destPath, () => {});
      return null;
    }
    return filename;
  } catch { return null; }
}

// ── XML helpers ───────────────────────────────────────────────────────────────
function xmlText(xml, tag) {
  // Extract first occurrence of <tag>...</tag> (handles CDATA)
  const re = new RegExp(`<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${tag}>`, "i");
  const m  = xml.match(re);
  return m ? m[1].trim() : null;
}

function xmlAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}[^>]+${attr}=["']([^"']+)["']`, "i");
  const m  = xml.match(re);
  return m ? m[1] : null;
}

function stripHtml(html) {
  return (html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ").trim();
}

// ── Feed parsers ──────────────────────────────────────────────────────────────

// Returns [{ id, title, body, imageUrl }] for items newer than lastItemId
function parseRSS(xml, lastItemId) {
  const items  = [];
  const chunks = xml.split(/<item[\s>]/i).slice(1);

  for (const chunk of chunks) {
    const guid  = xmlText(chunk, "guid") || xmlText(chunk, "link") || "";
    const title = stripHtml(xmlText(chunk, "title") || "");
    let   desc  = stripHtml(xmlText(chunk, "description") || xmlText(chunk, "content:encoded") || "");
    if (desc.length > 400) desc = desc.slice(0, 397) + "…";

    // Image: try enclosure, then media:content, then media:thumbnail
    let imageUrl = xmlAttr(chunk, "enclosure", "url") ||
                   xmlAttr(chunk, "media:content", "url") ||
                   xmlAttr(chunk, "media:thumbnail", "url") ||
                   null;

    // Only images (skip audio/video enclosures)
    const encType = xmlAttr(chunk, "enclosure", "type") || "";
    if (imageUrl && encType && !encType.startsWith("image/")) imageUrl = null;

    items.push({ id: guid, title, body: desc, imageUrl });
  }

  // Return only items after lastItemId (first item = newest in RSS)
  if (!lastItemId) return items.slice(0, 1); // first run: only print latest
  const idx = items.findIndex(i => i.id === lastItemId);
  const newItems = idx === -1 ? [] : items.slice(0, idx);
  return newItems.reverse(); // oldest first
}

function parseAtom(xml, lastItemId) {
  const items  = [];
  const chunks = xml.split(/<entry[\s>]/i).slice(1);

  for (const chunk of chunks) {
    const id    = xmlText(chunk, "id") || "";
    const title = stripHtml(xmlText(chunk, "title") || "");
    let   body  = stripHtml(xmlText(chunk, "summary") || xmlText(chunk, "content") || "");
    if (body.length > 400) body = body.slice(0, 397) + "…";
    const imageUrl = xmlAttr(chunk, "media:content", "url") ||
                     xmlAttr(chunk, "media:thumbnail", "url") || null;
    items.push({ id, title, body, imageUrl });
  }

  if (!lastItemId) return items.slice(0, 1);
  const idx = items.findIndex(i => i.id === lastItemId);
  const newItems = idx === -1 ? [] : items.slice(0, idx);
  return newItems.reverse();
}

// ── Special handler: XKCD ─────────────────────────────────────────────────────
async function fetchXKCD(lastItemId) {
  const res  = await fetchUrl("https://xkcd.com/info.0.json");
  if (res.status !== 200) return [];
  const comic = JSON.parse(res.body);
  const id    = String(comic.num);
  if (id === lastItemId) return [];
  const items = [];
  // If first run, just get latest. Otherwise get all between lastItemId and current.
  const start = lastItemId ? parseInt(lastItemId, 10) + 1 : comic.num;
  for (let n = start; n <= comic.num; n++) {
    try {
      const r  = await fetchUrl(`https://xkcd.com/${n}/info.0.json`);
      if (r.status !== 200) continue;
      const c  = JSON.parse(r.body);
      items.push({
        id:       String(c.num),
        title:    `XKCD #${c.num}: ${c.title}`,
        body:     c.alt || "",
        imageUrl: c.img,
      });
    } catch {}
  }
  return items;
}

// ── Process one subscription ──────────────────────────────────────────────────
async function processSubscription(sub) {
  console.log(`[feed] Checking "${sub.name}" (${sub.feed_url})`);
  try {
    let newItems = [];

    if (sub.feed_type === "xkcd") {
      newItems = await fetchXKCD(sub.last_item_id);
    } else {
      const res = await fetchUrl(sub.feed_url, { maxBytes: FEED_MAX_BYTES });
      if (res.status !== 200) {
        console.warn(`[feed] HTTP ${res.status} for ${sub.feed_url}`);
        db.updateSubscriptionChecked(sub.id, sub.last_item_id);
        return;
      }
      const xml = res.body;
      if (xml.includes("<feed") || xml.includes("<entry")) {
        newItems = parseAtom(xml, sub.last_item_id);
      } else {
        newItems = parseRSS(xml, sub.last_item_id);
      }
    }

    if (newItems.length > MAX_ITEMS_PER_POLL) {
      console.warn(`[feed] "${sub.name}": limiting ${newItems.length} new items to ${MAX_ITEMS_PER_POLL}`);
      newItems = newItems.slice(0, MAX_ITEMS_PER_POLL);
    }

    console.log(`[feed] "${sub.name}": ${newItems.length} new item(s)`);

    for (const item of newItems) {
      let image_path = null;
      if (item.imageUrl) {
        image_path = await saveImageFromUrl(item.imageUrl);
      }
      const body = [item.title, item.body].filter(Boolean).join("\n");
      db.createMessage({
        id:           uuidv4(),
        printer_id:   sub.printer_id,
        source:       "api",
        sender_name:  sub.name,
        sender_email: null,
        body:         body || null,
        image_path,
        word_wrap:    1,
        font_size:    null,
      });
      db.updateSubscriptionChecked(sub.id, item.id);
      console.log(`[feed] Queued: "${item.title}"`);
    }

    if (newItems.length === 0) {
      db.updateSubscriptionChecked(sub.id, sub.last_item_id);
    }
  } catch (err) {
    console.error(`[feed] Error processing "${sub.name}": ${err.message}`);
    db.updateSubscriptionChecked(sub.id, sub.last_item_id);
  }
}

// ── Main poll loop ────────────────────────────────────────────────────────────
async function pollAllFeeds() {
  const subs = db.getActiveSubscriptions();
  if (subs.length === 0) return;
  console.log(`[feed] Polling ${subs.length} subscription(s)…`);
  for (const sub of subs) {
    await processSubscription(sub);
  }
}

function start() {
  console.log(`[feed] Poller started — interval ${POLL_INTERVAL_MS / 60000} min`);
  // Stagger first run by 30s so server finishes starting up
  setTimeout(() => {
    pollAllFeeds();
    setInterval(pollAllFeeds, POLL_INTERVAL_MS);
  }, 30000);
}

module.exports = { start, pollAllFeeds, processSubscription };
