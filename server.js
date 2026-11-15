
import 'dotenv/config';
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startSignalWorker } from './src/signal_worker.js';

import {
  validateOracleSignal,
  trimSeenSignals
} from './src/signal_rules.js';

import {
  DEFAULTS,
  rankJobs,
  rankShifts
} from './src/rules.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

const id = env.RECEIVER_ID || 'receiver-01';

const keys = path.resolve(
  dir,
  env.KEYS_DIR || '../AmazonJobsKeys'
);

if (!/^receiver-0[1-5]$/.test(id)) {
  throw Error(
    'Receiver ID must be receiver-01 through receiver-05'
  );
}

const credential = fs.readFileSync(
  path.join(
    keys,
    'receiver-keys',
    `${id}.key`
  ),
  'utf8'
).trim();

const stateDir = path.join(dir, '.runtime');

fs.mkdirSync(stateDir, {
  recursive: true,
  mode: 0o700
});

const stateFile = path.join(
  stateDir,
  `${id}.json`
);

let store = {
  pending: [],
  seen: [],
  completed: [],
  audit: []
};

try {
  store = {
    ...store,
    ...JSON.parse(
      fs.readFileSync(stateFile, 'utf8')
    )
  };
} catch {}

function save() {
  const t = stateFile + '.tmp';

  fs.writeFileSync(
    t,
    JSON.stringify(store),
    { mode: 0o600 }
  );

  fs.renameSync(t, stateFile);
}

const state = {
  id,
  browser: 'starting',
  socket: 'not_started',
  phase: 'idle',
  lastSignal: null,
  lastError: null,
  lastSnapshot: null,
  lastAction: null
};

let browser;
let page;
let worker;
let busy = false;
let activeSignal = null;
let lastSnapshot = null;

const options = {
  ...DEFAULTS,
  maxMiles: Number(env.MAX_MILES || 10),
  box1: {
    keywords: (env.KEYWORDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    mode: 'priority'
  },
  shifts: {
    ...DEFAULTS.shifts,
    minHours: env.MIN_SHIFT_HOURS || null,
    maxHours: env.MAX_SHIFT_HOURS || null,
    days: env.SHIFT_DAYS
      ? Number(env.SHIFT_DAYS)
      : 5
  }
};

function audit(action, details = {}) {
  store.audit.push({
    action,
    details,
    at: new Date().toISOString()
  });

  store.audit = store.audit.slice(-300);

  save();
}

function persistSignal(signal) {
  const valid = validateOracleSignal(signal);

  if (!valid) {
    return { ok: false };
  }

  store.seen = trimSeenSignals(store.seen);

  if (
    store.seen.some(
      x => x.id === valid.event_id
    )
  ) {
    return {
      ok: true,
      duplicate: true
    };
  }

  if (store.pending.length >= 40) {
    return {
      ok: false,
      error: 'Queue full'
    };
  }

  store.pending.push(valid);

  store.seen.push({
    id: valid.event_id,
    at: Date.now()
  });

  save();

  state.lastSignal = {
    id: valid.event_id,
    jobId: valid.job_id
  };

  audit('signal_durably_queued', {
    signalId: valid.event_id
  });

  queueMicrotask(processNext);

  return { ok: true };
}

async function message(message) {
  return page.evaluate(
    m =>
      new Promise((resolve, reject) => {
        const cb =
          globalThis.__receiverAdapterListener;

        if (!cb) {
          return reject(
            Error('Adapter unavailable')
          );
        }

        let done = false;

        cb(m, null, r => {
          if (!done) {
            done = true;
            resolve(r);
          }
        });

        setTimeout(() => {
          if (!done) {
            done = true;
            reject(
              Error('Adapter reply timeout')
            );
          }
        }, 5000);
      }),
    message
  );
}

async function click(id, label) {
  if (!id) return false;

  const r = await message({
    type: 'CLICK',
    generation: 1,
    id,
    label: label || ''
  });

  state.lastAction = {
    id,
    ok: r?.ok,
    at: new Date().toISOString()
  };

  return r?.ok === true;
}

async function onSnapshot(snapshot) {
  lastSnapshot = snapshot;

  state.lastSnapshot = {
    isSearch: snapshot.isSearch,
    jobCards: snapshot.jobCards?.length,
    shiftCards: snapshot.shiftCards?.length,
    securityBlocked: snapshot.securityBlocked,
    loginRequired: snapshot.loginRequired,
    publicJobSearch: snapshot.publicJobSearch,
    at: new Date().toISOString()
  };

  if (
    snapshot.securityBlocked ||
    snapshot.loginRequired
  ) {
    state.phase = 'paused_human_action';

    audit('manual_intervention_required', {
      security: snapshot.securityBlocked,
      login: snapshot.loginRequired
    });

    return;
  }

  if (!activeSignal) return;

  if (snapshot.isSearch) {
    state.phase = 'search_results';

    if (env.AUTO_SELECT_JOB !== 'true') {
      return;
    }

    const ranked = rankJobs(
      snapshot.jobCards || [],
      options
    ).filter(
      c =>
        c.key &&
        !store.completed.includes(c.key)
    );

    const wanted =
      activeSignal.job_id?.toLowerCase();

    const match = ranked.find(
      c =>
        wanted &&
        c.key.toLowerCase().includes(wanted)
    );

    if (!match) return;

    state.phase = 'selecting_job';

    if (
      await click(
        match.id,
        match.title
      )
    ) {
      audit('job_selected', {
        key: match.key
      });
    }
  } else if (snapshot.step2) {
    state.phase = 'shift_selection';

    if (env.AUTO_SELECT_SHIFT !== 'true') {
      return;
    }

    const ranked = rankShifts(
      snapshot.shiftCards || [],
      options.shifts
    );

    if (ranked.length) {
      if (
        await click(
          ranked[0].id,
          ranked[0].text?.slice(0, 80)
        )
      ) {
        audit('shift_selected', {
          key: ranked[0].key
        });

        state.phase =
          'manual_completion_required';
      }
    }
  } else if (
    snapshot.prehire ||
    snapshot.buttons?.acceptOffer ||
    snapshot.buttons?.start ||
    snapshot.buttons?.agree
  ) {
    state.phase =
      'manual_completion_required';

    audit('application_requires_review');
  } else if (
    snapshot.noShifts ||
    snapshot.noShiftPage
  ) {
    state.phase = 'no_shifts';

    activeSignal = null;

    queueMicrotask(processNext);
  }
}

async function onPageMessage(msg) {
  if (msg?.type === 'OBSERVATION') {
    await onSnapshot(msg.snapshot);

    return { ok: true };
  }

  if (msg?.type === 'WATCH_TICK') {
    return { ok: true };
  }

  return { ok: true };
}

async function navigate() {
  await page.goto(
    env.SEARCH_URL || DEFAULTS.searchUrl,
    {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    }
  );

  await page.addScriptTag({
    path: path.join(
      dir,
      'src/adapter.js'
    )
  });

  await message({
    type: 'ENABLE',
    generation: 1
  });
}

async function processNext() {
  if (
    busy ||
    !page ||
    activeSignal ||
    !store.pending.length
  ) {
    return;
  }

  busy = true;

  try {
    activeSignal = store.pending.shift();

    save();

    state.phase = 'processing_signal';

    audit('signal_processing', {
      id: activeSignal.event_id
    });

    await navigate();

    await message({
      type: 'SCAN'
    });
  } catch (e) {
    state.lastError = e.message;
    state.phase = 'error';
    activeSignal = null;
  } finally {
    busy = false;
  }
}

const port = Number(env.PORT || 5003);
const host = env.BIND_HOST || '127.0.0.1';

const server = http.createServer(
  (req, res) => {
    if (
      !['/health', '/status'].includes(
        req.url
      )
    ) {
      res.writeHead(404).end();
      return;
    }

    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }).end(
      JSON.stringify({
        ...state,
        queue: store.pending.length,
        activeSignal:
          activeSignal?.event_id || null
      })
    );
  }
);

async function main() {
  const userDataDir = path.resolve(
    dir,
    env.PROFILE_DIR || '.browser-profile'
  );

  fs.mkdirSync(userDataDir, {
    recursive: true,
    mode: 0o700
  });

  state.profileDir = userDataDir;

  browser = await chromium.launchPersistentContext(
    userDataDir,
    {
      headless: env.HEADLESS === 'true',
      args:
        env.CHROMIUM_NO_SANDBOX === 'true'
          ? ['--no-sandbox']
          : [],
      ...(env.CHROME_CHANNEL
        ? { channel: env.CHROME_CHANNEL }
        : {})
    }
  );

  page =
    browser.pages()[0] ||
    await browser.newPage();

  await page.exposeBinding(
    '__nodeReceiverMessage',
    (_, msg) => onPageMessage(msg)
  );

  await browser.addInitScript(() => {
    globalThis.chrome = {
      runtime: {
        id: 'node-receiver',
        sendMessage: m =>
          globalThis.__nodeReceiverMessage(m),
        onMessage: {
          addListener(cb) {
            globalThis.__receiverAdapterListener = cb;
          }
        }
      }
    };
  });

  await navigate();

  state.browser = 'running';

  worker = startSignalWorker({
    config: {
      endpoint:
        env.ORACLE_WS_URL ||
        'wss://145-241-233-33.sslip.io/v1/receivers/ws',
      receiverId: id,
      credential
    },
    persistSignal,
    onStatus: s => {
      state.socket = s.state;

      if (s.error) {
        state.socketError = s.error;
      }
    }
  });

  processNext();
}

server.listen(port, host, () => {
  console.log(
    `Receiver health http://${host}:${port}/health`
  );
});

main().catch(e => {
  state.lastError = e.message;
  console.error(e);
  process.exitCode = 1;
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    worker?.stop();
    save();
    server.close();
    await browser?.close();
    process.exit(0);
  });
}
