# CoinGraph — one image, two roles. Railway runs two services from this repo:
#   web    (SERVICE_ROLE=web, default) → Next.js site + API
#   worker (SERVICE_ROLE=worker)       → data pipeline (supervised, restarts itself)
FROM node:20-alpine

WORKDIR /app
RUN apk add --no-cache bash

COPY package.json package-lock.json ./
# tsx (used by the worker) is a dev dependency, so install everything.
RUN npm ci --include=dev

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Web binds to Railway's $PORT; the worker ignores it.
CMD ["sh", "-c", "if [ \"$SERVICE_ROLE\" = \"worker\" ]; then npm run worker:supervised; else npx next start -p ${PORT:-3000}; fi"]
