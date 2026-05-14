/**
 * Subscription routes — authenticated by printer API key.
 *
 * GET    /api/subscriptions          list subs for the authenticated printer
 * POST   /api/subscriptions          create a subscription
 * PATCH  /api/subscriptions/:id      update (name, feed_url, active)
 * DELETE /api/subscriptions/:id      delete
 * POST   /api/subscriptions/:id/poll trigger immediate poll for one subscription
 */

"use strict";

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const db     = require("../db");
const { pollAllFeeds } = require("../services/feedPoller");

const router = express.Router();

function requireApiKey(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!key) return res.status(401).json({ error: "X-API-Key header required" });
  const printer = db.getPrinterByApiKey(key);
  if (!printer) return res.status(403).json({ error: "Invalid API key" });
  req.printer = printer;
  next();
}

// Detect feed type from URL
function detectFeedType(url) {
  if (/xkcd\.com/i.test(url)) return "xkcd";
  return "rss"; // default; parser auto-detects RSS vs Atom at poll time
}

// GET /api/subscriptions
router.get("/", requireApiKey, (req, res) => {
  return res.json({ subscriptions: db.getSubscriptionsByPrinter(req.printer.id) });
});

// POST /api/subscriptions
router.post("/", requireApiKey, (req, res) => {
  const { name, feed_url } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
  if (!feed_url || !feed_url.trim()) return res.status(400).json({ error: "feed_url is required" });
  try { new URL(feed_url); } catch { return res.status(400).json({ error: "Invalid feed_url" }); }

  const sub = db.createSubscription({
    id:         uuidv4(),
    printer_id: req.printer.id,
    name:       name.trim(),
    feed_url:   feed_url.trim(),
    feed_type:  detectFeedType(feed_url.trim()),
  });
  return res.status(201).json({ success: true, subscription: sub });
});

// PATCH /api/subscriptions/:id
router.patch("/:id", requireApiKey, (req, res) => {
  const sub = db.getSubscriptionById(req.params.id);
  if (!sub) return res.status(404).json({ error: "Subscription not found" });
  if (sub.printer_id !== req.printer.id) return res.status(403).json({ error: "Forbidden" });

  const { name, feed_url, active } = req.body;
  db.updateSubscription(req.params.id, {
    name:      name      !== undefined ? name.trim()    : sub.name,
    feed_url:  feed_url  !== undefined ? feed_url.trim(): sub.feed_url,
    feed_type: feed_url  !== undefined ? detectFeedType(feed_url.trim()) : sub.feed_type,
    active:    active    !== undefined ? (active ? 1 : 0) : sub.active,
  });
  return res.json({ success: true, subscription: db.getSubscriptionById(req.params.id) });
});

// DELETE /api/subscriptions/:id
router.delete("/:id", requireApiKey, (req, res) => {
  const sub = db.getSubscriptionById(req.params.id);
  if (!sub) return res.status(404).json({ error: "Subscription not found" });
  if (sub.printer_id !== req.printer.id) return res.status(403).json({ error: "Forbidden" });
  db.deleteSubscription(req.params.id);
  return res.json({ success: true });
});

// POST /api/subscriptions/:id/poll — immediate poll
router.post("/:id/poll", requireApiKey, async (req, res) => {
  const sub = db.getSubscriptionById(req.params.id);
  if (!sub) return res.status(404).json({ error: "Subscription not found" });
  if (sub.printer_id !== req.printer.id) return res.status(403).json({ error: "Forbidden" });
  // Async — don't await so response returns immediately
  const { processSubscription } = require("../services/feedPoller");
  res.json({ success: true, message: "Poll triggered" });
  // We import lazily to avoid circular dep
  try {
    const fp = require("../services/feedPoller");
    // Reset last_item_id to force re-fetch of latest
    db.updateSubscriptionChecked(sub.id, null);
    await fp.pollAllFeeds();
  } catch (err) {
    console.error("[feed] Manual poll error:", err.message);
  }
});

module.exports = router;
