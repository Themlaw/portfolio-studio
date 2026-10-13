#!/usr/bin/env bash
# Batterie complète en LOCAL (remplace GitHub Actions, voir docs/ARCHITECTURE.md) : mêmes
# jobs que .github/workflows/tests.yml, enchaînés séquentiellement, chacun sous
# le verrou /root/heavy.lock (VM de 2 Go : une seule charge lourde à la fois).
# Journaux : /root/battery-logs/<date>/<suite>.log ; récapitulatif PASS/FAIL à la fin.
# Continue après un échec ; code de sortie 1 si une suite a échoué.
#
# Usage (depuis le dépôt) :
#   scripts/test-all-local.sh [suite…]      # vide = toutes
#   ids : checks build auth pdf v013 lot1 lot8 lot11 state palette look themes kit kit17a kithttp editor boards admin medias medias-firefox
# En fond détaché :
#   ssh -f vm-dev 'cd ~/wt/lot1 && setsid nohup scripts/test-all-local.sh >/root/battery.out 2>&1 </dev/null'
# Variables : PORT (3121), LOCK (/root/heavy.lock), LOCK_WAIT (secondes, 3600), BATTERY_DIR,
#   BATT_PREFIX (/root/pf-batt : dossiers de travail des suites e2e, à distinguer entre batteries en parallèle).
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1090
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"

PORT=${PORT:-3121}
LOCK=${LOCK:-/root/heavy.lock}
LOCK_WAIT=${LOCK_WAIT:-3600}
BATTERY_DIR=${BATTERY_DIR:-/root/battery-logs/$(date +%Y-%m-%d_%H%M)}
export NODE_OPTIONS=${NODE_OPTIONS:---max-old-space-size=1024}
export NEXT_TELEMETRY_DISABLED=1
export PUBLIC_BASE_URL="http://localhost:$PORT"
export PORT
mkdir -p "$BATTERY_DIR"

# id|commande|navigateur|ONLY (même liste que le job « plan » du workflow)
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
  "editor|node scripts/e2e-editor.mjs|chromium|"
  "boards|node scripts/e2e-boards.mjs|chromium|"
  "admin|node scripts/e2e-admin.mjs|chromium|"
  "medias|node scripts/e2e-medias.mjs|chromium|"
  "medias-firefox|node scripts/e2e-medias.mjs|firefox|AB"
)

WANT=("$@")
want() {
  [ ${#WANT[@]} -eq 0 ] && return 0
  local s
  for s in "${WANT[@]}"; do [ "$s" = "$1" ] && return 0; done
  return 1
}

RESULTS=() # id<TAB>verdict<TAB>pass<TAB>fail<TAB>secondes
T0=$(date +%s)

cooldown() {
  sync
  echo 3 >/proc/sys/vm/drop_caches 2>/dev/null || true
}

# Libère le port avant une suite (reste d'un serveur dev d'une exécution interrompue).
free_port() {
  local pids
  pids=$(ss -ltnp "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
  if [ -n "$pids" ]; then
    echo "port $PORT occupé, arrêt de : $pids"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null
    sleep 2
  fi
  return 0
}

# record <id> <statut> <début> : compte les lignes PASS/FAIL du journal, mémorise le résultat.
record() {
  local id=$1 st=$2 t=$3 log="$BATTERY_DIR/$1.log" pass=0 fail=0 v=PASS
  if [ -f "$log" ]; then
    pass=$(grep -cE '^PASS\b' "$log" || true)
    fail=$(grep -cE '^FAIL\b' "$log" || true)
  fi
  [ "$st" != 0 ] && v=FAIL
  RESULTS+=("$id"$'\t'"$v"$'\t'"$pass"$'\t'"$fail"$'\t'"$(($(date +%s) - t))")
  echo "=== $id : $v ($pass PASS, $fail FAIL, $(($(date +%s) - t)) s)"
}

# run_suite <id> <commande> : sous verrou, journal dédié, cooldown ensuite.
run_suite() {
  local id=$1 cmd=$2 t st
  want "$id" || return 0
  t=$(date +%s)
  echo "=== $id : début $(date +%T)"
  free_port
  flock -w "$LOCK_WAIT" "$LOCK" bash -c "$cmd" >"$BATTERY_DIR/$id.log" 2>&1
  st=$?
  record "$id" "$st" "$t"
  cooldown
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

# --- build de production (standalone) puis test:auth (aucun serveur dev lancé) ---
BUILD_OK=0
if want build || want auth; then
  t=$(date +%s)
  free_port
  echo "=== build : début $(date +%T)"
  flock -w "$LOCK_WAIT" "$LOCK" bash -c 'npm run build:local && node scripts/check-standalone.mjs --require' >"$BATTERY_DIR/build.log" 2>&1
  st=$?
  [ $st = 0 ] && BUILD_OK=1
  record build "$st" "$t"
  cooldown
fi
if want auth; then
  if [ $BUILD_OK = 1 ]; then
    run_suite auth "mkdir -p /root/pf-batt-auth && TEST_AUTH_TMP=/root/pf-batt-auth npm run test:auth"
  else
    echo "FAIL auth : build absent ou en échec" >"$BATTERY_DIR/auth.log"
    record auth 1 "$(date +%s)"
  fi
fi

run_suite pdf "node --import tsx scripts/test-pdf.mjs"

# --- e2e : serveur dev neuf et base neuve par suite (RUNNER_TEMP dédié) ---
for entry in "${E2E[@]}"; do
  IFS='|' read -r id cmd browser only <<<"$entry"
  want "$id" || continue
  rt="${BATT_PREFIX:-/root/pf-batt}-$id"
  rm -rf "$rt"
  mkdir -p "$rt"
  run_suite "$id" "RUNNER_TEMP=$rt BROWSER=$browser ONLY=$only PORT=$PORT bash .github/scripts/e2e.sh $id $cmd"
  [ -f "$rt/logs/$id-server.log" ] && cp "$rt/logs/$id-server.log" "$BATTERY_DIR/$id-server.log"
  rm -rf "$rt/data-$id"
done

# --- récapitulatif ---
echo
echo "##### Récapitulatif ($BATTERY_DIR)"
printf '%-16s %-5s %6s %6s %8s\n' suite verdict PASS FAIL secondes
rc=0
for r in "${RESULTS[@]}"; do
  IFS=$'\t' read -r id v p f s <<<"$r"
  printf '%-16s %-5s %6s %6s %8s\n' "$id" "$v" "$p" "$f" "$s"
  [ "$v" = PASS ] || rc=1
done
echo "durée totale : $(($(date +%s) - T0)) s"
if [ $rc = 0 ]; then echo "BATTERIE : TOUT VERT"; else echo "BATTERIE : ECHECS"; fi
exit $rc
