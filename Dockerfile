# syntax=docker/dockerfile:1
# Portfolio — image de production (Next.js standalone), durcie et découpée.
#
# Exécution : distroless (gcr.io/distroless/nodejs24-debian13) : ni shell, ni
# apt/dpkg, ni binaire setuid. ffmpeg, ffprobe, nice, pdfinfo et pdftoppm
# viennent des paquets Debian (même version de Debian que la base : glibc
# identique) avec leurs seules bibliothèques, collectées par ldd.
#
# Couches, de la plus stable à la plus volatile (une modification de code ne
# change que les deux dernières) :
#   1. base distroless (node 24)                 mise à jour de sécurité
#   2. ffmpeg, poppler (pdfinfo, pdftoppm),
#      nice + bibliothèques                      mise à jour de sécurité
#   3. comptes et /data (1000:1000)              jamais
#   4. node_modules tracées du standalone        changement de dépendances
#   5. migrations et seed                        nouvelle migration
#   6. public/                                   rare
#   7. .next/static                              code client
#   8. server.js + .next/server                  tout changement de code
# Toutes les copies sont en COPY --link (couche indépendante de la précédente,
# même digest à contenu égal) avec propriétaire explicite ; les dates sont
# normalisées à la sortie (rewrite-timestamp=true + SOURCE_DATE_EPOCH, voir
# .github/workflows/docker.yml et le README).

ARG NODE_VERSION=24
ARG DEBIAN_RELEASE=trixie
ARG DISTROLESS=gcr.io/distroless/nodejs24-debian13

# ---- deps : dépendances exactes du lockfile ---------------------------------
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
# --ignore-scripts : aucune dépendance n'a besoin de script d'installation
# (better-sqlite3 13 embarque ses binaires N-API précompilés dans prebuilds/,
# sharp passe par des paquets optionnels). Sans ce drapeau, npm tente
# `node-gyp rebuild` sur better-sqlite3, impossible sans Python dans l'image.
# ATTENTION : un futur paquet qui a besoin de son postinstall (ex. ffmpeg-static,
# qui télécharge son binaire) casserait EN SILENCE. L'ajouter explicitement :
#   RUN npm rebuild <paquet>
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --ignore-scripts

# ---- builder : next build, puis séparation dépendances / code ----------------
FROM node:${NODE_VERSION}-slim AS builder
WORKDIR /app
# Plafond du tas V8 pendant next build : protège la VM de dev (3,8 Go, hôte
# Proxmox en surallocation). La CI passe une valeur plus haute en build-arg.
ARG NODE_MAX_OLD_SPACE=1024
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=${NODE_MAX_OLD_SPACE}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build à mémoire réduite pour un `docker build` local sur la VM de dev :
# --build-arg LOW_MEM_BUILD=1 applique les réglages de `npm run build:local`
# (typecheck avant le build, un worker sans threads, allocateur de Turbopack
# en restitution immédiate). La CI ne passe pas l'argument (build normal).
ARG LOW_MEM_BUILD=0
# Garde-fou : ni base ni médias de dev dans le standalone (./data est exclu du
# contexte par .dockerignore ; ce test échoue si ça change un jour).
# .next/standalone mélange node_modules (stables) et code (volatil) : on les
# sépare pour en faire deux couches. Il contient aussi des copies identiques de
# .next/static, public/, drizzle/ et seed/ : retirées du code, elles ont leur
# propre couche. Droits normalisés (Next écrit certains manifestes en 0666) :
# rien n'est inscriptible par l'utilisateur 1000 hors /data.
RUN if [ "$LOW_MEM_BUILD" = "1" ]; then npm run build:local; else npm run build; fi \
    && test ! -e .next/standalone/data \
    && mkdir -p /out/deps /out/app \
    && mv .next/standalone/node_modules /out/deps/node_modules \
    && cp -a .next/standalone/. /out/app/ \
    && rm -rf /out/app/.next/static /out/app/public /out/app/drizzle /out/app/seed \
    && chmod -R u=rwX,go=rX /out .next/static public drizzle seed

# ---- ffmpeg : binaires Debian et leur fermeture de bibliothèques -------------
# (nom de stage historique : il porte aussi pdfinfo / pdftoppm de poppler-utils,
# pour l'aperçu des PDF du bloc CV — pas de moteur JavaScript, pas de réseau).
FROM debian:${DEBIAN_RELEASE}-slim AS ffmpeg
# Paquets déjà présents dans la base distroless : leurs bibliothèques ne sont
# PAS copiées (on garde celles de la base, cohérentes avec son glibc).
ARG BASE_PACKAGES="base-files ca-certificates gcc-14-base libc6 libgcc-s1 libgomp1 libssl3t64 libstdc++6 libzstd1 media-types netbase tzdata tzdata-legacy zlib1g"
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg poppler-utils \
    && rm -rf /var/lib/apt/lists/*
# Fermeture ldd de ffmpeg, ffprobe, nice (coreutils), pdfinfo et pdftoppm
# (poppler-utils), copiée DÉRÉFÉRENCÉE au
# chemin du soname (pas de lien vers /etc/alternatives, absent de l'image : cas
# de libblas.so.3 / liblapack.so.3). Pour chaque paquet
# Debian concerné, son enregistrement dpkg va dans /var/lib/dpkg/status.d/
# (convention distroless) : les scanners (Trivy, Grype) voient les versions
# Debian réelles et leurs CVE.
RUN set -eu; \
    out=/out; lib=/usr/lib/x86_64-linux-gnu; \
    mkdir -p "$out/usr/bin" "$out$lib" "$out/var/lib/dpkg/status.d"; \
    cp -a /usr/bin/ffmpeg /usr/bin/ffprobe /usr/bin/nice /usr/bin/pdfinfo /usr/bin/pdftoppm "$out/usr/bin/"; \
    pkgs="ffmpeg coreutils poppler-utils"; \
    for so in $(ldd /usr/bin/ffmpeg /usr/bin/ffprobe /usr/bin/nice /usr/bin/pdfinfo /usr/bin/pdftoppm | awk '$2 == "=>" && $3 ~ /^\// {print $3}' | sort -u); do \
      case "$so" in /lib/*|/lib64/*) so="/usr$so" ;; esac; \
      real=$(readlink -f "$so"); \
      pkg=$(dpkg -S "$so" 2>/dev/null | head -1 | cut -d: -f1 || true); \
      [ -n "$pkg" ] || pkg=$(dpkg -S "$real" | head -1 | cut -d: -f1); \
      case " $BASE_PACKAGES " in *" $pkg "*) continue ;; esac; \
      mkdir -p "$out$(dirname "$so")"; cp -L --preserve=mode,timestamps "$so" "$out$so"; \
      pkgs="$pkgs $pkg"; \
    done; \
    for p in $(echo $pkgs | tr ' ' '\n' | sort -u); do \
      dpkg-query -s "$p" > "$out/var/lib/dpkg/status.d/$p"; \
      for m in "/var/lib/dpkg/info/$p.md5sums" "/var/lib/dpkg/info/$p:amd64.md5sums"; do \
        [ -f "$m" ] && cp "$m" "$out/var/lib/dpkg/status.d/$p.md5sums" || true; \
      done; \
    done; \
    echo "ffmpeg + poppler : $(find "$out/usr/lib" -type f | wc -l) bibliothèques, $(echo $pkgs | tr ' ' '\n' | sort -u | wc -l) paquets, $(du -sh "$out" | cut -f1)"

# ---- fs : comptes et squelette de /data --------------------------------------
FROM ${DISTROLESS} AS distroless
FROM debian:${DEBIAN_RELEASE}-slim AS fs
COPY --from=distroless /etc/passwd /etc/group /base/
# Comptes de la base distroless + « app » (1000:1000), sans shell de connexion.
# /data existe dans l'image, possédé par 1000:1000 : Docker initialise un volume
# nommé VIDE avec ce contenu et ces propriétaires (le conteneur peut écrire du
# premier coup). media/ et tmp/ sont créés d'avance pour la même raison.
RUN set -eu; mkdir -p /out/etc /out/data/media /out/data/tmp; \
    { cat /base/passwd; echo 'app:x:1000:1000:portfolio:/nonexistent:/sbin/nologin'; } > /out/etc/passwd; \
    { cat /base/group; echo 'app:x:1000:'; } > /out/etc/group; \
    chmod 0644 /out/etc/passwd /out/etc/group; chmod 0750 /out/data /out/data/media /out/data/tmp

# ---- runner : distroless ------------------------------------------------------
FROM ${DISTROLESS} AS runner

LABEL org.opencontainers.image.source="https://github.com/Themlaw/portfolio" \
      org.opencontainers.image.title="portfolio" \
      org.opencontainers.image.description="Portfolio d'artiste (Next.js standalone, distroless)"

# Allocateur glibc : sans ces réglages, les grosses images décodées (sharp) laissent le tas
# fragmenté et le processus garde ~350 Mo de plus (mesuré : pic anonyme 929 → 585 Mo sur un PNG
# entrelacé 20000 × 4000, conteneur de 1 Gio). Gros blocs rendus à l'OS aussitôt libérés.
ENV MALLOC_ARENA_MAX=2 \
    MALLOC_MMAP_THRESHOLD_=131072 \
    MALLOC_TRIM_THRESHOLD_=131072
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data
WORKDIR /app

# 2. ffmpeg / ffprobe / nice / pdfinfo / pdftoppm (paquets Debian : correctifs
#    de sécurité suivis à chaque reconstruction, sans somme de contrôle à tenir à jour).
COPY --link --from=ffmpeg /out/ /
# 3. Comptes et /data (seul emplacement inscriptible, avec les tmpfs).
COPY --link --from=fs /out/etc/ /etc/
COPY --link --from=fs --chown=1000:1000 /out/data /data
# 4 → 8. Code applicatif possédé par root, en lecture seule pour 1000.
COPY --link --from=builder --chown=0:0 /out/deps/ /app/
COPY --link --from=builder --chown=0:0 /app/drizzle /app/drizzle
COPY --link --from=builder --chown=0:0 /app/seed /app/seed
# Restauration d'une sauvegarde (docs/SAUVEGARDES.md) : l'image n'a ni shell ni tar.
COPY --link --from=builder --chown=0:0 /app/scripts/restore-backup.mjs /app/restore-backup.mjs
COPY --link --from=builder --chown=0:0 /app/public /app/public
COPY --link --from=builder --chown=0:0 /app/.next/static /app/.next/static
COPY --link --from=builder --chown=0:0 /out/app/ /app/

VOLUME /data
USER 1000:1000
EXPOSE 3000

# Sonde en exec (node), sans shell.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/fr').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Point d'entrée de la base : /nodejs/bin/node.
CMD ["server.js"]
