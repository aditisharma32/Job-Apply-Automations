'use strict';

// Scans recent delivery-failure notices via the Gmail API and marks the matching
// tracking-sheet rows "Bounced" (by HR Email). Stateless + idempotent.
const { simpleParser } = require('mailparser');
const config = require('../config');
const gmailApi = require('./gmailApi');
const sheet = require('./sheet');

const MAX = 200;
const ADDR = '[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}';

function scanText(set, text) {
  if (!text) return;
  const res = [
    new RegExp(`(?:Final|Original)-Recipient:\\s*(?:rfc822;)?\\s*<?(${ADDR})>?`, 'gi'),
    new RegExp(`message (?:wasn't delivered to|to)\\s+<?(${ADDR})>?`, 'gi'),
    new RegExp(`could(?:n't| not) be delivered to\\s+<?(${ADDR})>?`, 'gi'),
  ];
  for (const re of res) { let m; while ((m = re.exec(text))) set.add(m[1].toLowerCase()); }
}

function extractRecipients(parsed) {
  const out = new Set();
  const xfr = parsed.headers.get('x-failed-recipients');
  if (xfr) String(xfr).split(/[,;\s]+/).forEach((a) => /@/.test(a) && out.add(a.toLowerCase()));
  scanText(out, parsed.text || '');
  for (const att of parsed.attachments || []) {
    if (/delivery-status|rfc822|report/i.test(att.contentType || '')) scanText(out, att.content ? att.content.toString('utf8') : '');
  }
  return [...out];
}

function isPermanent(parsed) {
  const body = `${parsed.text || ''}\n${(parsed.attachments || []).map((a) => (a.content ? a.content.toString('utf8') : '')).join('\n')}`;
  const s = body.match(/\bStatus:\s*([245])\.\d+\.\d+/);
  if (s) return s[1] === '5';
  return /\b5\d\d[ -]5\.\d\.\d\b/.test(body) || /\b55\d\b/.test(body);
}

async function processBounces({ dryRun = false, rows } = {}) {
  const summary = { scanned: 0, bounced: [], alreadyBounced: 0, unmatchedCount: 0, errors: [] };

  const sheetRows = rows || (await sheet.getRows());
  const byEmail = new Map();
  for (const r of sheetRows) {
    const e = String(r['HR Email'] || r.hrEmail || '').trim().toLowerCase();
    if (e) byEmail.set(e, r);
  }

  // Nothing this project has emailed yet -> nothing a bounce could match.
  // (The inbox is shared with job_mail_autmation, whose NDRs we must ignore.)
  if (byEmail.size === 0) {
    summary.note = 'no tracked recipients yet — skipped';
    return summary;
  }

  const q = `newer_than:${config.poll.bounceLookbackDays}d (from:mailer-daemon OR from:postmaster OR subject:Undeliverable OR subject:"Delivery Status Notification")`;
  const ids = await gmailApi.listMessages(q, MAX);

  const seen = new Set();
  for (const id of ids) {
    let parsed;
    try {
      parsed = await simpleParser(await gmailApi.getRawMessage(id));
    } catch (err) {
      summary.errors.push({ id, error: err.message });
      continue;
    }
    summary.scanned += 1;
    const recips = extractRecipients(parsed);
    if (!recips.length || !isPermanent(parsed)) continue;

    for (const email of recips) {
      const row = byEmail.get(email);
      if (!row) { summary.unmatchedCount += 1; continue; }
      const cur = String(row.Status || row.status || '').toLowerCase();
      if (cur === 'bounced' || seen.has(email)) { summary.alreadyBounced += 1; continue; }
      seen.add(email);
      summary.bounced.push(email);
      if (!dryRun) {
        try {
          await sheet.updateStatus({ 'HR Email': email }, 'Bounced', `bounce ${new Date().toISOString()}`);
        } catch (err) {
          summary.errors.push({ email, error: err.message });
        }
      }
    }
  }
  return summary;
}

module.exports = { processBounces };
