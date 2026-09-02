'use strict';

const express = require('express');
const config = require('./config');
const { runPoll } = require('./services/poller');
const { processBounces } = require('./services/bounces');

const app = express();
app.use(express.json());

let running = false;
let runStartedAt = 0;
let lastRun = null;

const STALE_LOCK_MS = 15 * 60 * 1000;

function locked() {
  if (!running) return false;
  if (Date.now() - runStartedAt > STALE_LOCK_MS) {
    console.warn(`[lock] previous run stale (${Math.round((Date.now() - runStartedAt) / 1000)}s) — overriding`);
    return false;
  }
  return true;
}

function authorized(req) {
  if (!config.pollSecret) return true;
  const provided = req.get('x-poll-secret') || req.query.key || '';
  return provided === config.pollSecret;
}

function compactRun(r) {
  if (!r) return null;
  const s = r.summary;
  const out = { task: r.task, startedAt: r.startedAt, finishedAt: r.finishedAt, ok: r.ok };
  if (r.error) out.error = String(r.error).slice(0, 300);
  if (s) {
    out.counts = {
      found: s.found,
      sent: s.sent,
      skippedNotApplication: s.skippedNotApplication,
      skippedNoDomain: s.skippedNoDomain,
      skippedDuplicate: s.skippedDuplicate,
      failed: s.failed,
    };
    if (s.bounces) out.bounces = { scanned: s.bounces.scanned, newlyBounced: (s.bounces.bounced || []).length, error: s.bounces.error };
  }
  return out;
}

function startBackground(task, fn) {
  running = true;
  runStartedAt = Date.now();
  const startedAt = new Date().toISOString();
  lastRun = { task, startedAt, finishedAt: null, ok: null };
  (async () => {
    try {
      const summary = await fn();
      lastRun = { task, startedAt, finishedAt: new Date().toISOString(), ok: true, summary };
      console.log(`[${task}] done ${JSON.stringify(summary)}`);
    } catch (err) {
      lastRun = { task, startedAt, finishedAt: new Date().toISOString(), ok: false, error: (err && err.message) || String(err) };
      console.error(`[${task}] failed:`, err);
    } finally {
      running = false;
    }
  })();
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    running,
    runningForMs: running ? Date.now() - runStartedAt : 0,
    lastRun: compactRun(lastRun),
    time: new Date().toISOString(),
  });
});

app.get('/last-run', (req, res) => {
  const full = req.query.full === '1' || req.query.full === 'true';
  res.json({ ok: true, running, lastRun: full ? lastRun : compactRun(lastRun) });
});

app.post('/poll', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  if (locked()) return res.status(409).json({ ok: false, error: 'A run is already in progress' });
  const dryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;
  const limit = Number(req.query.limit || req.body?.limit) || undefined;
  startBackground('poll', () => runPoll({ dryRun, limit }));
  res.status(202).json({ ok: true, started: true, task: 'poll' });
});

app.post('/process-bounces', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  if (locked()) return res.status(409).json({ ok: false, error: 'A run is already in progress' });
  const dryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;
  startBackground('process-bounces', () => processBounces({ dryRun }));
  res.status(202).json({ ok: true, started: true, task: 'process-bounces' });
});

app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('unhandled error:', err);
  res.status(500).json({ ok: false, error: (err && err.message ? String(err.message) : String(err)).slice(0, 300) });
});

app.listen(config.port, () => console.log(`job-apply-automation listening on :${config.port}`));
