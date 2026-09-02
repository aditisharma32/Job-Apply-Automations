'use strict';

/**
 * One-time helper: get a Gmail API refresh token for MAIL_TRANSPORT=gmail_api,
 * using a **Desktop** OAuth client via the localhost loopback flow.
 *
 *   1. Google Cloud Console → APIs & Services → enable "Gmail API".
 *   2. OAuth consent screen → External → PUBLISH it (else the refresh token
 *      expires after 7 days). Add your sending Gmail as a test user is not
 *      enough — publish.
 *   3. Credentials → Create credentials → OAuth client ID → Desktop app.
 *      Put its id/secret in .env as GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
 *   4. npm run google-token
 *   5. Open the printed URL, sign in as the SENDING Gmail account, click
 *      through the "unverified app" warning, Allow.
 *   6. Copy GOOGLE_REFRESH_TOKEN into .env and the Render env vars.
 */
const http = require('http');
const crypto = require('crypto');
require('dotenv').config();

const CLIENT_ID = process.argv[2] || process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.argv[3] || process.env.GOOGLE_CLIENT_SECRET;
const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
].join(' ');

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first (from your Desktop OAuth client).');
  process.exit(1);
}

const state = crypto.randomBytes(16).toString('hex');
const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  }).toString();

async function exchange(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (!url.searchParams.get('code') && !url.searchParams.get('error')) {
    res.writeHead(404).end();
    return;
  }
  const err = url.searchParams.get('error');
  if (err) {
    res.writeHead(400, { 'content-type': 'text/plain' }).end(`OAuth error: ${err}`);
    console.error('OAuth error:', err);
    server.close();
    process.exit(1);
  }
  if (url.searchParams.get('state') !== state) {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('state mismatch');
    server.close();
    process.exit(1);
  }
  try {
    const tokens = await exchange(url.searchParams.get('code'));
    res.writeHead(200, { 'content-type': 'text/html' }).end(
      '<h2>Done. You can close this tab and return to the terminal.</h2>'
    );
    console.log('\n=== SUCCESS ===');
    console.log('scope :', tokens.scope);
    console.log('\nGOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);
    if (!tokens.refresh_token) {
      console.log('\n(no refresh_token returned - revoke access at https://myaccount.google.com/permissions and rerun)');
    }
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end(String(e.message));
    console.error(e.message);
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 200);
  }
});

server.listen(PORT, () => {
  console.log('Open this URL in your browser (signed in as the SENDING Gmail account):\n');
  console.log(authUrl + '\n');
  console.log(`Waiting for the redirect on ${REDIRECT_URI} ...`);
});
