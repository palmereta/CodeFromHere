# Web edition. Build:  docker build -t codefromhere .
# Run:   docker run -p 3000:3000 -v cfh-data:/data -e ENCRYPTION_KEY=... -e SESSION_SECRET=... codefromhere
FROM node:24-bookworm-slim AS build
WORKDIR /app
# node-pty has no Linux prebuilds: compile it here.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production CFH_DATA_DIR=/data PORT=3000 HOST=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends tini openssh-client && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 cfh && mkdir -p /data && chown cfh:cfh /data
WORKDIR /app
COPY --from=build --chown=cfh:cfh /app/package.json /app/server.js ./
COPY --from=build --chown=cfh:cfh /app/src ./src
COPY --from=build --chown=cfh:cfh /app/dist ./dist
COPY --from=build --chown=cfh:cfh /app/node_modules ./node_modules
USER cfh
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
