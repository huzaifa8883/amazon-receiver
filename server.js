
import 'dotenv/config';

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { WebSocketServer, WebSocket } from 'ws';
import { startAutoApplyWorker } from './auto-apply-worker.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const E = process.env;

const CONFIG = {
  host: '127.0.0.1',

  httpPort: Number(E.RECEIVER_PORT || 5003),

  // Separate from the old Detector's port 8082.
  wsPort: Number(E.RECEIVER_WS_PORT || 8083),

  token: E.VPS_WS_TOKEN || '',

  storePath: path.join(
    ROOT,
    '.runtime',
    'public-receiver.json'
  ),

  maxMessageBytes: 65536,

  autoApplyEnabled:
    E.AUTO_APPLY_ENABLED === 'true'
};

if (!CONFIG.token || CONFIG.token.length < 32) {
  throw new Error(
    'VPS_WS_TOKEN must contain at least 32 characters'
  );
}

const now = () => new Date().toISOString();

function log(event, details = {}) {
  console.log(JSON.stringify({
    timestamp: now(),
    component: 'amazon-receiver',
    event,
    ...details
  }));
}

// --------------------------------------------------
// Data store
// --------------------------------------------------

const store = {
  version: 1,
  updatedAt: now(),
  pending: {},
  applied: {},
  failed: {},
  stats: {
    received: 0,
    duplicates: 0,
    applied: 0
  }
};

let saveChain = Promise.resolve();

async function loadStore() {
  try {
    const raw = await fs.readFile(
      CONFIG.storePath,
      'utf8'
    );

    const saved = JSON.parse(raw);

    if (
      !saved ||
      typeof saved !== 'object' ||
      !saved.pending ||
      typeof saved.pending !== 'object'
    ) {
      throw new Error('Invalid Receiver store format');
    }

    // Maintain the same object reference for the worker.
    Object.assign(store, saved);

    store.pending ||= {};
    store.applied ||= {};
    store.failed ||= {};
    store.stats ||= {};

    store.stats.received ||= 0;
    store.stats.duplicates ||= 0;
    store.stats.applied ||= 0;

    log('store_loaded', {
      pending: Object.keys(store.pending).length,
      applied: Object.keys(store.applied).length
    });

  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }

    // First-time store initialization.
    // This assumes .runtime already exists.
    await fs.writeFile(
      CONFIG.storePath,
      JSON.stringify(store, null, 2),
      { flag: 'wx', mode: 0o600 }
    );

    log('store_initialized');
  }
}

// Serialize disk writes so WebSocket messages and the
// auto-apply worker do not write simultaneously.

function saveStore() {
  saveChain = saveChain
    .catch(error => {
      log('previous_store_write_failed', {
        error: error.message
      });
    })
    .then(async () => {
      store.updatedAt = now();

      // Capture the current state at write time.
      const json = JSON.stringify(
        store,
        null,
        2
      );

      const temp = CONFIG.storePath + '.tmp';

      await fs.writeFile(
        temp,
        json,
        { mode: 0o600 }
      );

      await fs.rename(
        temp,
        CONFIG.storePath
      );
    });

  return saveChain;
}

// --------------------------------------------------
// Job validation and deduplication
// --------------------------------------------------

function safeString(value, max = 500) {
  if (
    value === undefined ||
    value === null ||
    typeof value === 'object'
  ) {
    return null;
  }

  return String(value).trim().slice(0, max) || null;
}

function validateApplyUrl(value) {
  if (!value) return null;

  try {
    const url = new URL(value);

    if (
      url.protocol !== 'https:' ||
      ![
        'jobsatamazon.co.uk',
        'www.jobsatamazon.co.uk'
      ].includes(url.hostname)
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function normalizeJob(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid job payload');
  }

  const jobId = safeString(raw.jobId, 150);
  const title = safeString(raw.title, 300);

  if (!jobId || !title) {
    throw new Error('jobId and title are required');
  }

  // Prevent prototype-property names from becoming
  // unsafe object keys.
  if (
    jobId === '__proto__' ||
    jobId === 'constructor' ||
    jobId === 'prototype'
  ) {
    throw new Error('Invalid job ID');
  }

  const applyUrl = validateApplyUrl(
    raw.applyUrl || raw.jobUrl || raw.url
  );

  return {
    jobId,
    title,
    location: safeString(raw.location),
    postcode: safeString(raw.postcode, 30),
    payRate: safeString(raw.payRate, 100),

    shiftDetails: safeString(
      raw.shiftDetails || raw.shifts,
      500
    ),

    applyUrl,

    status: 'new',
    receivedAt: now(),
    updatedAt: now(),
    applyError: null
  };
}

function findExistingJob(jobId) {
  // Primary store: pending
  if (store.pending[jobId]) {
    return store.pending[jobId];
  }

  // Historical store
  if (store.applied[jobId]) {
    return store.applied[jobId];
  }

  if (store.failed[jobId]) {
    return store.failed[jobId];
  }

  return null;
}

async function acceptJob(payload) {
  const job = normalizeJob(payload);

  const existing = findExistingJob(job.jobId);

  if (existing) {
    store.stats.duplicates++;

    await saveStore();

    return {
      jobId: job.jobId,
      duplicate: true,
      status: existing.status
    };
  }

  // Auto-apply worker reads this location.
  store.pending[job.jobId] = job;

  store.stats.received++;

  await saveStore();

  log('new_job_received', {
    jobId: job.jobId,
    title: job.title,
    location: job.location,
    hasApplyUrl: Boolean(job.applyUrl)
  });

  return {
    jobId: job.jobId,
    duplicate: false,
    status: 'new'
  };
}

// --------------------------------------------------
// WebSocket authentication
// --------------------------------------------------

function validToken(value) {
  if (!value || !CONFIG.token) return false;

  const provided = Buffer.from(value);
  const expected = Buffer.from(CONFIG.token);

  if (provided.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    provided,
    expected
  );
}

function sendJSON(socket, message) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(message));
}

// --------------------------------------------------
// WebSocket Receiver
// --------------------------------------------------

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: CONFIG.maxMessageBytes
});

const wsHttp = http.createServer(
  (req, res) => {
    res.writeHead(404);
    res.end();
  }
);

wsHttp.on('upgrade', (req, socket, head) => {
  const pathname = new URL(
    req.url || '/',
    'http://localhost'
  ).pathname;

  if (
    pathname !== '/' &&
    pathname !== '/detector'
  ) {
    socket.write(
      'HTTP/1.1 404 Not Found\r\n\r\n'
    );
    socket.destroy();
    return;
  }

  const authorization =
    req.headers.authorization || '';

  const token = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : null;

  if (!validToken(token)) {
    socket.write(
      'HTTP/1.1 401 Unauthorized\r\n\r\n'
    );

    socket.destroy();

    log('websocket_unauthorized');
    return;
  }

  wss.handleUpgrade(
    req,
    socket,
    head,
    ws => {
      wss.emit('connection', ws, req);
    }
  );
});

wss.on('connection', socket => {
  log('detector_connected');

  sendJSON(socket, {
    event: 'RECEIVER_CONNECTED',
    timestamp: now()
  });

  // Process each message sequentially for this socket.
  // The store-level save queue serializes disk writes.
  let messageChain = Promise.resolve();

  socket.on('message', data => {
    messageChain = messageChain
      .then(async () => {
        let message;

        try {
          message = JSON.parse(data.toString());
        } catch {
          sendJSON(socket, {
            event: 'ERROR',
            reason: 'Invalid JSON'
          });

          return;
        }

        if (
          message.event === 'PING'
        ) {
          sendJSON(socket, {
            event: 'PONG',
            timestamp: now()
          });

          return;
        }

        if (
          message.event !== 'NEW_UK_JOB'
        ) {
          sendJSON(socket, {
            event: 'ERROR',
            reason: 'Unsupported event'
          });

          return;
        }

        try {
          const result = await acceptJob(message.job);

          // ACK is sent only after disk persistence.
          sendJSON(socket, {
            event: 'JOB_ACK',
            jobId: result.jobId,
            duplicate: result.duplicate,
            status: result.status,
            timestamp: now()
          });

        } catch (error) {
          log('job_rejected', {
            error: error.message
          });

          sendJSON(socket, {
            event: 'JOB_ERROR',
            jobId: safeString(
              message.job?.jobId,
              150
            ),
            reason: error.message
          });
        }
      })
      .catch(error => {
        log('websocket_processing_error', {
          error: error.message
        });
      });
  });

  socket.on('close', () => {
    log('detector_disconnected');
  });

  socket.on('error', error => {
    log('websocket_error', {
      error: error.message
    });
  });
});

// --------------------------------------------------
// HTTP API
// --------------------------------------------------

const httpServer = http.createServer((req, res) => {
  const url = new URL(
    req.url,
    `http://${CONFIG.host}:${CONFIG.httpPort}`
  );

  res.setHeader(
    'Content-Type',
    'application/json'
  );

  res.setHeader(
    'Cache-Control',
    'no-store'
  );

  const jobs = Object.values(store.pending);

  const counts = {
    total: jobs.length,
    new: jobs.filter(
      j => j.status === 'new'
    ).length,
    applying: jobs.filter(
      j => j.status === 'applying'
    ).length,
    applied: jobs.filter(
      j => j.status === 'applied'
    ).length,
    blocked: jobs.filter(
      j => j.status === 'blocked'
    ).length,
    reviewRequired: jobs.filter(
      j => j.status === 'review_required'
    ).length
  };

  if (url.pathname === '/health') {
    res.writeHead(200);

    res.end(JSON.stringify({
      service: 'amazon-receiver',
      status: 'running',
      startedAt: startedAt,
      httpPort: CONFIG.httpPort,
      websocketPort: CONFIG.wsPort,
      websocketClients: wss.clients.size,
      autoApplyEnabled: CONFIG.autoApplyEnabled,
      queue: counts,
      uptimeSeconds:
        Math.floor(process.uptime())
    }));

    return;
  }

  if (url.pathname === '/pending') {
    res.writeHead(200);

    res.end(JSON.stringify({
      total: counts.new,
      jobs: jobs.filter(
        job => job.status === 'new'
      )
    }));

    return;
  }

  if (url.pathname === '/jobs') {
    res.writeHead(200);

    res.end(JSON.stringify({
      total: jobs.length,
      jobs
    }));

    return;
  }

  res.writeHead(404);

  res.end(JSON.stringify({
    error: 'Not found'
  }));
});

// --------------------------------------------------
// Auto-apply integration
// --------------------------------------------------

let worker = null;

function startWorker() {
  if (!CONFIG.autoApplyEnabled) {
    log('auto_apply_disabled');
    return;
  }

  worker = startAutoApplyWorker({
    store,
    saveStore
  });

  log('auto_apply_worker_enabled');
}

// --------------------------------------------------
// Startup
// --------------------------------------------------

const startedAt = now();

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);

    server.listen(
      port,
      CONFIG.host,
      resolve
    );
  });
}

async function main() {
  await loadStore();

  await listen(
    httpServer,
    CONFIG.httpPort
  );

  await listen(
    wsHttp,
    CONFIG.wsPort
  );

  log('receiver_started', {
    httpPort: CONFIG.httpPort,
    websocketPort: CONFIG.wsPort,
    storage: CONFIG.storePath
  });

  startWorker();
}

// --------------------------------------------------
// Graceful shutdown
// --------------------------------------------------

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;

  shuttingDown = true;

  log('shutdown_requested');

  if (worker) {
    await worker.stop();
  }

  await saveChain.catch(() => {});

  for (const socket of wss.clients) {
    socket.terminate();
  }

  wss.close();
  wsHttp.close();
  httpServer.close();

  log('receiver_stopped');
}

process.once('SIGINT', () => {
  void shutdown();
});

process.once('SIGTERM', () => {
  void shutdown();
});

main().catch(error => {
  log('receiver_fatal', {
    error: error.message
  });

  process.exitCode = 1;
  void shutdown();
});
