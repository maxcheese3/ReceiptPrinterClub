/**
 * Rate limiting.
 *
 * - Requests carrying a VALID printer API key are exempt from the broad API
 *   limiter (so polling is never throttled). An arbitrary/forged X-API-Key
 *   header must NOT bypass limits — only a key that resolves to a printer does.
 * - Message submissions get a stricter per-IP tier with a cooling period.
 *   Integrations with a valid key get a higher ceiling (but are still capped):
 *     Normal (no key):      10 messages / 60s
 *     Valid API key:        120 messages / 60s
 *     Abusive:              10-minute cooling period (no submissions)
 * - Admin login and printer registration have their own tight limits.
 */

const rateLimit = require("express-rate-limit");
const db        = require("../db");

function positiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const WINDOW_MS  = positiveInt(process.env.RATE_LIMIT_WINDOW_MS, 60000);
const BURST_MAX  = 10;
const AUTOMATION_BURST_MAX = positiveInt(process.env.AUTOMATION_MESSAGE_RATE_MAX, 120);
const COOLING_MS = 10 * 60 * 1000;

const coolingIPs    = new Map(); // ip → expiry
const burstCounters = new Map(); // ip → { count, windowStart }

function isInCooling(ip) {
  const exp = coolingIPs.get(ip);
  if (!exp) return false;
  if (Date.now() > exp) { coolingIPs.delete(ip); return false; }
  return true;
}

function recordAndCheck(ip, max) {
  const now = Date.now();
  if (isInCooling(ip)) return "cooling";

  let c = burstCounters.get(ip);
  if (!c || now - c.windowStart > WINDOW_MS) c = { count: 0, windowStart: now };
  c.count++;
  burstCounters.set(ip, c);

  if (c.count > max) {
    coolingIPs.set(ip, now + COOLING_MS);
    burstCounters.delete(ip);
    return "cooling";
  }
  return "ok";
}

// Periodically drop expired entries so a stream of unique IPs cannot grow the
// maps without bound.
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, exp] of coolingIPs) {
    if (now > exp) coolingIPs.delete(ip);
  }
  for (const [ip, c] of burstCounters) {
    if (now - c.windowStart > WINDOW_MS * 2) burstCounters.delete(ip);
  }
}, 60 * 1000);
if (typeof sweepTimer.unref === "function") sweepTimer.unref();

function hasValidApiKey(req) {
  const key = req.headers["x-api-key"];
  return !!(key && db.getPrinterByApiKey(key));
}

// Applied to every /api route. Valid printer clients (which poll every few
// seconds) are exempt; everything else is capped per IP.
const apiLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit:    positiveInt(process.env.API_RATE_LIMIT_MAX, 300),
  standardHeaders: "draft-7",
  legacyHeaders:   false,
  skip: hasValidApiKey,
  message: { error: "Too many requests. Please slow down." },
});

// Only applied to POST /api/messages. A valid API key raises the ceiling but
// does not remove it — registration is public, so "has a key" cannot mean
// "unlimited".
function messageLimiter(req, res, next) {
  const max = hasValidApiKey(req) ? AUTOMATION_BURST_MAX : BURST_MAX;

  const ip = req.ip || req.socket.remoteAddress || "unknown";
  // Separate buckets so automation traffic and anonymous traffic from the same
  // NAT address do not consume each other's allowance.
  const bucket = `${ip}:${max}`;
  const result = recordAndCheck(bucket, max);

  if (result === "cooling") {
    const exp = coolingIPs.get(bucket);
    const secsLeft = exp ? Math.ceil((exp - Date.now()) / 1000) : 600;
    res.setHeader("Retry-After", secsLeft);
    return res.status(429).json({
      error: `Too many messages. Please wait ${Math.ceil(secsLeft / 60)} minute(s).`,
    });
  }

  const c = burstCounters.get(bucket);
  if (c) {
    res.setHeader("X-RateLimit-Limit",     max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, max - c.count));
  }
  next();
}

// Failed admin logins only. Successful logins do not count.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit:    positiveInt(process.env.ADMIN_LOGIN_RATE_LIMIT_MAX, 10),
  standardHeaders: "draft-7",
  legacyHeaders:   false,
  skipSuccessfulRequests: true,
  message: { error: "Too many login attempts. Try again later." },
});

// Printer registration is open to the public, so cap it per IP to prevent
// directory/database flooding.
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit:    positiveInt(process.env.REGISTRATION_RATE_LIMIT_MAX, 5),
  standardHeaders: "draft-7",
  legacyHeaders:   false,
  message: { error: "Too many printer registrations from this address. Try again later." },
});

module.exports = { apiLimiter, messageLimiter, loginLimiter, registrationLimiter };
