'use strict';

require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing required env var: ${name}`);
  return String(v).trim();
}
function opt(name, fallback = '') {
  const v = process.env[name];
  return v == null || v === '' ? fallback : String(v).trim();
}
function bool(name, fallback = false) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}
function int(name, fallback) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) ? n : fallback;
}
function num(name, fallback) {
  const n = Number.parseFloat(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

// Normalize a service-account style key if one is ever used; here it just
// passes the refresh token through.
const config = {
  port: int('PORT', 3000),
  pollSecret: opt('POLL_SECRET'),
  dryRun: bool('DRY_RUN', false),

  gmail: {
    user: required('EMAIL_USER'),
    fromName: opt('EMAIL_FROM_NAME'),
    replyTo: opt('EMAIL_REPLY_TO'),
  },

  // Same OAuth client as job_mail_autmation is fine — the refresh token needs
  // scopes gmail.send + gmail.modify (modify covers reading mail + labels).
  google: {
    clientId: required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
    refreshToken: required('GOOGLE_REFRESH_TOKEN'),
  },

  openrouter: {
    apiKey: required('OPENROUTER_API_KEY'),
    model: opt('OPENROUTER_MODEL', 'google/gemini-2.5-flash'),
    baseUrl: opt('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
    timeoutMs: int('OPENROUTER_TIMEOUT_MS', 30000),
    maxTokens: int('OPENROUTER_MAX_TOKENS', 400),
  },

  sheet: {
    apiUrl: required('SHEET_API'), // Apps Script /exec for the NEW tracking sheet
    token: opt('SHEET_API_TOKEN'),
  },

  poll: {
    lookbackDays: int('POLL_LOOKBACK_DAYS', 2),
    maxPerPoll: int('MAX_PER_POLL', 10),
    sendDelayMs: int('SEND_DELAY_MS', 2000),
    minConfidence: num('MIN_CONFIDENCE', 0.6),
    // Gmail label applied to every processed email so it is never handled twice.
    doneLabel: opt('DONE_LABEL', 'outreach-done'),
    // Extra from:/subject: filters, comma-separated, merged into the search.
    extraSenders: opt('EXTRA_SENDERS', ''),
    processBounces: bool('PROCESS_BOUNCES', true),
    bounceLookbackDays: int('BOUNCE_LOOKBACK_DAYS', 3),
  },

  finder: {
    hunterApiKey: opt('HUNTER_API_KEY'),
    apolloApiKey: opt('APOLLO_API_KEY'),
    fallbackToGuess: bool('FALLBACK_TO_GUESS', true),
  },

  subjectTemplate:
    opt('EMAIL_SUBJECT', 'Following up on my application for {{title}} at {{company}}'),
};

module.exports = config;
