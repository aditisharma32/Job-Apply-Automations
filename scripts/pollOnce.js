'use strict';

// Local run:  npm run poll            (real: sends + writes sheet + labels)
//             npm run poll -- --dry   (preview only)
const { runPoll } = require('../services/poller');

const dryRun =
  process.argv.includes('--dry') ||
  process.argv.includes('--dry-run') ||
  ['1', 'true', 'yes'].includes(String(process.env.DRY_RUN || '').toLowerCase());

runPoll({ dryRun })
  .then((s) => { console.log(JSON.stringify(s, null, 2)); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
