
import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

const PORT = Number(env.PORT || 5003);
const HOST = env.BIND_HOST || '127.0.0.1';

const DETECTOR_URL = (
  env.DETECTOR_URL || 'http://127.0.0.1:5002'
).replace(/\/$/, '');

const POLL_INTERVAL = Math.max(
  60000,
  Number(env.POLL_INTERVAL_MS || 90000)
);

const DATA_DIR = path.join(dir, '.runtime');
const DATA_FILE = path.join(DATA_DIR, 'public-receiver.json');

fs.mkdirSync(DATA_DIR, {
  recursive: true,
  mode: 0o700
});

let store = {
  seen: [],
  pending: [],
  history: []
};

try {
  store = {
    ...store,
    ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  };
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.error('State load failed:', error.message);
  }
}

const state = {
  service: 'amazon-receiver',
  startedAt: new Date().toISOString(),
  phase: 'starting',
  detector: 'unknown',
  lastPoll: null,
  lastError: null,
  lastNewJobs: 0,
  lastJob: null,
  nextPoll: null
};

let timer;
let stopping = false;
let busy = false;

function log(event, details = {}) {
  console.log(JSON.stringify({
    time: new Date().toISOString(),
    service: 'receiver',
    event,
    ...details
  }));
}

function save() {
  const temp = DATA_FILE + '.tmp';

  fs.writeFileSync(
    temp,
    JSON.stringify(store, null, 2),
    { mode: 0o600 }
  );

  fs.renameSync(temp, DATA_FILE);
}

function jobKey(job) {
  return String(
    job.jobId ||
    job.url ||
    `${job.title}|${job.location}`
  );
}

function matchesFilters(job) {
  const keywords = (env.KEYWORDS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  if (!keywords.length) return true;

  const searchable = [
    job.title,
    job.location
  ].join(' ').toLowerCase();

  return keywords.some(word =>
    searchable.includes(word)
  );
}

async function fetchJSON(url) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    10000
  );

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        `Detector HTTP ${response.status}`
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function processJob(job) {
  const key = jobKey(job);

  if (!key || key === 'undefined') return false;
  if (store.seen.includes(key)) return false;

  store.seen.push(key);

  if (!matchesFilters(job)) return false;

  const record = {
    ...job,
    receiverDetectedAt: new Date().toISOString(),
    status: 'new'
  };

  store.pending.push(record);
  store.history.push({
    key,
    action: 'public_job_discovered',
    at: record.receiverDetectedAt
  });

  state.lastJob = {
    jobId: record.jobId,
    title: record.title,
    location: record.location
  };

  log('new_public_job', {
    jobId: record.jobId,
    title: record.title,
    location: record.location,
    url: record.url
  });

  return true;
}

async function pollDetector() {
  if (stopping || busy) return;

  busy = true;

  try {
    const health = await fetchJSON(
      `${DETECTOR_URL}/health`
    );

    state.detector = health.browser;

    if (
      health.paused ||
      health.security === 'access_restricted'
    ) {
      state.phase = 'paused_detector_restricted';
      state.lastError = 'Detector access restricted';

      log('detector_restricted');
      return;
    }

    if (!health.lastScan) {
      state.phase = 'waiting_for_detector';
      return;
    }

    const result = await fetchJSON(
      `${DETECTOR_URL}/jobs?limit=500`
    );

    const incoming = Array.isArray(result.jobs)
      ? result.jobs
      : [];

    let added = 0;

    for (const job of incoming) {
      if (processJob(job)) added++;
    }

    // Keep state files bounded.
    store.seen = store.seen.slice(-10000);
    store.pending = store.pending.slice(-2000);
    store.history = store.history.slice(-2000);

    save();

    state.phase = 'monitoring';
    state.lastPoll = new Date().toISOString();
    state.lastNewJobs = added;
    state.lastError = null;

    log('poll_completed', {
      received: incoming.length,
      added,
      pending: store.pending.length
    });

  } catch (error) {
    state.phase = 'error';
    state.detector = 'unavailable';
    state.lastError = error.message;

    log('poll_failed', {
      error: error.message
    });

  } finally {
    busy = false;
    scheduleNext();
  }
}

function scheduleNext() {
  if (stopping) return;

  clearTimeout(timer);

  state.nextPoll = new Date(
    Date.now() + POLL_INTERVAL
  ).toISOString();

  timer = setTimeout(
    pollDetector,
    POLL_INTERVAL
  );
}

const server = http.createServer((req, res) => {
  const url = new URL(
    req.url,
    `http://${HOST}:${PORT}`
  );

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (
    url.pathname === '/health' ||
    url.pathname === '/status'
  ) {
    res.writeHead(200);
    res.end(JSON.stringify({
      ...state,
      pendingJobs: store.pending.length,
      seenJobs: store.seen.length
    }));
    return;
  }

  if (url.pathname === '/jobs') {
    const limit = Math.min(
      500,
      Math.max(
        1,
        Number(url.searchParams.get('limit') || 100)
      )
    );

    res.writeHead(200);
    res.end(JSON.stringify({
      total: store.pending.length,
      jobs: store.pending.slice(-limit).reverse()
    }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({
    error: 'Not found'
  }));
});

server.listen(PORT, HOST, () => {
  log('receiver_started', {
    host: HOST,
    port: PORT,
    detector: DETECTOR_URL
  });
});

pollDetector();

function shutdown() {
  stopping = true;
  clearTimeout(timer);
  save();

  server.close(() => {
    process.exit(0);
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
