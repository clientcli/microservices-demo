FROM node:20-bullseye

WORKDIR /app

# Install build tools
RUN apt-get update && apt-get install -y python3 make g++ git \
  && rm -rf /var/lib/apt/lists/*

# Init package.json with type=module (for imports)
RUN npm init -y && npm pkg set type="module"

# Install dependencies
RUN npm install express body-parser node-fetch@2 ipfs-http-client @noble/hashes

# Copy source
COPY . .

ENV AGGREGATOR_PORT=8090

EXPOSE 8090

CMD ["node", "auto-test.js"]
