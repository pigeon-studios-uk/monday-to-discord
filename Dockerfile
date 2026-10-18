# Monday to Discord. No dependencies, so the image is just Node.js and the source.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY src ./src

# Run as the unprivileged "node" user that the image provides.
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" >/dev/null || exit 1

# Rules come from /app/config.json (mount it) or the RULES_JSON environment variable.
CMD ["node", "src/index.js"]
