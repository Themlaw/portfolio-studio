#!/usr/bin/env bash
# Exécute UNE suite e2e en CI (GitHub Actions) : serveur dev neuf sur une base
# neuve (dans $RUNNER_TEMP), pré-chauffé (routes publiques et admin avec une
# session), puis la commande de la suite. Journal de la suite et du serveur
# dans $RUNNER_TEMP/logs, captures dans $RUNNER_TEMP/shots/<id>.
# Usage : .github/scripts/e2e.sh <id> <commande…>
# BATT_SERVER=start : au lieu de `next dev`, démarre le serveur standalone du build
# déjà fait (`npm run build:local`, dossier .next/standalone) : pas de compilation
# à froid, pas de pré-chauffage. Défaut `dev` (CI et usage historique).
set -uo pipefail

ID=$1
shift
ROOT_TMP=${RUNNER_TEMP:-/tmp}
PORT=${PORT:-3001}
export BASE="http://localhost:$PORT"
export DATA_DIR="${DATA_DIR:-$ROOT_TMP/data-$ID}"
export SHOTS="${SHOTS:-$ROOT_TMP/shots/$ID}"
export ADMIN_EMAIL="${ADMIN_EMAIL:-ci-admin@example.test}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-ci-mot-de-passe-de-test-42}"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-ci-secret-0123456789abcdef-0123456789abcdef}"
export NEXT_TELEMETRY_DISABLED=1
# ONLY vide = suite complète (certains scripts lisent `ONLY ?? "AB"` : ne pas passer "").
[ -z "${ONLY:-}" ] && unset ONLY
MODE=${BATT_SERVER:-dev}
SA=${STANDALONE_DIR:-$PWD/.next/standalone}
LOGS="$ROOT_TMP/logs"
mkdir -p "$LOGS" "$SHOTS"
rm -rf "$DATA_DIR"
mkdir -p "$DATA_DIR"

# Groupe de processus à part (setsid) : npx, next dev et ses workers arrêtés ensemble.
start_dev() {
  # PORTFOLIO_DEV=1 : mode développement explicite (aperçu de thème ouvert, secret de dev ; src/lib/dev-mode.ts).
  PORTFOLIO_DEV=1 setsid npx next dev -p "$PORT" >>"$LOGS/$ID-server.log" 2>&1 &
  DEV=$!
}
# Serveur de production : standalone + ressources que l'image Docker y copie
# (préparées une fois par la batterie ; ici seulement si absentes).
start_prod() {
  [ -f "$SA/server.js" ] || { echo "::error::standalone absent ($SA) : lancer npm run build:local"; exit 1; }
  for d in drizzle seed public; do [ -d "$SA/$d" ] || cp -a "$d" "$SA/$d"; done
  [ -d "$SA/.next/static" ] || cp -a .next/static "$SA/.next/static"
  (cd "$SA" && NODE_ENV=production HOSTNAME=127.0.0.1 PORT="$PORT" PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-$BASE}" \
    exec setsid node server.js >>"$LOGS/$ID-server.log" 2>&1) &
  DEV=$!
}
stop() { kill -- -"$DEV" 2>/dev/null; wait "$DEV" 2>/dev/null || true; }
trap stop EXIT

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 180 "$@"; }

# Prêt = /fr en 200. Abandon après 3 min, ou 10 réponses 500 d'affilée (ex. police
# Google non téléchargée par Turbopack : l'erreur reste en cache jusqu'au redémarrage).
wait_ready() {
  local errors=0 end=$(($(date +%s) + 180)) c
  while [ "$(date +%s)" -lt $end ]; do
    kill -0 "$DEV" 2>/dev/null || return 1
    c=$(code "$BASE/fr")
    [ "$c" = 200 ] && return 0
    if [ "$c" = 500 ]; then errors=$((errors + 1)); [ $errors -ge 10 ] && return 1; else errors=0; fi
    sleep 2
  done
  return 1
}

if [ "$MODE" = start ]; then
  echo "::group::Démarrage du serveur de production"
  t0=$(date +%s)
  start_prod
  ready=0
  end=$(($(date +%s) + 60))
  while [ "$(date +%s)" -lt $end ]; do
    kill -0 "$DEV" 2>/dev/null || break
    [ "$(code "$BASE/fr")" = 200 ] && { ready=1; break; }
    sleep 1
  done
  if [ $ready != 1 ]; then
    echo "::error::serveur de production non prêt"
    tail -n 80 "$LOGS/$ID-server.log"
    exit 1
  fi
  echo "prêt en $(($(date +%s) - t0)) s"
  echo "::endgroup::"
else
echo "::group::Démarrage et pré-chauffage du serveur dev"
t0=$(date +%s)
ready=0
start_dev
for attempt in 1 2 3; do
  wait_ready && { ready=1; break; }
  echo "::warning::serveur dev non prêt (essai $attempt) : redémarrage, cache .next/dev effacé"
  tail -n 15 "$LOGS/$ID-server.log"
  stop
  rm -rf .next/dev
  [ $attempt -lt 3 ] && start_dev
done
if [ $ready != 1 ]; then
  echo "::error::serveur dev non prêt"
  tail -n 80 "$LOGS/$ID-server.log"
  exit 1
fi
echo "prêt en $(($(date +%s) - t0)) s"

# Routes publiques (compilation Turbopack à la demande).
for p in /fr /en /fr/personnages /en/characters /fr/a-propos /admin/connexion; do
  echo "$p → $(code "$BASE$p")"
done
# Une session (1 connexion sur les 5/min autorisées) pour compiler l'admin.
JAR="$ROOT_TMP/jar-$ID"
curl -s -o /dev/null -c "$JAR" -H "content-type: application/json" -H "origin: $BASE" \
  --data "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/auth/sign-in/email"
for p in /admin /admin/pages /admin/projets /admin/medias /admin/themes /admin/reglages /admin/messages; do
  echo "$p → $(code -b "$JAR" "$BASE$p")"
done
echo "pré-chauffé en $(($(date +%s) - t0)) s"
echo "::endgroup::"
fi

set +e
"$@" 2>&1 | tee "$LOGS/$ID.log"
status=${PIPESTATUS[0]}

pass=$(grep -cE '^PASS\b' "$LOGS/$ID.log" || true)
fail=$(grep -cE '^FAIL\b' "$LOGS/$ID.log" || true)
echo "$ID status=$status pass=$pass fail=$fail"
exit "$status"
