# Use Node 22 LTS for Hardhat 3.x
FROM node:22-bullseye

WORKDIR /app

# Copy project files
COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .

EXPOSE 8545

# Start Hardhat node when container runs
CMD ["npx", "hardhat", "node", "--hostname", "0.0.0.0"]
