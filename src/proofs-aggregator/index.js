// aggregator-orchestrator.js
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { create } = require('ipfs-http-client');
const blake3 = require('blake3');

const PORT = parseInt(process.env.AGGREGATOR_PORT || '8090');
const CHAIN_CONTRACT_ADDRESS = process.env.CHAIN_CONTRACT_ADDRESS || null;
const ETH_RPC_URL = process.env.ETH_RPC_URL || null;
const ENABLE_IPFS = process.env.ENABLE_IPFS === 'true';
const IPFS_URL = process.env.IPFS_URL || 'http://localhost:5001';
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS || '15000'); // 15s polling
const INACTIVITY_TIMEOUT_MS = parseInt(process.env.INACTIVITY_TIMEOUT_MS || '120000'); // 2 min after last proof

const ipfs = ENABLE_IPFS ? create({ url: IPFS_URL }) : null;

// ------------------------ In-memory store ------------------------
const store = new Map(); // reqId -> { events: [], proofs: [], finalized?, lastUpdatedAt }

function upsertAggregation(reqId) {
  if (!store.has(reqId)) {
    store.set(reqId, { reqId, events: [], proofs: [], createdAt: Date.now(), lastUpdatedAt: Date.now() });
  }
  return store.get(reqId);
}

// ------------------------ Merkle tree helpers ------------------------
function buildMerkleTreeBLAKE3(leaves) {
  if (!leaves.length) return { root: null, levels: [] };
  let level = leaves.slice();
  const levels = [level];

  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left;
      const combined = Buffer.concat([Buffer.from(left, 'hex'), Buffer.from(right, 'hex')]);
      next.push(blake3.hash(combined).toString('hex'));
    }
    level = next;
    levels.push(level);
  }

  return { root: level[0], levels };
}

function computeMerkleRootFromAggregation(agg) {
  const leaves = agg.proofs.map(p => {
    const buf = Buffer.from(JSON.stringify({ meta: p.meta, proof: p.proof, pub: p.pub }));
    return blake3.hash(buf).toString('hex');
  });
  return buildMerkleTreeBLAKE3(leaves);
}

// ------------------------ Blockchain gas estimation ------------------------
async function estimateGasForRoot(rootHex, leafCount, to) {
  if (!ETH_RPC_URL || !to) {
    return { root: rootHex, leafCount, note: 'Missing ETH_RPC_URL or contract address' };
  }

  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_estimateGas',
    params: [{ to, data: rootHex }]
  };

  const resp = await fetch(ETH_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const out = await resp.json();
  if (out.error) throw new Error(JSON.stringify(out.error));
  return { root: rootHex, leafCount, gasEstimate: out.result };
}

// ------------------------ Express app ------------------------
const app = express();
app.use(bodyParser.json({ limit: '4mb' }));

// --- Ingest proofs from sidecar ---
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

// --- Fetch aggregation ---
app.get('/aggregate/:reqId', (req, res) => {
  const agg = store.get(req.params.reqId);
  if (!agg) return res.status(404).json({ error: 'not found' });
  res.json(agg);
});

// ------------------------ Orchestrator: auto-finalize ------------------------
async function monitorWorkflows() {
  console.log('[Orchestrator] Monitoring workflows...');
  setInterval(async () => {
    const now = Date.now();
    for (const [reqId, agg] of store.entries()) {
      if (agg.finalized) continue;

      if (agg.proofs.length && now - agg.lastUpdatedAt > INACTIVITY_TIMEOUT_MS) {
        console.log(`[Orchestrator] [${reqId}] Finalizing workflow...`);
        try {
          // 1. Compute Merkle root
          const tree = computeMerkleRootFromAggregation(agg);
          agg.finalized = { root: tree.root, leafCount: agg.proofs.length, finalizedAt: now };
          console.log(`[Orchestrator] [${reqId}] Merkle root: ${agg.finalized.root}`);

          // 2. Optionally pin proofs to IPFS
          if (ENABLE_IPFS && ipfs) {
            const { cid } = await ipfs.add(JSON.stringify(agg.proofs));
            console.log(`[Orchestrator] [${reqId}] Pinned to IPFS: ${cid}`);
          }

          // 3. Estimate blockchain gas
          if (CHAIN_CONTRACT_ADDRESS) {
            try {
              const rootHex = '0x' + agg.finalized.root; // already computed
              const gasInfo = await estimateGasForRoot(rootHex, agg.finalized.leafCount, CHAIN_CONTRACT_ADDRESS);
              console.log(`[Orchestrator] [${reqId}] Estimated gas to submit root: ${gasInfo.gasEstimate}`);
            } catch (e) {
              console.error(`[Orchestrator] [${reqId}] Gas estimation failed:`, e.message);
            }
          }

        } catch (e) {
          console.error(`[Orchestrator] [${reqId}] Finalization error:`, e.message);
        }
      }
    }
  }, CHECK_INTERVAL_MS);
}

// ------------------------ Start ------------------------
app.listen(PORT, () => {
  console.log(`Aggregator listening on port ${PORT}`); 
  monitorWorkflows().catch(console.error);
});
