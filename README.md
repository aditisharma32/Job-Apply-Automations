# job-apply-automation

When a job-application confirmation email lands in your inbox, this works out the
company + role, resolves a likely HR address, sends a short follow-up, and logs
it to a Google Sheet. Independent of `job_mail_autmation`.

```
cron-job.org ──hourly POST /poll──► Node API (Render)
                                      │
                                      ├─ Gmail API: search unread application confirmations
                                      ├─ OpenRouter LLM: email → { company, title, domain, isApplication }
                                      ├─ resolve HR email: hr@<domain>   (MX-checked)
                                      ├─ dedupe against the sheet (one email per company)
                                      ├─ send outreach (Gmail API)
                                      ├─ label the source email "outreach-done"
                                      └─ append a row to the tracking sheet
```

## Honest limits

- **Detection** only works for applications that send a parseable confirmation
  email — LinkedIn (Easy Apply), Greenhouse, Lever, Naukri, Indeed, most ATSes.
  Referrals / direct emails produce nothing to detect.
- **HR address** is a guess: `hr@<domain>`, where `<domain>` is the LLM's guess
  or a slug of the company name, filtered by a DNS MX check. Expect a meaningful
  bounce rate until a real finder API is added (`services/hrResolver.js` is the
  single seam for that).

## Setup

### 1. OAuth (Gmail API)

Reuse the **same** `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` /
`GOOGLE_REFRESH_TOKEN` as `job_mail_autmation` — its token already has the
`gmail.send` + `gmail.modify` scopes this needs (modify = read mail + manage
labels). Otherwise: `npm run google-token`.

### 2. OpenRouter

Key from https://openrouter.ai/keys → `OPENROUTER_API_KEY`. Default model
`google/gemini-2.0-flash-001` (cheap, fast, fine for extraction).

### 3. Tracking sheet

New Google Sheet, header row exactly:

```
Date | Company | Title | Location | Domain | HR Email | Status | Source | Message ID | Notes
```

Extensions → Apps Script → paste `apps-script/Code.gs` → **Deploy → New
deployment → Web app**, *Execute as* Me, *Who has access* Anyone. Put the
`/exec` URL in `SHEET_API`.

### 4. Local run

```bash
npm install
cp .env.example .env       # fill it in
npm run poll -- --dry      # preview: no send, no sheet writes, no labels
npm run poll               # real
npm start                  # API on :3000
```

## Deploy on Render

`render.yaml` → **New → Blueprint**, or a manual Web Service (`npm install` /
`node server.js` / health `/health`). Set the secrets: `EMAIL_USER`,
`GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN`, `OPENROUTER_API_KEY`, `SHEET_API`.
Copy the generated `POLL_SECRET`.

## Scheduling (cron-job.org)

- **Main:** `POST https://<service>.onrender.com/poll`, hourly, header
  `x-poll-secret: <POLL_SECRET>`. Returns `202` immediately; runs in background.
- **Keep-warm:** `GET https://<service>.onrender.com/health` every 10 min, no
  header — stops the free instance sleeping between polls.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET  | `/health` | Liveness + compact `lastRun`. Keep-warm target. |
| GET  | `/last-run` | Compact last-run summary. `?full=1` for everything. |
| POST | `/poll` | Scan + send. Background, `202`. Auth: `x-poll-secret` / `?key=`. Query: `dryRun`, `limit`. |
| POST | `/process-bounces` | Bounce scan only. Same auth. |

## Status values in the sheet

`Sent` · `Bounced` (set by the bounce scan) · `Failed` (send threw) ·
`No domain` (couldn't resolve a domain) · `Replied` (set it yourself).

## Env reference

See `.env.example`. Key knobs: `MAX_PER_POLL`, `POLL_LOOKBACK_DAYS`,
`MIN_CONFIDENCE`, `EXTRA_SENDERS`, `DONE_LABEL`.
