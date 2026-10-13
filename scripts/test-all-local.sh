#!/usr/bin/env bash
# Batterie complète en LOCAL (remplace GitHub Actions, voir docs/ARCHITECTURE.md) : mêmes
# jobs que .github/workflows/tests.yml. Le verrou /root/heavy.lock est pris UNE
# fois pour toute la batterie (il exclut les charges extérieures ; il ne
# sérialise plus les suites entre elles).
# Journaux : /root/battery-logs/<date>/<suite>.log ; récapitulatif PASS/FAIL à la fin.
# Continue après un échec ; code de sortie 1 si une suite a échoué.
#
# Usage (depuis le dépôt) :
#   scripts/test-all-local.sh [suite…]      # vide = toutes
#   ids : checks build auth pdf v013 lot1 lot8 lot11 state palette look themes kit kit17a kithttp cartes17c texte19a palogo17f integ17 editor boards admin medias medias-firefox 17b crop17d crop17d-http crop17g
# Rapide (VM de 3 cœurs et plus, voir docs/ARCHITECTURE.md) :
#   BATT_SERVER=start BATT_JOBS=2 scripts/test-all-local.sh
# En fond détaché :
#   ssh -f vm-dev 'cd ~/wt/lot1 && setsid nohup scripts/test-all-local.sh >/root/battery.out 2>&1 </dev/null'
# Variables :
#   BATT_SERVER  dev (défaut : `next dev` par suite, comme la CI) | start (un seul build, puis
#                `node .next/standalone/server.js` par suite ; les suites de BATT_DEV_ONLY restent en dev)
#   BATT_JOBS    nombre de suites e2e simultanées (défaut 1). > 1 exige BATT_SERVER=start : deux
#                `next dev` ne peuvent pas partager le dossier .next. Ports PORT..PORT+N-1.
#   BATT_DEV_ONLY suites forcées en dev en mode start (défaut : voir plus bas ; ne tournent jamais en parallèle)
#   BATT_REUSE_BUILD=1  mode start : ne reconstruit pas si .next/standalone existe déjà
#   PORT (3121), LOCK (/root/heavy.lock ; vide = aucun verrou), LOCK_WAIT (secondes, 3600), BATTERY_DIR,
#   BATT_PREFIX (/root/pf-batt : dossiers de travail des suites e2e, à distinguer entre batteries en parallèle).
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1090
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"

PORT=${PORT:-3121}
LOCK=${LOCK-/root/heavy.lock}
LOCK_WAIT=${LOCK_WAIT:-3600}
BATT_SERVER=${BATT_SERVER:-dev}
BATT_JOBS=${BATT_JOBS:-1}
export BATTERY_DIR=${BATTERY_DIR:-/root/battery-logs/$(date +%Y-%m-%d_%H%M)}
# Suites qui exigent `next dev` (voir docs/ARCHITECTURE.md, « Mode start »). Elles passent par /api/theme-preview, fermée (404) en production.
BATT_DEV_ONLY=${BATT_DEV_ONLY-v013 lot11 themes}
# Suites lourdes : toujours seules (RAM, ffmpeg, navigateurs multiples).
HEAVY_IDS=" checks build auth medias medias-firefox "

case "$BATT_SERVER" in dev | start) ;; *) echo "BATT_SERVER doit valoir dev ou start" >&2; exit 2 ;; esac
case "$BATT_JOBS" in '' | *[!0-9]* | 0) echo "BATT_JOBS doit être un entier >= 1" >&2; exit 2 ;; esac
if [ "$BATT_SERVER" = dev ] && [ "$BATT_JOBS" -gt 1 ]; then
  echo "BATT_JOBS > 1 exige BATT_SERVER=start (un seul next dev par dossier .next)" >&2
  exit 2
fi

# Verrou unique pour toute la batterie (relance du script sous flock).
if [ -n "$LOCK" ] && [ -z "${BATT_LOCKED:-}" ]; then
  exec flock -w "$LOCK_WAIT" "$LOCK" env BATT_LOCKED=1 bash "$0" "$@"
fi

export NODE_OPTIONS=${NODE_OPTIONS:---max-old-space-size=1024}
export NEXT_TELEMETRY_DISABLED=1
mkdir -p "$BATTERY_DIR/.res"
rm -f "$BATTERY_DIR/.res/"*

# id|commande|navigateur|ONLY|variables d'environnement du serveur et de la suite (même liste que le job « plan » du workflow)
# 17b : allocateur glibc réglé comme le conteneur (Dockerfile) : la mémoire anonyme mesurée est celle de la prod.
E2E=(
  "v013|node scripts/e2e-v013.mjs|chromium|"
  "lot1|node scripts/e2e-lot1.mjs|chromium|"
  "lot8|node scripts/e2e-lot8.mjs|chromium|"
  "lot11|node scripts/e2e-lot11.mjs|chromium|"
  "state|node scripts/e2e-state.mjs|chromium|"
  "palette|node scripts/e2e-palette.mjs|chromium|"
  "look|node scripts/e2e-look.mjs|chromium|"
  "themes|node scripts/e2e-themes.mjs|chromium|"
  "kit|node scripts/e2e-kit.mjs|chromium|"
  "kit17a|node scripts/e2e-kit-theme.mjs|chromium|"
  "kithttp|node scripts/e2e-kit-http.mjs|chromium|"
  "integ17|node scripts/e2e-integ17.mjs|chromium|"
  "cartes17c|node scripts/e2e-cartes.mjs|chromium|"
  "texte19a|node scripts/e2e-texte.mjs|chromium|"
  "palogo17f|node scripts/e2e-palette-logo.mjs|chromium|"
  "editor|node scripts/e2e-editor.mjs|chromium|"
  "boards|node scripts/e2e-boards.mjs|chromium|"
  "admin|node scripts/e2e-admin.mjs|chromium|"
  "medias|node scripts/e2e-medias.mjs|chromium|"
  "medias-firefox|node scripts/e2e-medias.mjs|firefox|AB"
  "17b|node scripts/e2e-17b.mjs|chromium||MALLOC_ARENA_MAX=2 MALLOC_MMAP_THRESHOLD_=131072 MALLOC_TRIM_THRESHOLD_=131072"
  "crop17d|node scripts/e2e-crop.mjs|chromium|"
  "crop17d-http|node scripts/e2e-crop-http.mjs|chromium|"
  "crop17g|node scripts/e2e-crop.mjs|chromium|F|CROP_WARM=0 CROP_MAX_WAITING=3"
)


WANT=("$@")
want() {
  [ ${#WANT[@]} -eq 0 ] && return 0
  local s
  for s in "${WANT[@]}"; do [ "$s" = "$1" ] && return 0; done
  return 1
}
in_list() { case " $1 " in *" $2 "*) return 0 ;; esac; return 1; }

ALL_IDS=(checks build auth pdf)
for e in "${E2E[@]}"; do ALL_IDS+=("${e%%|*}"); done
T0=$(date +%s)

cooldown() {
  sync
  echo 3 >/proc/sys/vm/drop_caches 2>/dev/null || true
}

# Libère un port avant une suite (reste d'un serveur d'une exécution interrompue).
free_port() {
  local pids
  pids=$(ss -ltnp "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
  if [ -n "$pids" ]; then
    echo "port $1 occupé, arrêt de : $pids"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null
    sleep 2
  fi
  return 0
}

# record <id> <statut> <début> : compte les lignes PASS/FAIL du journal, mémorise le résultat
# (un fichier par suite : sûr quand plusieurs suites tournent en parallèle).
record() {
  local id=$1 st=$2 t=$3 log="$BATTERY_DIR/$1.log" pass=0 fail=0 v=PASS
  if [ -f "$log" ]; then
    pass=$(grep -cE '^PASS\b' "$log" || true)
    fail=$(grep -cE '^FAIL\b' "$log" || true)
  fi
  [ "$st" != 0 ] && v=FAIL
  printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$v" "$pass" "$fail" "$(($(date +%s) - t))" >"$BATTERY_DIR/.res/$id"
  echo "=== $id : $v ($pass PASS, $fail FAIL, $(($(date +%s) - t)) s)"
}

# run_suite <id> <commande> : journal dédié, cooldown ensuite (séquentiel seulement).
run_suite() {
  local id=$1 cmd=$2 t st
  want "$id" || return 0
  t=$(date +%s)
  echo "=== $id : début $(date +%T)"
  bash -c "$cmd" >"$BATTERY_DIR/$id.log" 2>&1
  st=$?
  record "$id" "$st" "$t"
}

# --- checks : tsc, lint, tokens, contraste, thèmes, tests unitaires (npm test) ---
read -r -d '' CHECKS_CMD <<'EOS'
rc=0
for step in "npx tsc --noEmit" "npm run lint" "npm run check:tokens" "npm run check:contrast" "npm run theme:check" "npm test"; do
  echo "##### $step"
  $step || { echo "FAIL checks : $step"; rc=1; }
done
exit $rc
EOS
run_suite checks "$CHECKS_CMD"
cooldown

# --- build de production (standalone) : test:auth, et e2e en mode start (aucun serveur dev lancé) ---
SA="$PWD/.next/standalone"
need_e2e=0
for e in "${E2E[@]}"; do want "${e%%|*}" && need_e2e=1; done
NEED_BUILD=0
want build && NEED_BUILD=1
want auth && NEED_BUILD=1
[ "$BATT_SERVER" = start ] && [ $need_e2e = 1 ] && NEED_BUILD=1
BUILD_OK=0
if [ $NEED_BUILD = 1 ]; then
  if [ "$BATT_SERVER" = start ] && [ "${BATT_REUSE_BUILD:-}" = 1 ] && [ -f "$SA/server.js" ] && ! want build; then
    echo "=== build : standalone existant réutilisé (BATT_REUSE_BUILD=1)"
    BUILD_OK=1
  else
    t=$(date +%s)
    free_port "$PORT"
    echo "=== build : début $(date +%T)"
    bash -c 'npm run build:local && node scripts/check-standalone.mjs --require' >"$BATTERY_DIR/build.log" 2>&1
    st=$?
    [ $st = 0 ] && BUILD_OK=1
    want build && record build "$st" "$t"
    [ $st != 0 ] && ! want build && echo "=== build : ECHEC (voir $BATTERY_DIR/build.log)"
    cooldown
  fi
fi
# Ressources que l'image Docker copie à côté de server.js (partagées par les serveurs en lecture seule).
if [ $BUILD_OK = 1 ]; then
  for d in drizzle seed public; do rm -rf "${SA:?}/$d"; cp -a "$d" "$SA/$d"; done
  rm -rf "$SA/.next/static"
  cp -a .next/static "$SA/.next/static"
fi
if want auth; then
  if [ $BUILD_OK = 1 ]; then
    free_port 3200
    run_suite auth "mkdir -p ${BATT_PREFIX:-/root/pf-batt}-auth && TEST_AUTH_TMP=${BATT_PREFIX:-/root/pf-batt}-auth npm run test:auth"
  else
    echo "FAIL auth : build absent ou en échec" >"$BATTERY_DIR/auth.log"
    record auth 1 "$(date +%s)"
  fi
  cooldown
fi

# --- e2e : serveur et base neufs par suite (RUNNER_TEMP dédié) ---
# run_e2e <entrée> <port> : mode start sauf suite de BATT_DEV_ONLY ou build absent (alors échec explicite).
run_e2e() {
  local id cmd browser only extra port=$2 mode t st rt
  IFS='|' read -r id cmd browser only extra <<<"$1"
  mode=$BATT_SERVER
  in_list "$BATT_DEV_ONLY" "$id" && mode=dev
  rt="${BATT_PREFIX:-/root/pf-batt}-$id"
  rm -rf "$rt"
  mkdir -p "$rt/tmp"
  t=$(date +%s)
  echo "=== $id : début $(date +%T) (port $port, serveur $mode)"
  if [ "$mode" = start ] && [ $BUILD_OK != 1 ]; then
    echo "FAIL $id : build absent ou en échec" >"$BATTERY_DIR/$id.log"
    record "$id" 1 "$t"
    return 0
  fi
  free_port "$port"
  # extra : variables propres à la suite (ex. MALLOC_* de 17b, CROP_* de crop17g), transmises au serveur et à la suite.
  # shellcheck disable=SC2086
  env ${extra:-} TMPDIR="$rt/tmp" RUNNER_TEMP="$rt" BROWSER="$browser" ONLY="$only" PORT="$port" PUBLIC_BASE_URL="http://localhost:$port" \
    BATT_SERVER="$mode" bash -c "bash .github/scripts/e2e.sh $id $cmd" >"$BATTERY_DIR/$id.log" 2>&1
  st=$?
  record "$id" "$st" "$t"
  [ -f "$rt/logs/$id-server.log" ] && cp "$rt/logs/$id-server.log" "$BATTERY_DIR/$id-server.log"
  rm -rf "$rt/data-$id"
}

# Répartition : pool (légères, en parallèle si BATT_JOBS > 1) puis suites seules (lourdes ou dev).
POOL=()
ALONE=()
want pdf && POOL+=("PDF")
for entry in "${E2E[@]}"; do
  id=${entry%%|*}
  want "$id" || continue
  if [ "$BATT_JOBS" -gt 1 ] && ! in_list "$HEAVY_IDS" "$id" && ! { [ "$BATT_SERVER" = start ] && in_list "$BATT_DEV_ONLY" "$id"; }; then
    POOL+=("$entry")
  else
    ALONE+=("$entry")
  fi
done
# JOBS=1 : ordre historique de la liste (pdf d'abord).
if [ "$BATT_JOBS" -le 1 ]; then
  ALONE=("${POOL[@]}" "${ALONE[@]}")
  POOL=()
fi

run_one() { # <entrée ou PDF> <port>
  if [ "$1" = PDF ]; then
    run_suite pdf "node --import tsx scripts/test-pdf.mjs"
  else
    run_e2e "$1" "$2"
  fi
}

if [ ${#POOL[@]} -gt 0 ]; then
  echo "=== pool : ${#POOL[@]} suites, $BATT_JOBS en parallèle (ports $PORT-$((PORT + BATT_JOBS - 1)))"
  declare -a SLOT_PID=()
  for ((k = 0; k < BATT_JOBS; k++)); do SLOT_PID[k]=""; done
  for entry in "${POOL[@]}"; do
    slot=-1
    while [ $slot -lt 0 ]; do
      for ((k = 0; k < BATT_JOBS; k++)); do
        if [ -z "${SLOT_PID[k]}" ] || ! kill -0 "${SLOT_PID[k]}" 2>/dev/null; then
          [ -n "${SLOT_PID[k]}" ] && wait "${SLOT_PID[k]}" 2>/dev/null
          slot=$k
          break
        fi
      done
      [ $slot -lt 0 ] && { wait -n 2>/dev/null || true; }
    done
    run_one "$entry" $((PORT + slot)) &
    SLOT_PID[slot]=$!
  done
  wait
  cooldown
fi
for entry in "${ALONE[@]}"; do
  run_one "$entry" "$PORT"
  cooldown
done

# --- récapitulatif (ordre de la liste, quel que soit l'ordre d'exécution) ---
echo
echo "##### Récapitulatif ($BATTERY_DIR ; serveur $BATT_SERVER, ${BATT_JOBS} job(s))"
printf '%-16s %-5s %6s %6s %8s\n' suite verdict PASS FAIL secondes
rc=0
for id in "${ALL_IDS[@]}"; do
  [ -f "$BATTERY_DIR/.res/$id" ] || continue
  IFS=$'\t' read -r id v p f s <"$BATTERY_DIR/.res/$id"
  printf '%-16s %-5s %6s %6s %8s\n' "$id" "$v" "$p" "$f" "$s"
  [ "$v" = PASS ] || rc=1
done
echo "durée totale : $(($(date +%s) - T0)) s"
if [ $rc = 0 ]; then echo "BATTERIE : TOUT VERT"; else echo "BATTERIE : ECHECS"; fi
exit $rc
