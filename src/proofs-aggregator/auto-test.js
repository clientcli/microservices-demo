import express from 'express';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import { blake3 } from '@noble/hashes/blake3.js';
import { create as createIpfs } from 'ipfs-http-client';

// --- Config ---
const PORT = parseInt(process.env.AGGREGATOR_PORT || '8090', 10);
const CHAIN_CONTRACT_ADDRESS = process.env.CHAIN_CONTRACT_ADDRESS || null;
const ETH_RPC_URL = process.env.ETH_RPC_URL || null;
const ENABLE_IPFS = process.env.ENABLE_IPFS === 'true';
const IPFS_URL = process.env.IPFS_URL || 'http://localhost:5001';
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS || '30000'); // 30 sec
const INACTIVITY_TIMEOUT_MS = parseInt(process.env.INACTIVITY_TIMEOUT_MS || '420000'); // 7 min

const ipfs = ENABLE_IPFS ? createIpfs({ url: IPFS_URL }) : null;

// --- Store ---
const store = new Map();

// --- Helpers ---
function upsertAggregation(reqId) {
  if (!store.has(reqId)) {
    store.set(reqId, {
      reqId,
      events: [],
      proofs: [],
      createdAt: Date.now(),
      lastUpdatedAt: Date.now()
    });
  }
  return store.get(reqId);
}

// function blake3Hex(data) {
//   const buf = typeof data === 'string'
//     ? Buffer.from(data)
//     : Buffer.isBuffer(data)
//       ? data
//       : Buffer.from(JSON.stringify(data));
//   return Buffer.from(blake3(buf)).toString('hex');
// }

function buildMerkleTreeBLAKE3(leaves) {
  if (!leaves.length) return { root: null, levels: [] };
  let level = leaves.slice();
  const levels = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left;
      const combined = Buffer.concat([
        Buffer.from(left, 'hex'),
        Buffer.from(right, 'hex')
      ]);
      next.push(Buffer.from(blake3(combined)).toString('hex'));
    }
    level = next;
    levels.push(level);
  }
  return { root: level[0], levels };
}

function computeMerkleRootFromAggregation(agg) {
  const leaves = agg.proofs.map(p => {
    const buf = Buffer.from(JSON.stringify({
      meta: p.meta,
      proof: p.proof,
      pub: p.pub
    }));
    return Buffer.from(blake3(buf)).toString('hex');
  });
  return buildMerkleTreeBLAKE3(leaves);
}

// --- App ---
const app = express();
app.use(bodyParser.json({ limit: '4mb' }));

// Ingest proofs
app.post('/ingest/proof', (req, res) => {
  console.log('ingest/proof', req.body.reqId);
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

// Fetch aggregation
app.get('/aggregate/:reqId', (req, res) => {
  const agg = store.get(req.params.reqId);
  if (!agg) return res.status(404).json({ error: 'not found' });
  res.json(agg);
});

// Monitor workflows
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
              console.log('Estimating gas for rootHex', rootHex)
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
  console.log('payload', payload)

  console.log('Sending request to ETH_RPC_URL', ETH_RPC_URL)
  const resp = await fetch(ETH_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const out = await resp.json();
  if (out.error) throw new Error(JSON.stringify(out.error));
  return { root: rootHex, leafCount, gasEstimate: out.result };
}

// Start
app.listen(PORT, () => {
  console.log(`Aggregator + Orchestrator listening on port ${PORT}`);
  monitorWorkflows().catch(console.error);
});
