'use strict';

// Works out an address to contact for a company:
//   1. First tries real email finder APIs (Hunter.io, Apollo.io, or Tomba.io) if configured
//      to find an actual Technical Recruiter / Talent Acquisition person.
//   2. If a recruiter is found, returns their real email and first name.
//   3. Falls back to smart applicant prefix (e.g., careers@<domain> or hr@<domain>)
//      only if FALLBACK_TO_GUESS is enabled.
const config = require('../config');
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
 * Searches Hunter.io for a recruiter/talent contact at the domain.
 */
async function searchHunter(domain) {
  if (!config.finder.hunterApiKey) return null;
  try {
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&department=human_resources&api_key=${config.finder.hunterApiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json();
    const emails = json?.data?.emails || [];

    if (!emails.length) {
      const genUrl = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${config.finder.hunterApiKey}&limit=10`;
      const genRes = await fetch(genUrl, { signal: AbortSignal.timeout(8000) });
      if (genRes.ok) {
        const genJson = await genRes.json();
        const genEmails = genJson?.data?.emails || [];
        const recruiter = genEmails.find((e) =>
          /recruit|talent|hire|hiring|hr|people|talent acquisition/i.test(e.position || '')
        );
        if (recruiter && recruiter.value) {
          return {
            email: recruiter.value,
            name: recruiter.first_name || null,
            position: recruiter.position || 'Recruiting',
          };
        }
      }
      return null;
    }

    const best =
      emails.find((e) => /recruit|talent|hire|hiring/i.test(e.position || '')) ||
      emails[0];
    if (best && best.value) {
      return {
        email: best.value,
        name: best.first_name || null,
        position: best.position || 'HR',
      };
    }
  } catch (err) {
    console.warn(`[finder] Hunter lookup error for ${domain}:`, err.message);
  }
  return null;
}

/**
 * Searches Apollo.io for a recruiter/talent contact at the domain.
 */
async function searchApollo(domain) {
  if (!config.finder.apolloApiKey) return null;
  try {
    const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify({
        api_key: config.finder.apolloApiKey,
        q_organization_domains: domain,
        person_titles: ['Technical Recruiter', 'Recruiter', 'Talent Acquisition', 'HR Specialist', 'Head of People'],
        page: 1,
        per_page: 3,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const people = json?.people || [];
    const withEmail = people.find((p) => p.email && !p.email_status?.includes('invalid'));
    if (withEmail) {
      return {
        email: withEmail.email,
        name: withEmail.first_name || null,
        position: withEmail.title || 'Recruiter',
      };
    }
  } catch (err) {
    console.warn(`[finder] Apollo lookup error for ${domain}:`, err.message);
  }
  return null;
}

/**
 * Searches Tomba.io for a recruiter/talent contact at the domain.
 */
async function searchTomba(domain) {
  if (!config.finder.tombaKey || !config.finder.tombaSecret) return null;
  try {
    const url = `https://api.tomba.io/v1/domain-search?domain=${encodeURIComponent(domain)}&department=human_resources`;
    const res = await fetch(url, {
      headers: {
        'X-Tomba-Key': config.finder.tombaKey,
        'X-Tomba-Secret': config.finder.tombaSecret,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const emails = json?.data?.emails || [];
    const best =
      emails.find((e) => /recruit|talent|hire|hiring/i.test(e.position || '')) ||
      emails[0];
    if (best && best.email) {
      return {
        email: best.email,
        name: best.first_name || null,
        position: best.position || 'Talent Acquisition',
      };
    }
  } catch (err) {
    console.warn(`[finder] Tomba lookup error for ${domain}:`, err.message);
  }
  return null;
}

/**
 * @returns {Promise<{ email: string|null, domain: string|null, name: string|null, method: string }>}
 */
async function resolveHrEmail({ company, companyDomain }) {
  const domain = await pickDomain(company, companyDomain);
  if (!domain) return { email: null, domain: null, name: null, method: 'no-domain' };

  // 1. Try Hunter.io API
  const hunterMatch = await searchHunter(domain);
  if (hunterMatch) {
    return {
      email: hunterMatch.email,
      domain,
      name: hunterMatch.name,
      method: `hunter: ${hunterMatch.position}`,
    };
  }

  // 2. Try Apollo.io API
  const apolloMatch = await searchApollo(domain);
  if (apolloMatch) {
    return {
      email: apolloMatch.email,
      domain,
      name: apolloMatch.name,
      method: `apollo: ${apolloMatch.position}`,
    };
  }

  // 3. Try Tomba.io API
  const tombaMatch = await searchTomba(domain);
  if (tombaMatch) {
    return {
      email: tombaMatch.email,
      domain,
      name: tombaMatch.name,
      method: `tomba: ${tombaMatch.position}`,
    };
  }

  // 4. Fallback to applicant-facing address (default: careers@<domain>)
  if (config.finder.fallbackToGuess) {
    const prefix = config.finder.defaultPrefix || 'careers';
    return {
      email: `${prefix}@${domain}`,
      domain,
      name: null,
      method: companyDomain === domain ? `llm-${prefix}` : `guessed-${prefix}`,
    };
  }

  return { email: null, domain, name: null, method: 'no-verified-contact' };
}

module.exports = { resolveHrEmail, slugCompany };
