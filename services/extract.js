'use strict';

// Uses an OpenRouter LLM to turn a job-application confirmation email into
// structured fields. Formats vary wildly across LinkedIn / Greenhouse / Lever /
// Naukri / company ATSes, so a model handles it far better than regex.
const config = require('../config');

const SYSTEM = `You classify and extract data from a single email.
Decide if it is a confirmation that the reader (the job seeker) has just APPLIED to a job
(e.g. "your application was sent to X", "we received your application", "thanks for applying").
Auto-rejections, interview invites, newsletters, job alerts and recruiter outreach are NOT this.

Return ONLY compact JSON, no prose, with exactly these keys:
{
  "isJobApplication": boolean,
  "company": string|null,          // the hiring company, not the ATS/job board
  "jobTitle": string|null,
  "location": string|null,
  "companyDomain": string|null,    // best guess of the company's primary website domain, e.g. "acme.io"; null if unsure
  "confidence": number             // 0..1, your confidence in isJobApplication + company
}`;

async function extractFromEmail({ subject, from, text }) {
  const body = String(text || '').replace(/\s+\n/g, '\n').slice(0, 6000);
  const userMsg = `From: ${from || ''}\nSubject: ${subject || ''}\n\n${body}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.openrouter.timeoutMs);
  let res;
  try {
    res = await fetch(`${config.openrouter.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.openrouter.apiKey}`,
        'content-type': 'application/json',
        'HTTP-Referer': 'https://github.com/job-apply-automation',
        'X-Title': 'job-apply-automation',
      },
      body: JSON.stringify({
        model: config.openrouter.model,
        temperature: 0,
        // The reply is a tiny JSON object; without this OpenRouter reserves the
        // model's full output budget and a low-credit account gets a 402.
        max_tokens: config.openrouter.maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userMsg },
        ],
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error(`OpenRouter timed out after ${config.openrouter.timeoutMs}ms`);
    throw err;
  }
  clearTimeout(timer);

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${(data.error && data.error.message) || JSON.stringify(data).slice(0, 200)}`);
  }
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('OpenRouter returned no content');

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`OpenRouter returned non-JSON: ${content.slice(0, 200)}`);
    parsed = JSON.parse(m[0]);
  }

  return {
    isJobApplication: !!parsed.isJobApplication,
    company: parsed.company ? String(parsed.company).trim() : null,
    jobTitle: parsed.jobTitle ? String(parsed.jobTitle).trim() : null,
    location: parsed.location ? String(parsed.location).trim() : null,
    companyDomain: parsed.companyDomain ? String(parsed.companyDomain).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null,
    confidence: Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
  };
}

module.exports = { extractFromEmail };
