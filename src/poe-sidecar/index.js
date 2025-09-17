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
app.use(bodyParser.raw({ type: '*/*', limit: '1mb' }));
app.use(bodyParser.json());

function canonicalPreimage(meta) {
  const s = `${meta.method}|${meta.path}|${meta.timestamp}|${meta.reqHash}|${meta.resHash}|${meta.serviceId}|${meta.functionName}`;
  return Buffer.from(s, 'utf8');
}

function bytesToCircuitIn(buf) {
  const arr = new Array(256).fill(0);
  const n = Math.min(256, buf.length);
  for (let i = 0; i < n; i++) arr[i] = buf[i];
  return arr;
}

function generateProof(preimageBuf) {
  const circuitIn = { in: bytesToCircuitIn(preimageBuf) };
  const inputsPath = `${CIRCUIT_DIR}/input.json`;
  fs.writeFileSync(inputsPath, JSON.stringify(circuitIn));

  execSync(`snarkjs wtns calculate ${CIRCUIT_DIR}/poe.wasm ${inputsPath} ${CIRCUIT_DIR}/witness.wtns`, { stdio: 'inherit' });
  execSync(`snarkjs groth16 prove ${CIRCUIT_DIR}/poe.zkey ${CIRCUIT_DIR}/witness.wtns ${CIRCUIT_DIR}/proof.json ${CIRCUIT_DIR}/public.json`, { stdio: 'inherit' });

  return {
    proof: JSON.parse(fs.readFileSync(`${CIRCUIT_DIR}/proof.json`)),
    pub: JSON.parse(fs.readFileSync(`${CIRCUIT_DIR}/public.json`))
  };
}

// 1) Proxy handler (optional)
app.all('/proxy/*', async (req, res) => {
  try {
    const url = `${SERVICE_BACKEND}${req.url.replace('/proxy', '')}`;
    const backendRes = await fetch(url, {
      method: req.method,
      headers: req.headers,
      body: req.body && req.body.length > 0 ? req.body : undefined,
    });

    const resBuf = Buffer.from(await backendRes.arrayBuffer());
    const timestamp = Date.now();
    const meta = {
      method: req.method,
      path: req.url,
      timestamp,
      reqHash: crypto.createHash('sha256').update(req.body || Buffer.from('')).digest('hex'),
      resHash: crypto.createHash('sha256').update(resBuf).digest('hex'),
      serviceId: process.env.SERVICE_ID || 'service-unknown',
      functionName: 'proxyHandler'
    };

    const preimage = canonicalPreimage(meta);
    const { proof, pub } = generateProof(preimage);

    res.json({ poe: { ...meta, digest: pub, proof }, backendBody: resBuf.toString('utf8') });
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).send('proxy error');
  }
});

// 2) Explicit /prove endpoint
app.post('/prove', async (req, res) => {
  try {
    const meta = req.body;
    if (!meta || !meta.method || !meta.path || !meta.timestamp) {
      return res.status(400).send('invalid metadata');
    }

    const preimage = canonicalPreimage(meta);
    const { proof, pub } = generateProof(preimage);

    res.json({ poe: { ...meta, digest: pub, proof } });
  } catch (err) {
    console.error('Prove error:', err);
    res.status(500).send('prove error');
  }
});

app.listen(PORT, () => {
  console.log(`Sidecar listening on ${PORT}, backend ${SERVICE_BACKEND}`);
});