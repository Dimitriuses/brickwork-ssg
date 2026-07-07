'use strict';
// Request-security predicates for the admin server — pure functions (no Express), so they are unit-
// testable and the server just wires them into one middleware. The admin is unauthenticated and edits
// real source data, so it defends the two browser-mediated risks a localhost dev server faces:
//   - DNS rebinding: a page at attacker.com resolved to 127.0.0.1 posts to the admin with a FOREIGN
//     Host header. When bound localhost-only, only answer to a loopback Host.
//   - CSRF: a cross-site page fires a state-changing POST/PUT/DELETE at 127.0.0.1. The browser attaches
//     an Origin header on those, so refuse when the Origin isn't the admin's own.

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const STATE_CHANGING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

// The hostname of a Host header, lowercased, with any :port stripped (bracketed IPv6 kept intact).
function hostname(hostHeader) {
  const h = String(hostHeader || '').trim();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1).toLowerCase(); // [::1]:3000 -> [::1]
  return h.split(':')[0].toLowerCase();
}

// True when the request's Host header names a loopback host — the DNS-rebinding guard, applied by the
// server only when it is bound localhost-only (the default).
function hostAllowed(hostHeader) {
  return LOCAL_HOSTS.has(hostname(hostHeader));
}

// True when a state-changing request must be REFUSED because its Origin is cross-site. No Origin (curl,
// a same-document navigation) is allowed; a browser attaches Origin to cross-site POST/PUT/DELETE, so
// an Origin that is neither loopback nor the request's own host is the CSRF attack. A malformed Origin
// is refused.
function crossOriginBlocked(method, originHeader, hostHeader) {
  if (!STATE_CHANGING.has(String(method || '').toUpperCase())) return false;
  if (!originHeader) return false;
  let originHost;
  try { originHost = new URL(originHeader).hostname.toLowerCase(); } catch (e) { return true; }
  return !(LOCAL_HOSTS.has(originHost) || originHost === hostname(hostHeader));
}

// Validate an item-relative file path that MAY contain "/" subdirs (parts can match nested files, e.g.
// `gallery/*.jpg`). Returns the normalized posix relative path, or null if unsafe: it must be relative
// (no leading slash / drive) and every segment must be non-empty and not ".", "..", a backslash, or a
// NUL. resolveWithin() still asserts final containment — this is defense in depth for the file routes.
function safeRelPath(s) {
  const str = String(s == null ? '' : s);
  if (!str || str.startsWith('/') || str.startsWith('\\') || /^[a-zA-Z]:/.test(str)) return null;
  const segs = str.split('/');
  for (const seg of segs) {
    if (!seg || seg === '.' || seg === '..' || seg.includes('\\') || seg.includes('\0')) return null;
  }
  return segs.join('/');
}

module.exports = { hostAllowed, crossOriginBlocked, safeRelPath, hostname, LOCAL_HOSTS, STATE_CHANGING };
