const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const fetch = require('node-fetch');

const PORT = parseInt(process.env.AGGREGATOR_PORT || '8090', 10);

// In-memory store: reqId -> { events: [], proofs: [], finalized?: { root, leafCount, finalizedAt } }
const store = new Map();

function upsertAggregation(reqId) {
  if (!store.has(reqId)) {
    store.set(reqId, { reqId, events: [], proofs: [], createdAt: Date.now(), lastUpdatedAt: Date.now() });
  }
  return store.get(reqId);
}

function sha256Hex(data) {
  const h = crypto.createHash('sha256');
  h.update(typeof data === 'string' ? data : Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data)));
  return h.digest('hex');
}

function buildMerkleTree(leaves) {
  if (leaves.length === 0) return { root: null, levels: [] };
  let level = leaves.slice();
  const levels = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left;
      const combined = Buffer.concat([Buffer.from(left, 'hex'), Buffer.from(right, 'hex')]);
      next.push(sha256Hex(combined));
    }
    level = next;
    levels.push(level);
  }
  return { root: level[0], levels };
}

const app = express();
app.use(bodyParser.json({ limit: '4mb' }));

// Ingest raw PoE emission prior to proving (optional)
app.post('/ingest/event', (req, res) => {
  try {
    const evt = req.body || {};
    const reqId = evt.reqId || evt.req_id;
    if (!reqId) return res.status(400).json({ error: 'missing reqId' });
    const agg = upsertAggregation(reqId);
    agg.events.push({
      serviceName: evt.serviceName || evt.service_name,
      stage: evt.stage || (evt.output && evt.output.stage) || 'unknown',
      input: evt.input,
      output: evt.output,
      timestamp: evt.timestamp || Date.now()
    });
    agg.lastUpdatedAt = Date.now();
    return res.status(202).json({ accepted: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Ingest completed proof from sidecar
app.post('/ingest/proof', (req, res) => {
  try {
    const payload = req.body || {};
    const reqId = payload.reqId || payload.req_id;
    if (!reqId) return res.status(400).json({ error: 'missing reqId' });
    const agg = upsertAggregation(reqId);
    agg.proofs.push({
      jobId: payload.jobId,
      meta: payload.meta,
      proof: payload.proof,
      pub: payload.pub,
      timestamp: Date.now()
    });
    agg.lastUpdatedAt = Date.now();
    return res.status(202).json({ accepted: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Fetch aggregation by reqId
app.get('/aggregate/:reqId', (req, res) => {
  const reqId = req.params.reqId;
  const agg = store.get(reqId);
  if (!agg) return res.status(404).json({ error: 'not found' });
  return res.json(agg);
});

// Compute Merkle tree over proofs for a reqId
// Leaf = sha256(JSON.stringify({meta, proof, pub}))
app.get('/aggregate/:reqId/merkle', (req, res) => {
  const reqId = req.params.reqId;
  const agg = store.get(reqId);
  if (!agg) return res.status(404).json({ error: 'not found' });
  const leaves = (agg.proofs || []).map(p => sha256Hex({ meta: p.meta, proof: p.proof, pub: p.pub }));
  const tree = buildMerkleTree(leaves);
  return res.json({ reqId, leafCount: leaves.length, root: tree.root, levels: tree.levels });
});

// Finalize an aggregation: compute once and cache the Merkle root
app.post('/aggregate/:reqId/finalize', (req, res) => {
  const reqId = req.params.reqId;
  const agg = store.get(reqId);
  if (!agg) return res.status(404).json({ error: 'not found' });
  const leaves = (agg.proofs || []).map(p => sha256Hex({ meta: p.meta, proof: p.proof, pub: p.pub }));
  const tree = buildMerkleTree(leaves);
  agg.finalized = { root: tree.root, leafCount: leaves.length, finalizedAt: Date.now() };
  agg.lastUpdatedAt = Date.now();
  return res.json({ reqId, ...agg.finalized });
});

// Estimate blockchain gas to store root on-chain (requires ETH_RPC_URL and contract "to" and "data")
// Body: { to?: string, data?: string }
app.post('/aggregate/:reqId/chain/estimate', async (req, res) => {
  try {
    const reqId = req.params.reqId;
    const agg = store.get(reqId);
    if (!agg) return res.status(404).json({ error: 'not found' });
    const leaves = (agg.proofs || []).map(p => sha256Hex({ meta: p.meta, proof: p.proof, pub: p.pub }));
    const tree = buildMerkleTree(leaves);
    const rootHex = tree.root ? '0x' + tree.root : null;

    const rpcUrl = process.env.ETH_RPC_URL;
    const to = (req.body && req.body.to) || process.env.CHAIN_CONTRACT_ADDRESS || null;
    const data = (req.body && req.body.data) || (rootHex ? rootHex : '0x');

    if (!rpcUrl || !to) {
      return res.json({
        reqId,
        root: rootHex,
        leafCount: leaves.length,
        to,
        data,
        note: 'Provide ETH_RPC_URL and contract address (to) and optionally data to get a real gas estimate.'
      });
    }

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_estimateGas',
      params: [ { to, data } ]
    };
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const out = await resp.json();
    if (out.error) {
      return res.status(400).json({ reqId, root: rootHex, leafCount: leaves.length, to, data, error: out.error });
    }
    return res.json({ reqId, root: rootHex, leafCount: leaves.length, to, data, gasEstimate: out.result });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// List recent aggregations
app.get('/aggregate', (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || '50', 10), 500));
  const items = Array.from(store.values())
    .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
    .slice(0, limit)
    .map(v => ({ reqId: v.reqId, events: v.events.length, proofs: v.proofs.length, lastUpdatedAt: v.lastUpdatedAt }));
  return res.json(items);
});

app.listen(PORT, () => {
  console.log(`Proofs Aggregator listening on port ${PORT}`);
});


