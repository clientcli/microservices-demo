FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# Copy app source
COPY . .

EXPOSE 8088

# Run as non-root for security
USER node

CMD ["node", "index.js"]

