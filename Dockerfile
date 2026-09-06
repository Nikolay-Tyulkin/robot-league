# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build:container && npm run build:server

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 STATIC_DIR=/app/public
COPY --from=build --chown=node:node /app/.server-build ./server-dist
COPY --from=build --chown=node:node /app/node_modules/ws ./node_modules/ws
COPY --from=build --chown=node:node /app/dist/client ./public
COPY --chown=node:node package.json LICENSE LICENSES.md THIRD_PARTY_NOTICES.md ./
COPY --chown=node:node LICENSES ./LICENSES
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node --input-type=module -e "const r = await fetch('http://127.0.0.1:' + process.env.PORT + '/healthz'); if (!r.ok) process.exit(1)"
CMD ["node", "server-dist/server/index.js"]
