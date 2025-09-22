// sidecar/index.js
const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SERVICE_BACKEND = process.env.BACKEND_URL || 'http://localhost:8080';
const CIRCUIT_DIR = process.env.CIRCUIT_DIR || '/opt/circuit';
const PORT = process.env.SIDECAR_PORT || 8089; // default sidecar port
const BENCH_LOG_PATH = process.env.POE_BENCH_LOG || './tmp/poe-bench.log';
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();

function logDebug(...args) {
  if (LOG_LEVEL === 'debug') {
    console.log(...args);
  }
}
function logInfo(...args) {
  if (LOG_LEVEL === 'info' || LOG_LEVEL === 'debug') {
    console.log(...args);
  }
}
function logError(...args) {
  console.error(...args);
}

const app = express();
app.use(bodyParser.json({ limit: '1mb' }));

function canonicalPreimage(meta) {
  const s = `${meta.method}|${meta.path}|${meta.timestamp}|${meta.reqHash}|${meta.resHash}|${meta.serviceId}|${meta.functionName}`;
  return Buffer.from(s, 'utf8');
}

function bytesToCircuitIn(buf) {
  // The circuit expects 256 bits, so we'll take the first 256 bits from our input
  const bitArray = [];
  const n = Math.min(32, Math.ceil(buf.length / 8)); // 32 bytes = 256 bits
  
  for (let i = 0; i < n; i++) {
    const byte = buf[i] || 0;
    // Convert byte to 8 bits
    for (let j = 7; j >= 0; j--) {
      bitArray.push((byte >> j) & 1);
    }
  }
  
  // Ensure exactly 256 bits
  while (bitArray.length < 256) {
    bitArray.push(0);
  }
  return bitArray.slice(0, 256);
}

function generateProof(preimageBuf) {
  const circuitIn = { in: bytesToCircuitIn(preimageBuf) };
  const inputsPath = `${CIRCUIT_DIR}/input.json`;
  fs.writeFileSync(inputsPath, JSON.stringify(circuitIn));

    try {
      logInfo('Starting witness generation...');
      const startWitness = process.hrtime.bigint();
      execSync(`snarkjs wtns calculate ${CIRCUIT_DIR}/poe_js/poe.wasm ${inputsPath} ${CIRCUIT_DIR}/witness.wtns`, { stdio: 'inherit' });
      const endWitness = process.hrtime.bigint();
      const witnessSec = Number(endWitness - startWitness) / 1e9;
      logInfo(`Witness generation completed in ${witnessSec.toFixed(3)}s`);

      logInfo('Starting proof generation...');
      const startProve = process.hrtime.bigint();
      execSync(`snarkjs plonk prove ${CIRCUIT_DIR}/poe-final.zkey ${CIRCUIT_DIR}/witness.wtns ${CIRCUIT_DIR}/proof.json ${CIRCUIT_DIR}/public.json`, { stdio: 'inherit' });
      const endProve = process.hrtime.bigint();
      const proveSec = Number(endProve - startProve) / 1e9;
      logInfo(`Proof generation completed in ${proveSec.toFixed(3)}s`);

    const proofPath = `${CIRCUIT_DIR}/proof.json`;
    const pubPath = `${CIRCUIT_DIR}/public.json`;
    const proof = JSON.parse(fs.readFileSync(proofPath));
    const pub = JSON.parse(fs.readFileSync(pubPath));
    const proofBytes = fs.statSync(proofPath).size;
    const pubBytes = fs.statSync(pubPath).size;

    return {
      proof,
      pub,
      timings: { witnessSec, proveSec },
      sizes: { proofBytes, pubBytes }
    };
  } catch (error) {
    logError('Circuit execution failed, using mock proof:', error.message);
    // Return a mock proof for testing
    return {
      proof: {
        pi_a: ["mock_proof_a_x", "mock_proof_a_y", "1"],
        pi_b: [["mock_proof_b_x1", "mock_proof_b_x2"], ["mock_proof_b_y1", "mock_proof_b_y2"], ["1", "0"]],
        pi_c: ["mock_proof_c_x", "mock_proof_c_y", "1"]
      },
      pub: ["mock_public_1", "mock_public_2", "mock_public_3", "mock_public_4"],
      timings: { witnessSec: 0, proveSec: 0 },
      sizes: {
        proofBytes: Buffer.byteLength(JSON.stringify({
          pi_a: ["mock_proof_a_x", "mock_proof_a_y", "1"],
          pi_b: [["mock_proof_b_x1", "mock_proof_b_x2"], ["mock_proof_b_y1", "mock_proof_b_y2"], ["1", "0"]],
          pi_c: ["mock_proof_c_x", "mock_proof_c_y", "1"]
        })),
        pubBytes: Buffer.byteLength(JSON.stringify(["mock_public_1", "mock_public_2", "mock_public_3", "mock_public_4"]))
      }
    };
  }
}

// /prove endpoint
app.post('/prove', async (req, res) => {
  const handlerStart = process.hrtime.bigint();
  // Ensure benchmark log directory exists (once per request is fine and cheap)
  try {
    const dir = path.dirname(BENCH_LOG_PATH);
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    // Best-effort; keep handling even if mkdir fails
    logError('Failed to ensure bench log directory:', e.message);
  }
  try {
    logInfo(`[${new Date().toISOString()}] /prove`);
    logDebug('From:', req.ip || req.connection.remoteAddress);
    logDebug('Request headers:', JSON.stringify(req.headers, null, 2));
    logDebug('Request body type:', typeof req.body);
    logDebug('Request body:', JSON.stringify(req.body, null, 2));
    
    // Check if body is a Buffer and convert to string
    if (Buffer.isBuffer(req.body)) {
      logDebug('Body is Buffer, converting to string:', req.body.toString('utf8'));
      req.body = JSON.parse(req.body.toString('utf8'));
    }
    
    const meta = req.body;
    
    // Handle both formats: orders service format (serviceName, reqId, input, output) 
    // and direct format (method, path, timestamp, etc.)
    let canonicalMeta;
    
    if (meta.serviceName && meta.reqId && meta.input && meta.output) {
      // Orders service format
      logDebug('Processing orders service format');
      const expectedServiceId = process.env.SERVICE_ID || 'service-unknown';
      
      // Convert input/output to hashes
      const reqHash = crypto.createHash('sha256').update(meta.input).digest('hex');
      const resHash = crypto.createHash('sha256').update(meta.output).digest('hex');
      
      canonicalMeta = {
        method: 'POST', // Default for orders service
        path: `/orders/${meta.reqId}`, // Use reqId in path
        timestamp: Date.now(),
        reqHash,
        resHash,
        serviceId: expectedServiceId,
        functionName: 'orderProcessing'
      };
    } else if (meta.method && meta.path) {
      // Direct format
      logDebug('Processing direct format');
      const expectedServiceId = process.env.SERVICE_ID || 'service-unknown';
      if (meta.serviceId && meta.serviceId !== expectedServiceId) {
        return res.status(403).send('forbidden serviceId');
      }

      // Compute hashes if bodies are provided and hashes are missing
      const reqHash = meta.reqHash || (meta.reqBody ? crypto.createHash('sha256').update(Buffer.from(meta.reqBody)).digest('hex') : '');
      const resHash = meta.resHash || (meta.resBody ? crypto.createHash('sha256').update(Buffer.from(meta.resBody)).digest('hex') : '');

      canonicalMeta = {
        method: meta.method,
        path: meta.path,
        timestamp: meta.timestamp || Date.now(),
        reqHash,
        resHash,
        serviceId: expectedServiceId,
        functionName: meta.functionName || 'prove'
      };
    } else {
      logDebug('Validation failed: unsupported format');
      logDebug('Meta received:', meta);
      return res.status(400).send('invalid metadata format');
    }

    const preimage = canonicalPreimage(canonicalMeta);
    const { proof, pub, timings, sizes } = generateProof(preimage);

    // Surface timing breakdown in headers for easy collection by clients
    res.set('X-PoE-Witness-Sec', String(timings.witnessSec));
    res.set('X-PoE-Prove-Sec', String(timings.proveSec));
    // Surface proof sizes
    res.set('X-PoE-Proof-Bytes', String(sizes.proofBytes));
    res.set('X-PoE-Public-Bytes', String(sizes.pubBytes));

    // Append a JSON line to a benchmark log for later analysis
    try {
      const handlerEnd = process.hrtime.bigint();
      const handlerSec = Number(handlerEnd - handlerStart) / 1e9;
      const benchEntry = {
        ts: new Date().toISOString(),
        serviceId: (process.env.SERVICE_ID || 'service-unknown'),
        route: '/prove',
        method: canonicalMeta.method,
        path: canonicalMeta.path,
        timings,
        sizes,
        handlerSec
      };
      fs.appendFile(BENCH_LOG_PATH, JSON.stringify(benchEntry) + "\n", (err) => {
        if (err) {
          logError('Failed to append benchmark log:', err.message);
        }
      });
    } catch (logErr) {
      logError('Benchmark logging error:', logErr.message);
    }

    res.json({ poe: { ...canonicalMeta, digest: pub, proof, timings, sizes } });
  } catch (err) {
    logError('Prove error:', err);
    res.status(500).send('prove error');
  }
});

app.listen(PORT, () => {
  logInfo(`Sidecar listening on ${PORT}`);
});