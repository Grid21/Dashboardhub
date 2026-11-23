# Dashboard Hub for Docker. Build from the folder ABOVE this one (docker-compose.yml does that for you).
FROM node:24-bookworm-slim

# ping and the network tools the scanner uses
RUN apt-get update \
 && apt-get install -y --no-install-recommends iputils-ping iproute2 net-tools ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# only what the Docker version needs (no Electron, no desktop window)
COPY package.json scanner.js discovery.js notif-history.js remote.js ./
COPY vendor/oui.json ./vendor/oui.json
COPY docker/server.js ./docker/server.js

ENV DASHBOARD_HUB_SRC=/app \
    DASHBOARD_HUB_DATA=/data \
    NODE_ENV=production

VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const p=process.env.DASHBOARD_HUB_PORT||8787;require('http').get('http://127.0.0.1:'+p+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "docker/server.js"]
