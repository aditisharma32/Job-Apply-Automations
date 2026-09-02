'use strict';

// Works out an address to contact for a company. Strategy for now:
//   1. domain = LLM's companyDomain, else a slug guess from the company name
//   2. address = hr@<domain>
// Deliberately a single small function so a real finder (Hunter / Apollo /
// Snov) can be slotted in later without touching the poller.
const { hasMx } = require('./verifyDomain');

const GENERIC_TLDS = ['com', 'io', 'co', 'ai', 'in', 'net', 'org'];

function slugCompany(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|inc|llc|llp|technologies|technology|solutions|labs|software|systems|global|india|group|corp|corporation|company|co)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

async function pickDomain(company, llmDomain) {
  if (llmDomain && (await hasMx(llmDomain))) return llmDomain;

  const slug = slugCompany(company);
  if (!slug) return llmDomain || null;

  for (const tld of GENERIC_TLDS) {
    const cand = `${slug}.${tld}`;
    // eslint-disable-next-line no-await-in-loop
    if (await hasMx(cand)) return cand;
  }
  return llmDomain || null;
}

/**
 * @returns {Promise<{ email: string|null, domain: string|null, method: string }>}
 */
async function resolveHrEmail({ company, companyDomain }) {
  const domain = await pickDomain(company, companyDomain);
  if (!domain) return { email: null, domain: null, method: 'no-domain' };
  return { email: `hr@${domain}`, domain, method: companyDomain === domain ? 'llm-domain' : 'guessed-domain' };
}

module.exports = { resolveHrEmail, slugCompany };
