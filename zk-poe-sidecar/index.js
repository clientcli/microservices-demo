"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const { groth16 } = require("snarkjs");

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT ? Number(process.env.PORT) : 8088;
const DEFAULT_WASM_PATH = process.env.ZK_WASM_PATH || "/zk/circuit.wasm";
const DEFAULT_ZKEY_PATH = process.env.ZK_ZKEY_PATH || "/zk/circuit_final.zkey";
const DEFAULT_VKEY_PATH = process.env.ZK_VKEY_PATH || "/zk/verification_key.json";

function assertFileReadable(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    const err = new Error(`File not found: ${resolvedPath}`);
    err.statusCode = 400;
    throw err;
  }
  fs.accessSync(resolvedPath, fs.constants.R_OK);
  return resolvedPath;
}

app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/prove", async (req, res) => {
  try {
    const input = req.body && req.body.input;
    if (!input || typeof input !== "object") {
      return res.status(400).json({ error: "Missing or invalid 'input' in body" });
    }

    const wasmPath = assertFileReadable(req.body.wasmPath || DEFAULT_WASM_PATH);
    const zkeyPath = assertFileReadable(req.body.zkeyPath || DEFAULT_ZKEY_PATH);

    const { proof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath);
    return res.status(200).json({ proof, publicSignals });
  } catch (error) {
    const status = error && error.statusCode ? error.statusCode : 500;
    return res.status(status).json({ error: error.message || String(error) });
  }
});

app.post("/verify", async (req, res) => {
  try {
    const { proof, publicSignals } = req.body || {};
    if (!proof || !publicSignals) {
      return res.status(400).json({ error: "Missing 'proof' or 'publicSignals' in body" });
    }

    const vkeyPath = assertFileReadable(req.body.vkeyPath || DEFAULT_VKEY_PATH);
    const vKey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));
    const ok = await groth16.verify(vKey, publicSignals, proof);
    return res.status(200).json({ valid: Boolean(ok) });
  } catch (error) {
    const status = error && error.statusCode ? error.statusCode : 500;
    return res.status(status).json({ error: error.message || String(error) });
  }
});

app.use((err, _req, res, _next) => {
  const status = err && err.statusCode ? err.statusCode : 500;
  res.status(status).json({ error: err.message || String(err) });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`zk-poe-sidecar listening on ${PORT}`);
});

