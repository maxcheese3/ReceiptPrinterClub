/**
 * Rate limiting — only applied to public message submission.
 * The printer poll endpoint (/api/messages/poll) is API-key authenticated
 * and explicitly excluded.
 *
 * Progressive tiers for message POST:
 *   Normal:  10 messages / 60s  — no penalty
 *   Abusive: if exceeded, 10 min cooling period at 3 messages / 60s
 */

const WINDOW_MS      = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10);
const BURST_MAX      = 10;
const COOLING_MAX    = 3;
const COOLING_MS     = 10 * 60 * 1000;

// ip → expiry timestamp of cooling period
const coolingIPs = new Map();
// ip → { count, windowStart }
const burstCounters = new Map();

function isInCooling(ip) {
  const exp = coolingIPs.get(ip);
  if (!exp) return false;
  if (Date.now() > exp) { coolingIPs.delete(ip); return false; }
  return true;
}

function recordAndCheck(ip) {
  const now = Date.now();

  if (isInCooling(ip)) return "cooling";

  let c = burstCounters.get(ip);
  if (!c || now - c.windowStart > WINDOW_MS) {
    c = { count: 0, windowStart: now };
  }
  c.count++;
  burstCounters.set(ip, c);

  if (c.count > BURST_MAX) {
    coolingIPs.set(ip, now + COOLING_MS);
    burstCounters.delete(ip);
    return "cooling";
  }
  return "ok";
}

// Applied only to POST /api/messages
function messageLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const result = recordAndCheck(ip);

  if (result === "cooling") {
    const exp = coolingIPs.get(ip);
    const secsLeft = exp ? Math.ceil((exp - Date.now()) / 1000) : 600;
    res.setHeader("Retry-After", secsLeft);
    return res.status(429).json({
      error: `Too many messages sent. Please wait ${Math.ceil(secsLeft / 60)} minute(s).`,
    });
  }

  const c = burstCounters.get(ip);
  if (c) {
    res.setHeader("X-RateLimit-Limit",     BURST_MAX);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, BURST_MAX - c.count));
  }
  next();
}

// No-op — kept for import compatibility but not used on poll/printers
function apiLimiter(req, res, next) { next(); }

module.exports = { apiLimiter, messageLimiter };
