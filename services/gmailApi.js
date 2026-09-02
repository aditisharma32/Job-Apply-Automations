'use strict';

// Gmail API over HTTPS (port 443) — send, read, and label. Render blocks SMTP
// and IMAP, so everything goes through this. Refresh token from
// `npm run google-token` with scopes gmail.send + gmail.modify.
const config = require('../config');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (s) =>
  Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

let cached = { token: null, expiresAt: 0 };
let refreshing = null;

async function refreshAccessToken() {
  const g = config.google;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: g.clientId,
      client_secret: g.clientSecret,
      refresh_token: g.refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Gmail OAuth refresh failed (${res.status}): ${data.error || 'unknown'} ${data.error_description || ''}`.trim()
    );
  }
  cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cached.token;
}

async function getAccessToken() {
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;
  if (!refreshing) refreshing = refreshAccessToken().finally(() => { refreshing = null; });
  return refreshing;
}

async function apiFetch(path, { method = 'GET', body, headers = {}, retryAuth = true } = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  if (res.status === 401 && retryAuth) {
    cached = { token: null, expiresAt: 0 };
    return apiFetch(path, { method, body, headers, retryAuth: false });
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = (data && data.error && (data.error.message || data.error)) || text || `HTTP ${res.status}`;
    throw new Error(`Gmail API ${method} ${path} -> ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return data;
}

/** Send a full RFC 5322 message. Returns { id, threadId }. */
async function sendRaw(mime) {
  const raw = b64url(Buffer.isBuffer(mime) ? mime : Buffer.from(String(mime)));
  return apiFetch('/messages/send', { method: 'POST', body: { raw } });
}

/** Message ids matching a Gmail search query (paged). */
async function listMessages(q, max = 100) {
  const out = [];
  let pageToken;
  do {
    const qs = new URLSearchParams({ q, maxResults: String(Math.min(max, 100)) });
    if (pageToken) qs.set('pageToken', pageToken);
    const data = await apiFetch(`/messages?${qs.toString()}`);
    for (const m of (data && data.messages) || []) out.push(m.id);
    pageToken = data && data.nextPageToken;
  } while (pageToken && out.length < max);
  return out;
}

/** Full raw MIME of a message as a Buffer. */
async function getRawMessage(id) {
  const data = await apiFetch(`/messages/${encodeURIComponent(id)}?format=raw`);
  return data && data.raw ? b64urlDecode(data.raw) : Buffer.alloc(0);
}

let labelCache = null;
async function ensureLabel(name) {
  if (!labelCache) {
    const data = await apiFetch('/labels');
    labelCache = new Map((data.labels || []).map((l) => [l.name, l.id]));
  }
  if (labelCache.has(name)) return labelCache.get(name);
  const created = await apiFetch('/labels', {
    method: 'POST',
    body: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
  });
  labelCache.set(name, created.id);
  return created.id;
}

async function modifyLabels(id, { add = [], remove = [] } = {}) {
  return apiFetch(`/messages/${encodeURIComponent(id)}/modify`, {
    method: 'POST',
    body: { addLabelIds: add, removeLabelIds: remove },
  });
}

/** Liveness check. Returns { ok, emailAddress }. */
async function verify() {
  const prof = await apiFetch('/profile');
  return { ok: true, emailAddress: prof.emailAddress };
}

module.exports = { sendRaw, listMessages, getRawMessage, ensureLabel, modifyLabels, verify };
