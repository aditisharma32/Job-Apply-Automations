'use strict';

// DNS MX lookup — skip sending to a domain that has no mail server (a cheap way
// to avoid the most obvious bounces from a guessed hr@ address).
const dns = require('dns').promises;

const cache = new Map();

async function hasMx(domain) {
  if (!domain || !/\./.test(domain)) return false;
  if (cache.has(domain)) return cache.get(domain);
  let ok = false;
  try {
    const mx = await dns.resolveMx(domain);
    ok = Array.isArray(mx) && mx.length > 0;
  } catch {
    // NODATA / NXDOMAIN / SERVFAIL -> treat as no mail
    ok = false;
  }
  cache.set(domain, ok);
  return ok;
}

module.exports = { hasMx };
