# zk-poe-sidecar

HTTP sidecar for generating and verifying Groth16 proofs with snarkjs.

## Endpoints

- POST `/prove`
  - Body: `{ "input": { ... }, "wasmPath?": "/zk/circuit.wasm", "zkeyPath?": "/zk/circuit_final.zkey" }`
  - Response: `{ proof, publicSignals }`

- POST `/verify`
  - Body: `{ proof, publicSignals, "vkeyPath?": "/zk/verification_key.json" }`
  - Response: `{ valid: true|false }`

- GET `/healthz`

## Environment

- `PORT` (default: `8088`)
- `ZK_WASM_PATH` (default: `/zk/circuit.wasm`)
- `ZK_ZKEY_PATH` (default: `/zk/circuit_final.zkey`)
- `ZK_VKEY_PATH` (default: `/zk/verification_key.json`)

Artifacts should be mounted at `/zk` via a shared volume. An initContainer can download them from `ZK_CIRCUITS_URL` into `/zk`.

## Docker

Build and run locally:

```bash
docker build -t zk-poe-sidecar:latest ./zk-poe-sidecar
docker run --rm -p 8088:8088 -v "$PWD/circuits:/zk:ro" zk-poe-sidecar:latest
```

