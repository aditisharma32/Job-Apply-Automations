'use strict';

const fs = require('fs');
const path = require('path');

const config = require('../config');
const gmailApi = require('./gmailApi');
const mailer = require('./mailer');
const sheet = require('./sheet');
const { extractFromEmail } = require('./extract');
const { resolveHrEmail } = require('./hrResolver');
const { processBounces } = require('./bounces');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'templates', 'email.html'), 'utf8');
const TEXT = fs.readFileSync(path.join(__dirname, '..', 'templates', 'email.txt'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Confirmation-email senders/subjects to look for. EXTRA_SENDERS can bolt on more.
const BASE_TERMS = [
  'subject:"your application was sent"',
  'subject:"application was sent to"',
  'subject:"we received your application"',
  'subject:"thank you for applying"',
  'subject:"thanks for applying"',
  'subject:"application received"',
  'subject:"your application to"',
  'subject:"application submitted"',
  'from:jobs-noreply@linkedin.com',
  'from:jobs-listings@linkedin.com',
  'from:no-reply@greenhouse.io',
  'from:no-reply@us.greenhouse-mail.io',
  'from:no-reply@hire.lever.co',
  'from:notifications@naukri.com',
  'from:noreply@indeed.com',
];

function buildQuery() {
  const terms = [...BASE_TERMS];
  for (const t of config.poll.extraSenders.split(',').map((s) => s.trim()).filter(Boolean)) {
    // already an operator (from:/subject:/list:...) -> keep; otherwise treat as a sender
    terms.push(/^\w+:/.test(t) ? t : `from:${t}`);
  }
  return `newer_than:${config.poll.lookbackDays}d -label:"${config.poll.doneLabel}" in:anywhere (${terms.join(' OR ')})`;
}

function headerValue(parsed, name) {
  const v = parsed.headers.get(name.toLowerCase());
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (v.text) return v.text;
  if (v.value) return String(v.value);
  return String(v);
}

function render(str, vars) {
  return str
    .replace(/\{\{\s*title\s*\}\}/g, vars.title || 'the role')
    .replace(/\{\{\s*company\s*\}\}/g, vars.company || 'your company')
    .replace(/\{\{\s*nameComma\s*\}\}/g, vars.name ? ` ${vars.name},` : ' there,');
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun]
 * @param {number}  [opts.limit]
 */
async function runPoll(opts = {}) {
  const dryRun = opts.dryRun ?? config.dryRun;
  const limit = opts.limit ?? config.poll.maxPerPoll;
  const startedAt = new Date();

  await mailer.verifyTransport();
  const doneLabelId = await gmailApi.ensureLabel(config.poll.doneLabel);

  const summary = {
    startedAt: startedAt.toISOString(),
    dryRun,
    found: 0,
    sent: 0,
    skippedNotApplication: 0,
    skippedNoDomain: 0,
    skippedDuplicate: 0,
    failed: 0,
    results: [],
  };

  const rows = await sheet.getRows();

  if (config.poll.processBounces && !dryRun) {
    try {
      summary.bounces = await processBounces({ rows });
    } catch (err) {
      summary.bounces = { error: (err && err.message) || String(err) };
    }
  }

  // domains already contacted (any status other than a soft skip)
  const contactedDomains = new Set();
  const contactedEmails = new Set();
  for (const r of rows) {
    const st = String(r.Status || '').toLowerCase();
    if (['sent', 'bounced', 'replied'].includes(st)) {
      if (r.Domain) contactedDomains.add(String(r.Domain).toLowerCase());
      if (r['HR Email']) contactedEmails.add(String(r['HR Email']).toLowerCase());
    }
  }

  const ids = await gmailApi.listMessages(buildQuery(), 100);
  summary.found = ids.length;

  let processed = 0;
  for (const id of ids) {
    if (processed >= limit) break;

    let parsed;
    try {
      parsed = await require('mailparser').simpleParser(await gmailApi.getRawMessage(id));
    } catch (err) {
      summary.failed += 1;
      summary.results.push({ id, outcome: 'parse-error', error: err.message });
      continue;
    }

    const emailData = {
      subject: parsed.subject || '',
      from: headerValue(parsed, 'from'),
      text: parsed.text || parsed.html || '',
    };

    let info;
    try {
      info = await extractFromEmail(emailData);
    } catch (err) {
      summary.failed += 1;
      summary.results.push({ id, subject: emailData.subject, outcome: 'extract-error', error: err.message });
      continue; // leave unlabelled -> retried next poll
    }

    const base = { id, subject: emailData.subject, company: info.company, title: info.jobTitle, confidence: info.confidence };

    if (!info.isJobApplication || info.confidence < config.poll.minConfidence || !info.company) {
      summary.skippedNotApplication += 1;
      summary.results.push({ ...base, outcome: 'not-an-application' });
      if (!dryRun) await gmailApi.modifyLabels(id, { add: [doneLabelId] });
      continue;
    }

    const resolved = await resolveHrEmail({ company: info.company, companyDomain: info.companyDomain });
    if (!resolved.email) {
      summary.skippedNoDomain += 1;
      summary.results.push({ ...base, outcome: 'no-domain' });
      if (!dryRun) {
        await sheet.appendRow(rowFor(info, emailData, null, resolved, 'No domain'));
        await gmailApi.modifyLabels(id, { add: [doneLabelId] });
      }
      continue;
    }

    if (contactedDomains.has(resolved.domain) || contactedEmails.has(resolved.email)) {
      summary.skippedDuplicate += 1;
      summary.results.push({ ...base, hrEmail: resolved.email, outcome: 'duplicate' });
      if (!dryRun) await gmailApi.modifyLabels(id, { add: [doneLabelId] });
      continue;
    }

    const subject = render(config.subjectTemplate, { title: info.jobTitle, company: info.company });
    const html = render(HTML, { title: info.jobTitle, company: info.company });
    const text = render(TEXT, { title: info.jobTitle, company: info.company });

    // Track within the run so a second email for the same company (e.g.
    // "DigiCert" and "DigiCert, Inc.") is deduped in both dry and real runs.
    contactedDomains.add(resolved.domain);
    contactedEmails.add(resolved.email);

    if (dryRun) {
      summary.sent += 1;
      summary.results.push({ ...base, hrEmail: resolved.email, outcome: 'dry-run', subject });
      processed += 1;
      continue;
    }

    try {
      const sent = await mailer.sendMail({ to: resolved.email, subject, html, text });
      summary.sent += 1;
      summary.results.push({ ...base, hrEmail: resolved.email, outcome: 'sent', gmailId: sent.gmailId });
      await sheet.appendRow(rowFor(info, emailData, sent, resolved, 'Sent'));
      await gmailApi.modifyLabels(id, { add: [doneLabelId] });
    } catch (err) {
      summary.failed += 1;
      summary.results.push({ ...base, hrEmail: resolved.email, outcome: 'send-failed', error: err.message });
      try {
        await sheet.appendRow(rowFor(info, emailData, null, resolved, 'Failed', err.message));
      } catch { /* ignore secondary failure */ }
    }

    processed += 1;
    if (processed < limit) await sleep(config.poll.sendDelayMs);
  }

  summary.finishedAt = new Date().toISOString();
  summary.durationMs = Date.now() - startedAt.getTime();
  return summary;
}

function rowFor(info, emailData, sent, resolved, status, notes) {
  return {
    Date: new Date().toISOString(),
    Company: info.company || '',
    Title: info.jobTitle || '',
    Location: info.location || '',
    Domain: resolved.domain || '',
    'HR Email': resolved.email || '',
    Status: status,
    Source: emailData.from || '',
    'Message ID': sent ? sent.gmailId || '' : '',
    Notes: notes || resolved.method || '',
  };
}

module.exports = { runPoll, buildQuery, render };
