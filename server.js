cat << 'EOF' > /var/www/amazon-bot-system/amazon-receiver/server.js
import 'dotenv/config';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

const PORT = Number(env.PORT || 5003);
const HOST = env.BIND_HOST || '127.0.0.1';
const WS_PORT = Number(env.WS_PORT || 8082);
const WS_TOKEN = env.WS_TOKEN || 'change-this-secret-token';
const MAX_PENDING = Number(env.MAX_PENDING || 2000);

const DATA_DIR = path.join(dir, '.runtime');
const DATA_FILE = path.join(DATA_DIR, 'public-receiver.json');

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

let store = { seen: [], pending: [], history: [] };

try {
  store = { ...store, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw new Error(`Receiver state could not be loaded: ${error.message}`);
  }
}

const seen = new Set(store.seen.map(String));

const state = {
  service: 'amazon-receiver',
  startedAt: new Date().toISOString(),
  phase: 'waiting_for_local_detector',
  socket: 'listening',
  lastEvent: null,
  lastJob: null,
  lastError: null,
  lastConnectedAt: null,
  receivedEvents: 0,
  newJobs: 0
};

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
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
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
  if (!key || !job.title) return false;
  if (seen.has(key)) return true; // Already seen, still ack

  const accepted = matchesFilters(job);
  if (accepted && store.pending.length >= MAX_PENDING) {
    state.lastError = 'Pending queue is full';
    log('queue_full', { jobId: key });
    return false;
  }

  seen.add(key);

  if (!accepted) {
    log('job_filtered', { jobId: key, title: job.title });
    save();
    return true;
  }

  const record = {
    ...job,
    receivedAt: new Date().toISOString(),
    status: 'new'
  };

  store.pending.push(record);
  store.history.push({ jobId: key, event: 'NEW_UK_JOB', timestamp: record.receivedAt });
  store.history = store.history.slice(-5000);
  save();

  state.newJobs++;
  state.lastJob = { jobId: job.jobId, title: job.title, location: job.location };

  log('new_job_received', {
    jobId: job.jobId,
    title: job.title,
    location: job.location,
    pending: store.pending.length
  });

  return true;
}

// WebSocket Server for Local Detector
const wss = new WebSocketServer({ host: '0.0.0.0', port: WS_PORT });

wss.on('connection', (ws, req) => {
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${WS_TOKEN}`) {
    log('unauthorized_connection_rejected', { ip: req.socket.remoteAddress });
    ws.close(1008, 'Unauthorized');
    return;
  }

  state.socket = 'connected';
  state.phase = 'monitoring';
  state.lastConnectedAt = new Date().toISOString();
  log('local_detector_connected', { ip: req.socket.remoteAddress });

  ws.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      log('invalid_json_message');
      return;
    }

    state.receivedEvents++;
    state.lastEvent = new Date().toISOString();

    if (message.event === 'NEW_UK_JOB' && message.job) {
      const ok = processJob(message.job);
      if (ok && message.job.jobId) {
        ws.send(JSON.stringify({ event: 'JOB_ACK', jobId: message.job.jobId }));
      }
    }
  });

  ws.on('close', () => {
    state.socket = 'listening';
    state.phase = 'waiting_for_local_detector';
    log('local_detector_disconnected');
  });
});

// HTTP health/status API (existing)
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (url.pathname === '/health' || url.pathname === '/status') {
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
    const rawLimit = Number(url.searchParams.get('limit') || 100);
    const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, Math.floor(rawLimit))) : 100;
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
  log('receiver_started', { httpPort: PORT, wsPort: WS_PORT });
});
EOF
