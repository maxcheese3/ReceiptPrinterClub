/**
 * Server-side URL fetch safety.
 *
 * Several features ask the server to fetch a URL supplied by a user
 * (`image_url`, OAuth token endpoints, RSS/Atom feeds, feed images). Without a
 * guard those features are an SSRF primitive: an attacker can make the server
 * request localhost, Docker-internal services, or cloud metadata endpoints and
 * either read the response through an error message or have it stored under the
 * public /uploads path.
 *
 * By default only public HTTP(S) destinations are allowed. Every redirect and
 * every DNS resolution is checked, and the lookup used for the actual socket
 * connection is guarded too, so a DNS-rebinding host cannot slip through
 * between the check and the connect.
 *
 * Set ALLOW_PRIVATE_NETWORK_FETCH=1 to opt out (needed if you deliberately
 * integrate with an on-prem service on a private network).
 */

"use strict";

const dns = require("dns");
const net = require("net");

const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_NETWORK_FETCH === "1";

// ── IPv4 ──────────────────────────────────────────────────────────────────────

function ipv4ToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = n * 256 + octet;
  }
  return n >>> 0;
}

const IPV4_BLOCKED = [
  ["0.0.0.0", 8],        // "this" network
  ["10.0.0.0", 8],       // private
  ["100.64.0.0", 10],    // carrier-grade NAT
  ["127.0.0.0", 8],      // loopback
  ["169.254.0.0", 16],   // link-local / cloud metadata
  ["172.16.0.0", 12],    // private
  ["192.0.0.0", 24],     // IETF protocol assignments
  ["192.0.2.0", 24],     // documentation
  ["192.88.99.0", 24],   // 6to4 relay anycast
  ["192.168.0.0", 16],   // private
  ["198.18.0.0", 15],    // benchmarking
  ["198.51.100.0", 24],  // documentation
  ["203.0.113.0", 24],   // documentation
  ["224.0.0.0", 4],      // multicast
  ["240.0.0.0", 4],      // reserved / broadcast
].map(([base, bits]) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: (ipv4ToInt(base) & mask) >>> 0, mask };
});

function isBlockedIPv4(ip) {
  const n = ipv4ToInt(ip);
  if (n === null) return true;
  return IPV4_BLOCKED.some(({ base, mask }) => ((n & mask) >>> 0) === base);
}

// ── IPv6 ──────────────────────────────────────────────────────────────────────

function ipv6ToBigInt(ip) {
  let s = ip.toLowerCase().split("%")[0];
  let embeddedV4 = null;

  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    if (lastColon < 0) return null;
    embeddedV4 = ipv4ToInt(s.slice(lastColon + 1));
    if (embeddedV4 === null) return null;
    const hi = Math.floor(embeddedV4 / 65536).toString(16);
    const lo = (embeddedV4 % 65536).toString(16);
    s = s.slice(0, lastColon + 1) + hi + ":" + lo;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;

  if (missing < 0) return null;
  if (halves.length === 1 && missing !== 0) return null;

  const groups = [...head, ...Array(missing).fill("0"), ...tail];
  if (groups.length !== 8) return null;

  let n = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    n = (n << 16n) | BigInt(parseInt(group, 16));
  }
  return n;
}

const V6_MAX = (1n << 128n) - 1n;

function v6Mask(bits) {
  if (bits === 0) return 0n;
  return (V6_MAX << BigInt(128 - bits)) & V6_MAX;
}

const V6_GLOBAL_BASE = ipv6ToBigInt("2000::") & v6Mask(3);
const V6_GLOBAL_MASK = v6Mask(3);

const IPV6_BLOCKED = [
  ["2001::", 32],      // Teredo
  ["2001:2::", 48],    // benchmarking
  ["2001:10::", 28],   // ORCHID
  ["2001:20::", 28],   // ORCHIDv2
  ["2001:db8::", 32],  // documentation
  ["2002::", 16],      // 6to4
  ["3fff::", 20],      // documentation
].map(([base, bits]) => ({
  base: ipv6ToBigInt(base) & v6Mask(bits),
  mask: v6Mask(bits),
}));

function isBlockedIPv6(ip) {
  const n = ipv6ToBigInt(ip);
  if (n === null) return true;

  // Only global unicast (2000::/3) is reachable. This excludes loopback,
  // unspecified, IPv4-mapped, ULA, link-local, multicast, NAT64, etc.
  if ((n & V6_GLOBAL_MASK) !== V6_GLOBAL_BASE) return true;

  return IPV6_BLOCKED.some(({ base, mask }) => (n & mask) === base);
}

function stripBrackets(hostname) {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function isBlockedIp(ip) {
  if (ALLOW_PRIVATE) return false;
  const clean = stripBrackets(String(ip)).split("%")[0];
  const family = net.isIP(clean);
  if (family === 4) return isBlockedIPv4(clean);
  if (family === 6) return isBlockedIPv6(clean);
  return true;
}

// ── Public API ────────────────────────────────────────────────────────────────

function isForbiddenHostname(hostname) {
  const h = hostname.toLowerCase();
  return h === "localhost"
    || h.endsWith(".localhost")
    || h.endsWith(".local")
    || h.endsWith(".internal")
    || h.endsWith(".home.arpa");
}

/**
 * Validate a URL before fetching. Throws with a user-safe message if the URL
 * is not HTTP(S) or resolves to a private/reserved address.
 *
 * Note: the actual connection also uses safeLookup(), so this check cannot be
 * defeated by DNS rebinding between validation and connect.
 */
async function assertSafeUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }
  if (!url.hostname) {
    throw new Error("URL must include a host");
  }
  if (ALLOW_PRIVATE) return url;

  const host = stripBrackets(url.hostname).toLowerCase();
  if (isForbiddenHostname(host)) {
    throw new Error("URL host is not allowed");
  }

  if (net.isIP(host)) {
    if (isBlockedIp(host)) {
      throw new Error("URL points to a private or reserved address");
    }
    return url;
  }

  let addresses;
  try {
    addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("Could not resolve URL host");
  }

  if (!addresses.length) {
    throw new Error("Could not resolve URL host");
  }
  if (addresses.some((entry) => isBlockedIp(entry.address))) {
    throw new Error("URL resolves to a private or reserved address");
  }
  return url;
}

/**
 * dns.lookup replacement passed to http(s).request. It rejects if any resolved
 * address is private/reserved, so the socket can never connect to one.
 */
function safeLookup(hostname, options, callback) {
  if (ALLOW_PRIVATE) return dns.lookup(hostname, options, callback);

  const opts = (options && typeof options === "object") ? options : {};
  const family = typeof options === "number" ? options : opts.family;

  dns.lookup(hostname, { ...opts, family, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses || !addresses.length) {
      return callback(new Error("Could not resolve host"));
    }
    if (addresses.some((entry) => isBlockedIp(entry.address))) {
      return callback(new Error("Blocked private or reserved address"));
    }
    if (opts.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

module.exports = {
  ALLOW_PRIVATE_NETWORK_FETCH: ALLOW_PRIVATE,
  assertSafeUrl,
  safeLookup,
  isBlockedIp,
};
