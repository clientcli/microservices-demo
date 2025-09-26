#!/bin/bash

# Build script for microservices with ZKP data length tracking
# This script rebuilds the Docker images for orders, payment, and sidecar services

set -e

echo "Building Docker images for ZKP data length tracking..."

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Build orders service
echo "Building orders service..."
cd src/orders
GROUP=dev COMMIT=latest ./scripts/build.sh
echo "✓ Orders service built"

# Build payment service  
echo "Building payment service..."
cd "$SCRIPT_DIR/src/payment"
GROUP=dev COMMIT=latest ./scripts/build.sh
echo "✓ Payment service built"

# Build POE sidecar
echo "Building POE sidecar..."
cd "$SCRIPT_DIR/src/poe-sidecar"
docker build --no-cache -t dev/sidecar .
echo "✓ POE sidecar built"

echo ""
echo "All images built successfully!"
echo ""
echo "Images created:"
echo "  - dev/orders (orders service with data length tracking)"
echo "  - dev/payment (payment service with data length tracking)" 
echo "  - dev/sidecar (POE sidecar with enhanced logging)"
echo ""
echo "To start the services with ZKP profiling:"
echo "  docker-compose -f deploy/docker-compose/docker-compose.poe.yml up"
echo ""
echo "To analyze data lengths after running:"
echo "  python3 src/poe-sidecar/analyze_data_lengths.py"
