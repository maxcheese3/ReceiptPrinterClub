/**
 * Rate limiting.
 *
 * - Printer clients (authenticated with X-API-Key) are NEVER rate limited.
 * - Web/API message submissions are rate limited per IP with progressive tiers:
 *     Normal:  10 messages / 60s
 *     Abusive: 10-min cooling period at 3 messages / 60s
 */

const WINDOW_MS   = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10);
const BURST_MAX   = 10;
const COOLING_MAX = 3;
const COOLING_MS  = 10 * 60 * 1000;

const coolingIPs    = new Map(); // ip → expiry
const burstCounters = new Map(); // ip → { count, windowStart }

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
  if (!c || now - c.windowStart > WINDOW_MS) c = { count: 0, windowStart: now };
  c.count++;
  burstCounters.set(ip, c);

  if (c.count > BURST_MAX) {
    coolingIPs.set(ip, now + COOLING_MS);
    burstCounters.delete(ip);
    return "cooling";
  }
  return "ok";
}

// Only applied to POST /api/messages — skips authenticated printer clients
function messageLimiter(req, res, next) {
  // Printer clients authenticate with X-API-Key — never rate limit them
  if (req.headers["x-api-key"]) return next();

  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const result = recordAndCheck(ip);

  if (result === "cooling") {
    const exp = coolingIPs.get(ip);
    const secsLeft = exp ? Math.ceil((exp - Date.now()) / 1000) : 600;
    res.setHeader("Retry-After", secsLeft);
    return res.status(429).json({
      error: `Too many messages. Please wait ${Math.ceil(secsLeft / 60)} minute(s).`,
    });
  }

  const c = burstCounters.get(ip);
  if (c) {
    res.setHeader("X-RateLimit-Limit",     BURST_MAX);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, BURST_MAX - c.count));
  }
  next();
}

// No blanket API limiter — was causing false positives on poll endpoint
function apiLimiter(_req, _res, next) { next(); }

module.exports = { apiLimiter, messageLimiter };
