/**
 * Scheduler for job-apply-automation — runs inside your Gmail account, so no
 * cron-job.org / Pub/Sub needed. It POSTs to the Render /poll endpoint on a
 * time-driven trigger; the app then scans new application emails and sends.
 *
 * A ping every ~10 min also keeps the free Render instance from sleeping, so no
 * separate keep-warm job is needed.
 *
 * SETUP
 *   1. New standalone Apps Script project (script.google.com → New project) OR
 *      a separate .gs file in any project bound to the SAME Google account.
 *   2. Paste this file. Set SERVICE_URL and POLL_SECRET below.
 *   3. Run `pingPoll` once manually → authorize when prompted.
 *   4. Triggers (clock icon) → Add trigger:
 *        function: pingPoll
 *        event source: Time-driven
 *        type: Minutes timer → Every 10 minutes
 *   5. Check Executions to confirm it returns 202.
 */
var SERVICE_URL = 'https://YOUR-SERVICE.onrender.com';
var POLL_SECRET = 'YOUR_POLL_SECRET';

function pingPoll() {
  var res = UrlFetchApp.fetch(SERVICE_URL + '/poll', {
    method: 'post',
    headers: { 'x-poll-secret': POLL_SECRET },
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  // 202 = started, 409 = a run is already in progress (both fine)
  if (code !== 202 && code !== 409) {
    console.warn('pingPoll unexpected ' + code + ': ' + res.getContentText().slice(0, 300));
  }
}

/** Optional: run this once to see the most recent run's summary in the logs. */
function checkLastRun() {
  var res = UrlFetchApp.fetch(SERVICE_URL + '/last-run', {
    headers: { 'x-poll-secret': POLL_SECRET },
    muteHttpExceptions: true,
  });
  console.log(res.getContentText());
}
