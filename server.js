
import 'dotenv/config';

import WebSocket from 'ws';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

const PORT = Number(env.PORT || 5003);
const HOST = env.BIND_HOST || '127.0.0.1';

const DETECTOR_URL =
  env.DETECTOR_URL || 'http://127.0.0.1:5002';

const DETECTOR_WS_URL =
  env.DETECTOR_WS_URL || 'ws://127.0.0.1:8080';

const RECONNECT_MS = Number(env.RECONNECT_MS || 5000);
const HEALTH_CHECK_MS = Number(env.HEALTH_CHECK_MS || 30000);
const MAX_PENDING = Number(env.MAX_PENDING || 2000);

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
    throw new Error(
      `Receiver state could not be loaded: ${error.message}`
    );
  }
}

const seen = new Set(store.seen.map(String));

const state = {
  service: 'amazon-receiver',
  startedAt: new Date().toISOString(),
  phase: 'starting',
  socket: 'disconnected',
  detector: 'unknown',
  lastEvent: null,
  lastJob: null,
  lastError: null,
  lastHealthCheck: null,
  lastConnectedAt: null,
  receivedEvents: 0,
  newJobs: 0
};

let socket = null;
let reconnectTimer = null;
let stopping = false;

function log(event, details = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: 'amazon-receiver',
    event,
    ...details
  }));
}

function save() {
  store.seen = [...seen];

  const temp = DATA_FILE + '.tmp';

  fs.writeFileSync(
    temp,
    JSON.stringify(store, null, 2),
    { mode: 0o600 }
  );

  fs.renameSync(temp, DATA_FILE);
}

function jobKey(job) {
  const id = String(job?.jobId || '').trim();
  return id || null;
}

function matchesFilters(job) {
  const keywords = (env.KEYWORDS || '')
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);

  if (!keywords.length) return true;

  const content = [
    job.title,
    job.location,
    job.postcode,
    job.shiftDetails,
    job.shifts
  ].filter(Boolean).join(' ').toLowerCase();

  return keywords.some(word => content.includes(word));
}

function processJob(job) {
  const key = jobKey(job);

  if (!key || !job.title) {
    log('invalid_job_ignored');
    return;
  }

  if (seen.has(key)) return;

  const accepted = matchesFilters(job);

  if (accepted && store.pending.length >= MAX_PENDING) {
    state.lastError = 'Pending queue is full';
    log('queue_full', { jobId: key });
    return;
  }

  seen.add(key);

  if (!accepted) {
    log('job_filtered', {
      jobId: key,
      title: job.title
    });
    save();
    return;
  }

  const record = {
    ...job,
    receivedAt: new Date().toISOString(),
    status: 'new'
  };

  store.pending.push(record);

  store.history.push({
    jobId: key,
    event: 'NEW_UK_JOB',
    timestamp: record.receivedAt
  });

  store.history = store.history.slice(-5000);

  // Save before announcing successful processing.
  save();

  state.newJobs++;

  state.lastJob = {
    jobId: job.jobId,
    title: job.title,
    location: job.location
  };

  log('new_job_received', {
    jobId: job.jobId,
    title: job.title,
    location: job.location,
    pending: store.pending.length
  });
}

function handleMessage(data) {
  let message;

  try {
    message = JSON.parse(data.toString());
  } catch {
    log('invalid_json_message');
    return;
  }

  state.receivedEvents++;
  state.lastEvent = new Date().toISOString();

  if (message.event === 'DETECTOR_CONNECTED') {
    log('detector_handshake_received');
    return;
  }

  if (message.event !== 'NEW_UK_JOB') return;

  try {
    processJob(message.job);
  } catch (error) {
    state.lastError = error.message;

    log('job_processing_failed', {
      error: error.message
    });
  }
}

function scheduleReconnect() {
  if (stopping || reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectDetector();
  }, RECONNECT_MS);
}

function connectDetector() {
  if (stopping) return;

  if (socket &&
      (socket.readyState === WebSocket.OPEN ||
       socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  state.socket = 'connecting';

  log('connecting', {
    endpoint: DETECTOR_WS_URL
  });

  socket = new WebSocket(DETECTOR_WS_URL, {
    handshakeTimeout: 10000,
    maxPayload: 1024 * 1024
  });

  socket.on('open', () => {
    state.socket = 'connected';
    state.phase = 'monitoring';
    state.lastConnectedAt = new Date().toISOString();
    state.lastError = null;

    log('websocket_connected');
  });

  socket.on('message', handleMessage);

  socket.on('error', error => {
    state.lastError = error.message;

    log('websocket_error', {
      error: error.message
    });
  });

  socket.on('close', (code, reason) => {
    state.socket = 'disconnected';
    state.phase = 'waiting_for_detector';

    log('websocket_closed', {
      code,
      reason: reason.toString()
    });

    socket = null;
    scheduleReconnect();
  });
}

async function fetchDetectorHealth() {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    10000
  );

  try {
    const response = await fetch(
      `${DETECTOR_URL.replace(/\/$/, '')}/health`,
      {
        signal: controller.signal,
        headers: {
          Accept: 'application/json'
        }
      }
    );

    const data = await response.json();

    state.detector =
      data.state ||
      data.browser ||
      'unknown';

    state.lastHealthCheck =
      new Date().toISOString();

    if (data.paused) {
      state.phase = 'paused_detector_restricted';
    } else if (state.socket === 'connected') {
      state.phase = 'monitoring';
    }

    log('detector_health', {
      httpStatus: response.status,
      detectorState: state.detector,
      paused: data.paused || false
    });

  } catch (error) {
    state.detector = 'unavailable';

    log('detector_health_failed', {
      error: error.message
    });
  } finally {
    clearTimeout(timeout);
  }
}

// HTTP health/status API
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
      seenJobs: seen.size,
      uptimeSeconds: Math.floor(process.uptime())
    }));
    return;
  }

  if (url.pathname === '/jobs') {
    const rawLimit = Number(
      url.searchParams.get('limit') || 100
    );

    const limit = Number.isFinite(rawLimit)
      ? Math.min(500, Math.max(1, Math.floor(rawLimit)))
      : 100;

    res.writeHead(200);

    res.end(JSON.stringify({
      total: store.pending.length,
      jobs: store.pending.slice(-limit).reverse()
    }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, HOST, () => {
  log('receiver_started', {
    host: HOST,
    port: PORT,
    detector: DETECTOR_WS_URL
  });
});

connectDetector();

void fetchDetectorHealth();

const healthTimer = setInterval(() => {
  void fetchDetectorHealth();
}, HEALTH_CHECK_MS);

async function shutdown() {
  if (stopping) return;
  stopping = true;

  clearTimeout(reconnectTimer);
  clearInterval(healthTimer);

  if (socket) {
    socket.removeAllListeners('close');
    socket.terminate();
    socket = null;
  }

  save();

  server.close(() => {
    process.exit(0);
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

