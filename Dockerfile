# syntax=docker/dockerfile:1
# Portfolio — image de production (Next.js standalone).
# Base glibc (node:24-slim) et non alpine : better-sqlite3, sharp et ffmpeg
# (phases suivantes) y trouvent des binaires précompilés / paquets Debian.

ARG NODE_VERSION=24

# ---- deps : dépendances exactes du lockfile ---------------------------------
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# Futur module natif sans binaire précompilé : décommenter.
# RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
#     && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# --ignore-scripts : aucune dépendance n'a besoin de script d'installation
# (better-sqlite3 13 embarque ses binaires N-API précompilés dans prebuilds/,
# sharp passe par des paquets optionnels). Sans ce drapeau, npm tente
# `node-gyp rebuild` sur better-sqlite3, impossible sans Python dans l'image.
# ATTENTION : un futur paquet qui a besoin de son postinstall (ex. ffmpeg-static,
# qui télécharge son binaire) casserait EN SILENCE. L'ajouter explicitement :
#   RUN npm rebuild <paquet>
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --ignore-scripts

# ---- builder : next build ----------------------------------------------------
FROM node:${NODE_VERSION}-slim AS builder
WORKDIR /app
# Plafond du tas V8 pendant next build : protège la VM de dev (3,8 Go, hôte
# Proxmox en surallocation). La CI passe une valeur plus haute en build-arg.
ARG NODE_MAX_OLD_SPACE=1024
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=${NODE_MAX_OLD_SPACE}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Garde-fou : ni base ni médias de dev dans le standalone (./data est exclu du
# contexte par .dockerignore ; ce test échoue si ça change un jour).
RUN npm run build && test ! -e .next/standalone/data

# ---- runner : serveur standalone minimal -------------------------------------
FROM node:${NODE_VERSION}-slim AS runner
WORKDIR /app

LABEL org.opencontainers.image.source="https://github.com/Themlaw/portfolio" \
      org.opencontainers.image.title="portfolio" \
      org.opencontainers.image.description="Portfolio d'artiste (Next.js standalone)"

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data

# Futur : RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
#     && rm -rf /var/lib/apt/lists/*

# Code applicatif possédé par root (lecture seule pour l'utilisateur node).
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Migrations (appliquées au démarrage) et sources du seed initial.
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/seed ./seed

# /data : seul emplacement inscriptible (portfolio.db, media/).
# .next/cache : inutilisé (ISR en mémoire, isrFlushToDisk: false) ; tmpfs
# conservé en --read-only par précaution.
RUN mkdir -p /data /app/.next/cache \
    && chown node:node /data /app/.next/cache
VOLUME /data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/fr').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]
