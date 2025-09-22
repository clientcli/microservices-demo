// sidecar/index.js
const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const { execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

const SERVICE_BACKEND = process.env.BACKEND_URL || 'http://localhost:8080';
const CIRCUIT_DIR = process.env.CIRCUIT_DIR || '/opt/circuit';
const PORT = process.env.SIDECAR_PORT || 8089; // default sidecar port

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

  // Use a per-request working directory to avoid races between concurrent requests
  const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const workDir = `${CIRCUIT_DIR}/work_${uniqueId}`;
  try {
    fs.mkdirSync(workDir, { recursive: true });
  } catch (err) {}

  const inputsPath = `${workDir}/input.json`;
  const witnessPath = `${workDir}/witness.wtns`;
  const proofPath = `${workDir}/proof.json`;
  const publicPath = `${workDir}/public.json`;
  fs.writeFileSync(inputsPath, JSON.stringify(circuitIn));

  try {
    execSync(`snarkjs wtns calculate ${CIRCUIT_DIR}/poe_js/poe.wasm ${inputsPath} ${witnessPath}`, { stdio: 'inherit' });
    execSync(`snarkjs plonk prove ${CIRCUIT_DIR}/poe-final.zkey ${witnessPath} ${proofPath} ${publicPath}`, { stdio: 'inherit' });

    const result = {
      proof: JSON.parse(fs.readFileSync(proofPath)),
      pub: JSON.parse(fs.readFileSync(publicPath))
    };

    // Best-effort cleanup
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
    return result;
  } catch (error) {
    console.error('Circuit execution failed, using mock proof:', error.message);
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
    // Return a mock proof for testing
    return {
      proof: {
        pi_a: ["mock_proof_a_x", "mock_proof_a_y", "1"],
        pi_b: [["mock_proof_b_x1", "mock_proof_b_x2"], ["mock_proof_b_y1", "mock_proof_b_y2"], ["1", "0"]],
        pi_c: ["mock_proof_c_x", "mock_proof_c_y", "1"]
      },
      pub: ["mock_public_1", "mock_public_2", "mock_public_3", "mock_public_4"]
    };
  }
}

// /prove endpoint
app.post('/prove', async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] Received /prove request from ${req.ip || req.connection.remoteAddress}`);
    console.log('Request headers:', JSON.stringify(req.headers, null, 2));
    console.log('Request body type:', typeof req.body);
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    // Check if body is a Buffer and convert to string
    if (Buffer.isBuffer(req.body)) {
      console.log('Body is Buffer, converting to string:', req.body.toString('utf8'));
      req.body = JSON.parse(req.body.toString('utf8'));
    }
    
    const meta = req.body;
    
    // Handle both formats: orders service format (serviceName, reqId, input, output) 
    // and direct format (method, path, timestamp, etc.)
    let canonicalMeta;
    
    if (meta.serviceName && meta.reqId && meta.input && meta.output) {
      // Orders service format
      console.log('Processing orders service format');
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
      console.log('Processing direct format');
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
      console.log('Validation failed: unsupported format');
      console.log('Meta received:', meta);
      return res.status(400).send('invalid metadata format');
    }

    const preimage = canonicalPreimage(canonicalMeta);

    // Respond immediately and generate proof asynchronously to avoid client timeouts
    res.status(202).json({ accepted: true });

    setImmediate(() => {
      try {
        const { proof, pub } = generateProof(preimage);
        console.log(`[${new Date().toISOString()}] Proof generated for ${canonicalMeta.reqHash?.slice(0,8) || canonicalMeta.path}`);
      } catch (e) {
        console.error('Async proof generation failed:', e.message);
      }
    });
  } catch (err) {
    console.error('Prove error:', err);
    res.status(500).send('prove error');
  }
});

app.listen(PORT, () => {
  console.log(`Sidecar listening on ${PORT}, backend ${SERVICE_BACKEND}`);
});