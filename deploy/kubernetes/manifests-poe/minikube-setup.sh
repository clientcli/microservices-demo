#!/bin/bash
set -e

# --- Check arguments ---
if [ -z "$1" ]; then
  echo "❌ Usage: $0 <BASE_DIR>"
    exit 1
fi

BASE_DIR=$1

echo "🔑 Creating directories inside Minikube..."
minikube ssh -- "mkdir -p /tmp/poe-circuit-artifacts/poe_js && sudo chmod -R 777 /tmp/poe-circuit-artifacts"

echo "📂 Copying poe-final.zkey..."
minikube cp "$BASE_DIR/src/poe-sidecar/circuit-artifacts/poe-final.zkey" \
  minikube:/tmp/poe-circuit-artifacts/

echo "📂 Copying poe.wasm..."
minikube cp "$BASE_DIR/src/poe-sidecar/circuit-artifacts/poe_js/poe.wasm" \
  minikube:/tmp/poe-circuit-artifacts/poe_js/

echo "✅ Done! Files are available in /tmp/poe-circuit-artifacts inside Minikube."
