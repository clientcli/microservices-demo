// sidecar/index.js
// Sidecar with async proof jobs, handles long runtimes (~4-5 min per proof)

const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const PQueue = require('p-queue').default;
const { LRUCache } = require('lru-cache');


// ----- Config -----
const SERVICE_BACKEND = process.env.BACKEND_URL || 'http://backend:8080';
const AGGREGATOR_URL = process.env.AGGREGATOR_INGEST_URL || 'http://proofs-aggregator:8090/ingest/proof';
const CIRCUIT_DIR = process.env.CIRCUIT_DIR || '/opt/circuit';
const PORT = parseInt(process.env.SIDECAR_PORT || '8089', 10);
const MAX_CONCURRENCY = parseInt(process.env.MAX_PROOFS_CONCURRENCY || '1', 10);
const MAX_QUEUE_SIZE = parseInt(process.env.MAX_QUEUE_SIZE || '100', 10);
const WTN_TIMEOUT_MS = parseInt(process.env.WTN_CALC_TIMEOUT_MS || '600000', 10); // 10 min
const PROVE_TIMEOUT_MS = parseInt(process.env.PROVE_TIMEOUT_MS || '600000', 10); // 10 min
const POE_WASM = path.join(CIRCUIT_DIR, 'poe_js', 'poe.wasm');
const POE_ZKEY = path.join(CIRCUIT_DIR, 'poe-final.zkey');

// Cache (avoid recomputing same preimage)
const proofCache = new LRUCache({ max: 1000, ttl: 60 * 60 * 1000 }); // 1h TTL

// Queue (concurrency-limited)
const queue = new PQueue({ concurrency: MAX_CONCURRENCY });

// Metrics
const metrics = {
  queued: 0,
  active: 0,
  total: 0,
  successes: 0,
  failures: 0,
  lastDurationSec: null,
  avgDurationSec: null,
};

// ----- Helpers -----
function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function canonicalPreimage(meta) {
  const s = `${meta.method}|${meta.path}|${meta.timestamp}|${meta.reqHash}|${meta.resHash}|${meta.serviceId}|${meta.functionName}`;
  return Buffer.from(s, 'utf8');
}

function bytesToCircuitIn(buf) {
  const bits = [];
  const n = Math.min(32, buf.length);
  for (let i = 0; i < n; i++) {
    const byte = buf[i];
    for (let j = 7; j >= 0; j--) bits.push((byte >> j) & 1);
  }
  while (bits.length < 256) bits.push(0);
  return bits.slice(0, 256);
}

function spawnWithTimeout(cmd, args, { cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs);

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`Timeout after ${timeoutMs}ms`));
      if (code !== 0) return reject(new Error(stderr || stdout));
      resolve({ stdout, stderr });
    });
  });
}

async function generateProof(preimageBuf, jobId) {
  const workDir = path.join(os.tmpdir(), `proof_${jobId}`);
  await fs.mkdir(workDir, { recursive: true });
  const inputPath = path.join(workDir, 'input.json');
  const witnessPath = path.join(workDir, 'witness.wtns');
  const proofPath = path.join(workDir, 'proof.json');
  const publicPath = path.join(workDir, 'public.json');

  try {
    const circuitIn = { in: bytesToCircuitIn(preimageBuf) };
    const inputJson = JSON.stringify(circuitIn);
    await fs.writeFile(inputPath, inputJson);
    
    // Log circuit input data length
    const inputJsonLength = Buffer.from(inputJson, 'utf8').length;
    const circuitInputBits = circuitIn.in.length;
    // log(`[${jobId}] Circuit Input - JSON: ${inputJsonLength} bytes, bits: ${circuitInputBits}`);

    // log(`[${jobId}] Running wtns calculate...`);
    const wtnsStart = Date.now();
    await spawnWithTimeout('snarkjs', ['wtns', 'calculate', POE_WASM, inputPath, witnessPath], {
      cwd: workDir, timeoutMs: WTN_TIMEOUT_MS
    });
    const wtnsDuration = (Date.now() - wtnsStart) / 1000;
    
    // Get witness file size
    const witnessStats = await fs.stat(witnessPath).catch(() => ({ size: 0 }));
    // log(`[${jobId}] Witness calculation completed in ${wtnsDuration.toFixed(3)}s, witness file: ${witnessStats.size} bytes`);

    // log(`[${jobId}] Running plonk prove...`);
    const proveStart = Date.now();
    await spawnWithTimeout('snarkjs', ['plonk', 'prove', POE_ZKEY, witnessPath, proofPath, publicPath], {
      cwd: workDir, timeoutMs: PROVE_TIMEOUT_MS
    });
    const proveDuration = (Date.now() - proveStart) / 1000;
    
    // Get proof and public input file sizes
    const proofStats = await fs.stat(proofPath).catch(() => ({ size: 0 }));
    const publicStats = await fs.stat(publicPath).catch(() => ({ size: 0 }));
    log(`[${jobId}] Proof generation completed in ${proveDuration.toFixed(3)}s, proof: ${proofStats.size} bytes, public: ${publicStats.size} bytes`);

    const proof = JSON.parse(await fs.readFile(proofPath, 'utf8'));
    const pub = JSON.parse(await fs.readFile(publicPath, 'utf8'));
    return { proof, pub };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ----- Proof Job -----
async function handleProof(meta, preimageBuf, jobId) {
  const preHash = crypto.createHash('sha256').update(preimageBuf).digest('hex');
  const cacheKey = `${preHash}_v1`;

  // Log data lengths for profiling
  const preimageLength = preimageBuf.length;
  const metaString = JSON.stringify(meta);
  const metaLength = Buffer.from(metaString, 'utf8').length;
  
  // log(`[${jobId}] Data Lengths - preimage: ${preimageLength} bytes, metadata: ${metaLength} bytes, total: ${preimageLength + metaLength} bytes`);

  if (proofCache.has(cacheKey)) {
    log(`[${jobId}] Proof served from cache.`);
    return proofCache.get(cacheKey);
  }

  const start = Date.now();
  const { proof, pub } = await generateProof(preimageBuf, jobId);
  const duration = (Date.now() - start) / 1000;

  metrics.successes++;
  metrics.lastDurationSec = duration;
  metrics.avgDurationSec = metrics.avgDurationSec
    ? (metrics.avgDurationSec * (metrics.successes - 1) + duration) / metrics.successes
    : duration;

  // log(`[${jobId}] Proof generated in ${duration.toFixed(1)}s`);
  
  // Log proof generation time and data lengths to dedicated log file
  // Format: timestamp,jobId,duration_sec,preimage_bytes,metadata_bytes,total_bytes,service_name
  // const logEntry = `${new Date().toISOString()},${jobId},${duration.toFixed(3)},${preimageLength},${metaLength},${preimageLength + metaLength},${meta.serviceId || 'unknown'}\n`;
  // await fs.appendFile('/app/logs/proof_generation_time.log', logEntry).catch(() => {});
  
  const result = { proof, pub };
  proofCache.set(cacheKey, result);
  return result;
}

// ----- Express App -----
const app = express();
app.use(bodyParser.json({ limit: '2mb' }));

app.post('/prove', async (req, res) => {
  try {
    log(`/prove request comming....`)
    const meta = req.body;
    const expectedServiceId = process.env.SERVICE_ID || 'service-unknown';

    // log(`meta:`, JSON.stringify(meta))
    if (!meta || !meta.reqId || !meta.input || !meta.output) {
      log(`Invalid metadata received`)
      return res.status(400).send('invalid metadata');
    }
    if (meta.serviceName && meta.serviceName !== expectedServiceId) {
      log(`Forbidden serviceId=${meta.serviceId}`)
      return res.status(403).send('forbidden serviceId');
    }

    const reqHash = meta.reqHash || crypto.createHash('sha256').update(meta.reqBody || '').digest('hex');
    const resHash = meta.resHash || crypto.createHash('sha256').update(meta.resBody || '').digest('hex');
    const canonicalMeta = {
      method: 'POST', // Default
      path: `/orders/${meta.reqId}`, // Use reqId in path
      timestamp: meta.timestamp || Date.now(),
      reqHash, resHash,
      serviceId: expectedServiceId,
      functionName: meta.functionName || 'prove'
    };

    const preimageBuf = canonicalPreimage(canonicalMeta);
    const jobId = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    // log(`[${jobId}] Incoming /prove request with meta:`, JSON.stringify(meta));

    // Reject if queue too large
    if (queue.size + queue.pending > MAX_QUEUE_SIZE) {
      log(`[${jobId}] Rejected (queue full).`);
      return res.status(503).json({ error: 'queue full' });
    }

    res.status(202).json({ accepted: true, jobId });

    metrics.queued++;
    metrics.total++;

    queue.add(async () => {
      metrics.queued--;
      metrics.active++;
      try {
        // log(`[${jobId}] Proof job started (queue length ${queue.size})`);
        const result = await handleProof(canonicalMeta, preimageBuf, jobId);
        // Send to proofs-aggregator for correlation by reqId
        try {
          const body = { jobId, meta: { ...canonicalMeta, reqId: meta.reqId, serviceName: meta.serviceName }, proof: result.proof, pub: result.pub, reqId: meta.reqId };
          await fetch(AGGREGATOR_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
        } catch (e) {
          log(`[${jobId}] Aggregator post failed:`, e.message);
        }
      } catch (e) {
        metrics.failures++;
        log(`[${jobId}] Proof job failed:`, e.message);
      } finally {
        metrics.active--;
      }
    });

  } catch (err) {
    log('Handler error:', err.message);
    res.status(500).send('error');
  }
});

app.get('/metrics', (req, res) => res.json({
  queueSize: queue.size,
  pending: queue.pending,
  concurrency: queue.concurrency,
  metrics
}));

app.listen(PORT, () => {
  log(`Sidecar listening on port ${PORT}`);
  log(`Backend: ${SERVICE_BACKEND}`);
  log(`Concurrency=${MAX_CONCURRENCY}, MaxQueue=${MAX_QUEUE_SIZE}`);
});
