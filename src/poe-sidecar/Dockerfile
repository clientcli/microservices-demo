FROM node:20-bullseye-slim

# Install global CLI used by the sidecar
RUN npm install -g snarkjs@latest

# Create workdir
WORKDIR /app

# Install runtime deps (no local package.json present)
# Note: node-fetch v3 is ESM-only; pin v2 for CommonJS require()
RUN npm install --no-audit --no-fund express body-parser node-fetch@2

# Copy sidecar source
COPY index.js ./

# Circuit artifacts will be mounted at runtime to /opt/circuit
ENV CIRCUIT_DIR=/opt/circuit
VOLUME ["/opt/circuit"]

EXPOSE 8089

CMD ["node", "index.js"]