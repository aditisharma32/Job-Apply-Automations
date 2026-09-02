'use strict';

// Client for the tracking Google Sheet, via its Apps Script web app (/exec).
//   GET                                  -> { success, count, data: [ {col: value} ] }
//   POST { action:'append', row:{...} }  -> add a row
//   POST { action:'updateStatus', match:{col:value}, status, notes } -> patch matching row(s)
const config = require('../config');

const TIMEOUT_MS = 20000;

async function request(method, body) {
  const url = new URL(config.sheet.apiUrl);
  if (config.sheet.token) url.searchParams.set('token', config.sheet.token);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Sheet API returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok || json.success === false) {
      throw new Error(json && json.error ? json.error : `Sheet API HTTP ${res.status}`);
    }
    return json;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Sheet API timed out after ${TIMEOUT_MS}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function getRows() {
  const json = await request('GET');
  return Array.isArray(json.data) ? json.data : [];
}

async function appendRow(row) {
  return request('POST', { ...(config.sheet.token ? { token: config.sheet.token } : {}), action: 'append', row });
}

async function updateStatus(match, status, notes) {
  return request('POST', {
    ...(config.sheet.token ? { token: config.sheet.token } : {}),
    action: 'updateStatus',
    match,
    status,
    notes: notes || '',
  });
}

module.exports = { getRows, appendRow, updateStatus };
