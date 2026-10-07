# CoinGraph Coworker worker (hosted). Node 24 runs the .ts payment module natively.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
# One executor per Coworker: run exactly one replica. State (journals, results) lives on a volume at COWORKER_STATE_DIR.
CMD ["node", "src/paid-worker.mjs", "--poll"]
