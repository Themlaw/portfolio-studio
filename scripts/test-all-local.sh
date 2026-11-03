#!/usr/bin/env bash
# Batterie complète en LOCAL (remplace GitHub Actions, voir docs/ARCHITECTURE.md) : mêmes
# jobs que .github/workflows/tests.yml. Le verrou /root/heavy.lock est pris UNE
# fois pour toute la batterie (il exclut les charges extérieures ; il ne
# sérialise plus les suites entre elles).
# Journaux : /root/battery-logs/<date>/<suite>.log ; récapitulatif PASS/FAIL à la fin.
# Continue après un échec ; code de sortie 1 si une suite a échoué.
#
# Usage (depuis le dépôt) :
#   scripts/test-all-local.sh [options] [suite…]      # vide = toutes
#   ids : checks build auth pdf v013 lot1 lot8 lot11 state palette look themes kit kit17a kithttp cartes17c papier28 texte19a palogo17f integ17 editor boards admin medias medias-firefox 17b crop17d crop17d-http crop17g couleurs19b composants20 collections22 fondtexte21 blocs27 images25 couleurs26 chrome24 admin23 couleurps29 planche31 retour30 fond32 fondplanche24 cadre34 fleches33 papiers35 grille31d grille37 video36 carrousel31f barres38 legendes39 image40 fondmarge43 fondcontenu47 entrees48 fondimage41 visionneuse44 panorama45 planchelibre42 logocadres49 backup50 vitesse54 publication51 publication101 kit53 partage52 priseenmain57 cadremotif58 cadres62 fonddeborde59 themes55 essayer63 montheme60 editeurguide61 retours68 mediaframe64 cadres79 grille69 public67 surface66 popover65a popover65w1440 popover65w1024 popover65w390 popover65b popover65c textes70 papiers78 admin76 restes77 cadres74 unif75 favicon83 backup85 domaine88 langue87 pied86 logo84 introuvable89 cadre95 opacite90 fond100 site96 legendes98 defilement99 defilement99-firefox parite99 journal97 integ33
# Options (lot 104) :
#   --changed <base>    MODE CIBLÉ : ne lance que les suites liées aux fichiers modifiés depuis <base>
#                       (git diff <base>, plus l'arbre de travail), plus le socle fixe checks, state,
#                       editor, public67, integ33. Carte fichiers → suites : scripts/batt-map.json
#                       (régénérée par `node scripts/batt-select.mjs --regen`). Environ 10 min.
#                       !! La batterie COMPLÈTE (sans option) reste OBLIGATOIRE avant une release.
#   --shards N --shard k   répartit les suites entre N machines (k de 1 à N) selon les durées
#                       mesurées (scripts/batt-durations.tsv), plus longues d'abord ; chaque machine
#                       lance son shard (voir scripts/batt-multi.sh et la matrice CI du lot 103).
#   --capacity a,b,c    capacités relatives des shards (défaut : égales)
#   --list              affiche les ids retenus (avec --changed / --shards) puis s'arrête
#   --dry-run           affiche aussi l'ordre de départ et les poids, sans rien lancer
# Rapide (VM de 3 cœurs et plus, voir docs/ARCHITECTURE.md) :
#   BATT_SERVER=start BATT_JOBS=12 scripts/test-all-local.sh
# En fond détaché :
#   ssh -f vm-dev 'cd ~/wt/lot1 && setsid nohup scripts/test-all-local.sh >/root/battery.out 2>&1 </dev/null'
# Variables :
#   BATT_SERVER  dev (défaut : `next dev` par suite, comme la CI) | start (un seul build, puis
#                `node .next/standalone/server.js` par suite ; les suites de BATT_DEV_ONLY restent en dev)
#   BATT_JOBS    nombre de « créneaux » simultanés (défaut 1). > 1 exige BATT_SERVER=start : deux
#                `next dev` ne peuvent pas partager le dossier .next, donc les suites dev passent une à
#                une, en parallèle des autres. Les suites lourdes (poids 2 dans batt-durations.tsv) prennent 2 créneaux.
#   Ports : chaque suite reçoit un BLOC de BATT_PORT_BLOCK (8) ports libres pris dans
#                BATT_PORT_MIN..BATT_PORT_MAX (défaut PORT..PORT+8*(JOBS+2)-1) par scripts/lib/port-alloc.mjs
#                (verrous dans BATT_PORT_DIR, partagés entre batteries). Bloc : +0 serveur, +1..+4 serveurs annexes
#                (backup85, domaine88), +5 serveur OIDC factice de auth. Plus aucune collision : BATT_JOBS peut monter à 12-16.
#   BATT_REUSE_BUILD=1  mode start : ne reconstruit pas si .next/standalone existe ET que l'empreinte des
#                sources (.next/standalone/.batt-stamp) est identique ; sinon reconstruit (jamais de build périmé).
#   Empreinte du build (CI, lot 103) : `LOCK= BATT_SERVER=start bash scripts/test-all-local.sh build` construit le standalone, lance
#                check-standalone ET écrit .next/standalone/.batt-stamp. À faire dans le job `build` de la CI, puis archiver
#                .next/standalone EN GARDANT LES FICHIERS CACHÉS (.batt-stamp) : chaque shard lance ensuite
#                `BATT_REUSE_BUILD=1 ... test-all-local.sh <suites>` et ne reconstruit pas (empreinte identique), sinon il reconstruit.
#   BATT_UNIT_JOBS  étapes de `npm test` simultanées dans la suite checks (défaut min(8, cœurs))
#   BATT_SLEEP_PROBE=1  mesure, par suite, le temps passé dans les attentes fixes (`sleep`) : $BATTERY_DIR/<suite>.sleep
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
BATT_PORT_BLOCK=${BATT_PORT_BLOCK:-8}
export BATTERY_DIR=${BATTERY_DIR:-/root/battery-logs/$(date +%Y-%m-%d_%H%M)}
DURATIONS=${BATT_DURATIONS:-scripts/batt-durations.tsv}
# Suites qui exigent `next dev` (voir docs/ARCHITECTURE.md, « Mode start »). Elles passent par /api/theme-preview, fermée (404) en production.
BATT_DEV_ONLY=${BATT_DEV_ONLY-v013 lot11 themes papier28 planche31 retours68}

ORIG_ARGS=("$@")
# Options (avant les ids de suites).
WANT=()
CHANGED_BASE=""
SHARDS=""
SHARD=""
CAPACITY=""
LIST_ONLY=0
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --changed) CHANGED_BASE=${2:?--changed exige une base git}; shift 2 ;;
    --shards) SHARDS=${2:?}; shift 2 ;;
    --shard) SHARD=${2:?}; shift 2 ;;
    --capacity) CAPACITY=${2:?}; shift 2 ;;
    --list) LIST_ONLY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --*) echo "option inconnue : $1" >&2; exit 2 ;;
    *) WANT+=("$1"); shift ;;
  esac
done

case "$BATT_SERVER" in dev | start) ;; *) echo "BATT_SERVER doit valoir dev ou start" >&2; exit 2 ;; esac
case "$BATT_JOBS" in '' | *[!0-9]* | 0) echo "BATT_JOBS doit être un entier >= 1" >&2; exit 2 ;; esac
if [ "$BATT_SERVER" = dev ] && [ "$BATT_JOBS" -gt 1 ]; then
  echo "BATT_JOBS > 1 exige BATT_SERVER=start (un seul next dev par dossier .next)" >&2
  exit 2
fi
if { [ -n "$SHARDS" ] || [ -n "$SHARD" ]; } && { [ -z "$SHARDS" ] || [ -z "$SHARD" ]; }; then
  echo "--shards N et --shard k vont ensemble" >&2
  exit 2
fi

# Sélection (mode ciblé, shards) : calculée par scripts/batt-select.mjs, qui lit ce script (tableau E2E) et les durées.
if [ -n "$CHANGED_BASE" ] || [ -n "$SHARDS" ]; then
  SEL_ARGS=(--script "$0" --durations "$DURATIONS")
  [ -n "$CHANGED_BASE" ] && SEL_ARGS+=(--changed "$CHANGED_BASE")
  [ -n "$SHARDS" ] && SEL_ARGS+=(--shards "$SHARDS" --shard "$SHARD")
  [ -n "$CAPACITY" ] && SEL_ARGS+=(--capacity "$CAPACITY")
  if [ ${#WANT[@]} -gt 0 ]; then SEL_ARGS+=(--ids "${WANT[*]}"); fi
  SEL=$(node scripts/batt-select.mjs "${SEL_ARGS[@]}") || { echo "sélection impossible" >&2; exit 2; }
  # shellcheck disable=SC2206
  WANT=($SEL)
  echo "=== sélection : ${#WANT[@]} suite(s) : ${WANT[*]}"
fi
if [ "$LIST_ONLY" = 1 ]; then
  if [ ${#WANT[@]} -eq 0 ]; then node scripts/batt-select.mjs --script "$0" --durations "$DURATIONS" --all; else echo "${WANT[*]}"; fi
  exit 0
fi

# Verrou unique pour toute la batterie (relance du script sous flock).
if [ -n "$LOCK" ] && [ -z "${BATT_LOCKED:-}" ] && [ "$DRY_RUN" = 0 ]; then
  exec flock -w "$LOCK_WAIT" "$LOCK" env BATT_LOCKED=1 bash "$0" "${ORIG_ARGS[@]}"
fi

export NODE_OPTIONS=${NODE_OPTIONS:---max-old-space-size=1024}
export NEXT_TELEMETRY_DISABLED=1
export BATT_PORT_DIR=${BATT_PORT_DIR:-${TMPDIR:-/tmp}/batt-ports}
export BATT_PORT_BLOCK
export BATT_PORT_MIN=${BATT_PORT_MIN:-$PORT}
export BATT_PORT_MAX=${BATT_PORT_MAX:-$((PORT + BATT_PORT_BLOCK * (BATT_JOBS + 2) - 1))}
if [ "$DRY_RUN" = 0 ]; then
  mkdir -p "$BATTERY_DIR/.res"
  rm -f "$BATTERY_DIR/.res/"*
fi

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
  "papier28|node scripts/e2e-papier28.mjs|chromium|"
  "texte19a|node scripts/e2e-texte.mjs|chromium|"
  "palogo17f|node scripts/e2e-palette-logo.mjs|chromium|"
  "couleurs19b|node scripts/e2e-couleurs-da.mjs|chromium|"
  "composants20|node scripts/e2e-composants.mjs|chromium|"
  "fondtexte21|node scripts/e2e-fond-texte.mjs|chromium|"
  "fond32|node scripts/e2e-fond.mjs|chromium|"
  "fondplanche24|node scripts/e2e-fond-planche.mjs|chromium|"
  "papiers35|node scripts/e2e-papiers.mjs|chromium|"
  "papiers78|node scripts/e2e-papiers78.mjs|chromium|"
  "fondmarge43|node scripts/e2e-fond-marge.mjs|chromium|"
  "fondcontenu47|node scripts/e2e-fond-contenu47.mjs|chromium|"
  "entrees48|node scripts/e2e-entrees48.mjs|chromium|"
  "editor|node scripts/e2e-editor.mjs|chromium|"
  "boards|node scripts/e2e-boards.mjs|chromium|"
  "admin|node scripts/e2e-admin.mjs|chromium|"
  "admin23|node scripts/e2e-admin23.mjs|chromium|"
  "medias|node scripts/e2e-medias.mjs|chromium|"
  "medias-firefox|node scripts/e2e-medias.mjs|firefox|AB"
  "17b|node scripts/e2e-17b.mjs|chromium||MALLOC_ARENA_MAX=2 MALLOC_MMAP_THRESHOLD_=131072 MALLOC_TRIM_THRESHOLD_=131072"
  "crop17d|node scripts/e2e-crop.mjs|chromium|"
  "crop17d-http|node scripts/e2e-crop-http.mjs|chromium|"
  "crop17g|node scripts/e2e-crop.mjs|chromium|F|CROP_WARM=0 CROP_MAX_WAITING=3"
  "collections22|node scripts/e2e-collections.mjs|chromium|"
  "blocs27|node scripts/e2e-blocs27.mjs|chromium|"
  "images25|node scripts/e2e-images25.mjs|chromium|"
  "couleurs26|node scripts/e2e-couleurs26.mjs|chromium|"
  "chrome24|node scripts/e2e-chrome24.mjs|chromium|"
  "couleurps29|node scripts/e2e-couleurps29.mjs|chromium|"
  "planche31|node scripts/e2e-planche31.mjs|chromium|"
  "retour30|node scripts/e2e-retour30.mjs|chromium|"
  "cadre34|node scripts/e2e-cadre34.mjs|chromium|"
  "grille31d|node scripts/e2e-grille31d.mjs|chromium|"
  "grille37|node scripts/e2e-grille37.mjs|chromium|"
  "fleches33|node scripts/e2e-fleches33.mjs|chromium|"
  "video36|node scripts/e2e-video36.mjs|chromium|"
  "carrousel31f|node scripts/e2e-carrousel31f.mjs|chromium|"
  "barres38|node scripts/e2e-barres38.mjs|chromium|"
  "legendes39|node scripts/e2e-legendes39.mjs|chromium|"
  "legendes98|node scripts/e2e-legendes98.mjs|chromium|"
  "image40|node scripts/e2e-image40.mjs|chromium|"
  "fondimage41|node scripts/e2e-fondimage41.mjs|chromium|"
  "visionneuse44|node scripts/e2e-visionneuse44.mjs|chromium|"
  "panorama45|node scripts/e2e-panorama45.mjs|chromium|"
  "planchelibre42|node scripts/e2e-planchelibre42.mjs|chromium|"
  "logocadres49|node scripts/e2e-logocadres49.mjs|chromium|"
  "publication51|node scripts/e2e-publication51.mjs|chromium|"
  "publication101|node scripts/e2e-publication101.mjs|chromium|"
  "backup50|node scripts/e2e-backup50.mjs|chromium||WITH_BACKUP=1 BACKUP_QUIET_SEC=4 BACKUP_KEEP=3 BACKUP_MAX_HOURS=6"
  "vitesse54|node scripts/e2e-vitesse54.mjs|chromium|"
  "kit53|node scripts/e2e-kit53.mjs|chromium|"
  "partage52|node scripts/e2e-partage52.mjs|chromium|"
  "priseenmain57|node scripts/e2e-priseenmain57.mjs|chromium|"
  "cadremotif58|node scripts/e2e-cadremotif58.mjs|chromium|"
  "cadres62|node scripts/e2e-cadres62.mjs|chromium|"
  "cadres74|node scripts/e2e-cadres74.mjs|chromium|"
  "fonddeborde59|node scripts/e2e-fond-deborde59.mjs|chromium|"
  "themes55|node scripts/e2e-themes55.mjs|chromium|"
  "essayer63|node scripts/e2e-essayer63.mjs|chromium|"
  "montheme60|node scripts/e2e-montheme60.mjs|chromium|"
  "editeurguide61|node scripts/e2e-editeurguide61.mjs|chromium|"
  "retours68|node scripts/e2e-retours68.mjs|chromium|"
  "mediaframe64|node scripts/e2e-mediaframe64.mjs|chromium|"
  "cadres79|node scripts/e2e-cadres79.mjs|chromium|"
  "cadre95|node scripts/e2e-cadre95.mjs|chromium|"
  "grille69|node scripts/e2e-grille69.mjs|chromium|"
  "public67|node scripts/e2e-public67.mjs|chromium|"
  "surface66|node scripts/e2e-surface66.mjs|chromium|"
  "popover65a|node scripts/e2e-popover65.mjs|chromium|B,K,R"
  "popover65w1440|node scripts/e2e-popover65.mjs|chromium|W|WIDTHS=1440"
  "popover65w1024|node scripts/e2e-popover65.mjs|chromium|W|WIDTHS=1024"
  "popover65w390|node scripts/e2e-popover65.mjs|chromium|W|WIDTHS=390"
  "popover65b|node scripts/e2e-popover65.mjs|chromium|O"
  "popover65c|node scripts/e2e-popover65.mjs|chromium|D"
  "textes70|node scripts/e2e-textes70.mjs|chromium|"
  "admin76|node scripts/e2e-admin76.mjs|chromium||WITH_BACKUP=1 BACKUP_QUIET_SEC=4 BACKUP_KEEP=3 BACKUP_MAX_HOURS=6"
  "restes77|node scripts/e2e-restes77.mjs|chromium|"
  "unif75|node scripts/e2e-unif75.mjs|chromium|"
  "favicon83|node scripts/e2e-favicon83.mjs|chromium|"
  "introuvable89|node scripts/e2e-introuvable89.mjs|chromium|"
  "site96|node scripts/e2e-site96.mjs|chromium|"
  "backup85|node scripts/e2e-backup85.mjs|chromium|"
  "langue87|node scripts/e2e-langue87.mjs|chromium|"
  "pied86|node scripts/e2e-pied86.mjs|chromium|"
  "logo84|node scripts/e2e-logo84.mjs|chromium|"
  "opacite90|node scripts/e2e-opacite90.mjs|chromium|"
  "fond100|node scripts/e2e-fond100.mjs|chromium|"
  "defilement99|node scripts/e2e-defilement99.mjs|chromium|"
  "defilement99-firefox|node scripts/e2e-defilement99.mjs|firefox|K"
  "parite99|node scripts/e2e-defilement99.mjs|chromium|P"
  "journal97|node scripts/e2e-journal97.mjs|chromium|"
  "integ33|node scripts/e2e-integ33.mjs|chromium|"
)

want() {
  [ ${#WANT[@]} -eq 0 ] && return 0
  local s
  for s in "${WANT[@]}"; do [ "$s" = "$1" ] && return 0; done
  return 1
}
in_list() { case " $1 " in *" $2 "*) return 0 ;; esac; return 1; }

ALL_IDS=(checks build auth domaine88 pdf)
for e in "${E2E[@]}"; do ALL_IDS+=("${e%%|*}"); done
T0=$(date +%s)

# Durée mesurée (s) et poids (créneaux) d'une suite : scripts/batt-durations.tsv (id, secondes, poids). Défaut 120 s, poids 1.
dur_of() { awk -F'\t' -v id="$1" '$1==id {print $2; f=1; exit} END{if(!f) print 120}' "$DURATIONS" 2>/dev/null || echo 120; }
weight_of() {
  local w
  w=$(awk -F'\t' -v id="$1" '$1==id {print $3; f=1; exit} END{if(!f) print 1}' "$DURATIONS" 2>/dev/null || echo 1)
  # Un poids supérieur au nombre de créneaux ne ferait jamais démarrer la suite.
  [ "$w" -gt "$BATT_JOBS" ] && w=$BATT_JOBS
  echo "$w"
}

# Bloc de ports libres pour un job (verrou partagé entre batteries ; ne tue jamais un tiers). Affiche le premier port.
alloc_ports() { node scripts/lib/port-alloc.mjs alloc --min "$BATT_PORT_MIN" --max "$BATT_PORT_MAX" --size "$BATT_PORT_BLOCK" --dir "$BATT_PORT_DIR" --owner "$1" --wait 900; }
free_ports() { node scripts/lib/port-alloc.mjs release "$1" --size "$BATT_PORT_BLOCK" --dir "$BATT_PORT_DIR"; }

# record <id> <statut> <début> : compte les lignes PASS/FAIL du journal, mémorise le résultat
# (un fichier par suite : sûr quand plusieurs suites tournent en parallèle).
record() {
  local id=$1 st=$2 t=$3 log="$BATTERY_DIR/$1.log" pass=0 fail=0 v=PASS sl=0
  if [ -f "$log" ]; then
    pass=$(grep -cE '^PASS\b' "$log" || true)
    fail=$(grep -cE '^FAIL\b' "$log" || true)
  fi
  [ -f "$BATTERY_DIR/$id.sleep" ] && sl=$(cat "$BATTERY_DIR/$id.sleep")
  [ "$st" != 0 ] && v=FAIL
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$v" "$pass" "$fail" "$(($(date +%s) - t))" "$sl" >"$BATTERY_DIR/.res/$id"
  echo "=== $id : $v ($pass PASS, $fail FAIL, $(($(date +%s) - t)) s)"
}

# run_suite <id> <commande> : journal dédié.
run_suite() {
  local id=$1 cmd=$2 t st
  want "$id" || return 0
  t=$(date +%s)
  echo "=== $id : début $(date +%T)"
  bash -c "$cmd" >"$BATTERY_DIR/$id.log" 2>&1
  st=$?
  record "$id" "$st" "$t"
}

# --- empreinte des sources du build : un standalone n'est réutilisé que s'il vient exactement de ces sources ---
src_stamp() {
  {
    git ls-files -co --exclude-standard -z 2>/dev/null |
      grep -zvE '^(scripts/(e2e-|test-|shot|look-|parity|admin-shots|editor-shots|medias-shots|planche-shots|rail|scrollcheck|seed-perso|shots-|mem/|batt-)|tests/|docs/|\.github/|screenshots/|README)' |
      xargs -0 sha1sum 2>/dev/null
    node -v
  } | sha1sum | cut -d' ' -f1
}

# --- build de production (standalone) : un seul pour toute la batterie ---
SA="$PWD/.next/standalone"
need_e2e=0
for e in "${E2E[@]}"; do want "${e%%|*}" && need_e2e=1; done
NEED_BUILD=0
want build && NEED_BUILD=1
want auth && NEED_BUILD=1
want domaine88 && NEED_BUILD=1
[ "$BATT_SERVER" = start ] && [ $need_e2e = 1 ] && NEED_BUILD=1
BUILD_OK=0
BUILD_PID=""
BUILD_PENDING=0

do_build() { # exécuté en sous-shell (ou direct) ; code 0 = standalone prêt
  local t st stamp
  stamp=$(src_stamp)
  if [ "$BATT_SERVER" = start ] && [ "${BATT_REUSE_BUILD:-}" = 1 ] && [ -f "$SA/server.js" ] && ! want build; then
    if [ "$(cat "$SA/.batt-stamp" 2>/dev/null)" = "$stamp" ]; then
      echo "=== build : standalone existant réutilisé (BATT_REUSE_BUILD=1, empreinte $stamp identique)"
      return 0
    fi
    echo "=== build : BATT_REUSE_BUILD=1 mais l'empreinte des sources diffère (ou absente) : reconstruction"
  fi
  t=$(date +%s)
  echo "=== build : début $(date +%T)"
  rm -f "$SA/.batt-stamp"
  bash -c 'npm run build:local && node scripts/check-standalone.mjs --require' >"$BATTERY_DIR/build.log" 2>&1
  st=$?
  if [ $st = 0 ]; then echo "$stamp" >"$SA/.batt-stamp"; fi
  want build && record build "$st" "$t"
  [ $st != 0 ] && ! want build && echo "=== build : ECHEC (voir $BATTERY_DIR/build.log)"
  return $st
}

# Ressources que l'image Docker copie à côté de server.js (partagées par les serveurs en lecture seule).
prepare_standalone() {
  local d
  for d in drizzle seed public; do rm -rf "${SA:?}/$d"; cp -a "$d" "$SA/$d"; done
  rm -rf "$SA/.next/static"
  cp -a .next/static "$SA/.next/static"
}

# --- checks : tsc, lint, tokens, contraste, thèmes, tests unitaires (npm test, en parallèle), le tout en UNE suite ---
# check-standalone (dans npm test) est sauté quand cette batterie reconstruit : l'étape build l'exécute avec --require.
CHECKS_SKIP=""
[ $NEED_BUILD = 1 ] && ! { [ "${BATT_REUSE_BUILD:-}" = 1 ] && [ -f "$SA/server.js" ]; } && CHECKS_SKIP="--skip check-standalone"
read -r -d '' CHECKS_CMD <<EOS
rc=0
for step in "npx tsc --noEmit" "npm run lint" "npm run check:tokens" "npm run check:contrast" "npm run theme:check" "npm run test:fast -- $CHECKS_SKIP" "node --import tsx scripts/test-highlight-layout.mjs"; do
  echo "##### \$step"
  \$step || { echo "FAIL checks : \$step"; rc=1; }
done
exit \$rc
EOS

# --- tâches : une par suite, chacune dans son sous-shell, avec son bloc de ports ---
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
  if [ "${BATT_SLEEP_PROBE:-}" = 1 ]; then cmd=${cmd/#node /node --import $PWD/scripts/lib/sleep-probe.mjs }; fi
  # extra : variables propres à la suite (ex. MALLOC_* de 17b, CROP_* de crop17g), transmises au serveur et à la suite.
  # shellcheck disable=SC2086
  # Priorité : les suites `next dev` (compilation à la demande, délais de navigation de 30 s) passent avant les suites en
  # production quand la machine est chargée (BATT_NICE, 8 par défaut ; 0 = désactivé) : elles dépassaient leurs délais.
  local nicecmd=""
  [ "$BATT_JOBS" -gt 1 ] && [ "$mode" = start ] && [ "${BATT_NICE:-8}" != 0 ] && nicecmd="nice -n ${BATT_NICE:-8}"
  # shellcheck disable=SC2086
  $nicecmd env ${extra:-} TMPDIR="$rt/tmp" RUNNER_TEMP="$rt" BROWSER="$browser" ONLY="$only" PORT="$port" PUBLIC_BASE_URL="http://localhost:$port" \
    BATT_SLEEP_FILE="$BATTERY_DIR/$id.sleep" BATT_SERVER="$mode" bash -c "bash .github/scripts/e2e.sh $id $cmd" >"$BATTERY_DIR/$id.log" 2>&1
  st=$?
  record "$id" "$st" "$t"
  [ -f "$rt/logs/$id-server.log" ] && cp "$rt/logs/$id-server.log" "$BATTERY_DIR/$id-server.log"
  rm -rf "$rt/data-$id"
}

# run_task <id> : tâche complète d'une suite (ports, exécution, libération). Exécutée en sous-shell.
run_task() {
  local id=$1 port="" entry e me
  case "$id" in
    checks | pdf) ;;
    # Le propriétaire du verrou est CE sous-shell (BASHPID évalué ici, pas dans la substitution de commande, dont le pid meurt aussitôt).
    *) me=$BASHPID; port=$(alloc_ports "$me") || { echo "FAIL $id : aucun bloc de ports libre" >"$BATTERY_DIR/$id.log"; record "$id" 1 "$(date +%s)"; return 0; } ;;
  esac
  # shellcheck disable=SC2064
  [ -n "$port" ] && trap "free_ports $port" EXIT
  case "$id" in
    checks) run_suite checks "$CHECKS_CMD" ;;
    pdf) run_suite pdf "node --import tsx scripts/test-pdf.mjs" ;;
    auth)
      if [ $BUILD_OK = 1 ]; then
        run_suite auth "mkdir -p ${BATT_PREFIX:-/root/pf-batt}-auth && TEST_AUTH_TMP=${BATT_PREFIX:-/root/pf-batt}-auth BATT_AUTH_PORT=$port BATT_AUTH_MOCK_PORT=$((port + 5)) npm run test:auth"
      else
        echo "FAIL auth : build absent ou en échec" >"$BATTERY_DIR/auth.log"
        record auth 1 "$(date +%s)"
      fi
      ;;
    domaine88)
      # lot 88 : ses propres serveurs standalone (port, +1…+4), hôtes simulés par les en-têtes.
      if [ $BUILD_OK = 1 ]; then
        run_suite domaine88 "DOMAINE88_PORT=$port DOMAINE88_TMP=${BATT_PREFIX:-/root/pf-batt}-domaine88 node scripts/e2e-domaine88.mjs"
      else
        echo "FAIL domaine88 : build absent ou en échec" >"$BATTERY_DIR/domaine88.log"
        record domaine88 1 "$(date +%s)"
      fi
      ;;
    *)
      for e in "${E2E[@]}"; do [ "${e%%|*}" = "$id" ] && entry=$e; done
      run_e2e "$entry" "$port"
      ;;
  esac
}

# Suites à lancer, dans l'ordre de départ : les plus longues d'abord (durées mesurées), sauf BATT_JOBS=1 (ordre historique).
TASKS=()
for id in "${ALL_IDS[@]}"; do
  [ "$id" = build ] && continue
  want "$id" && TASKS+=("$id")
done
if [ "$BATT_JOBS" -gt 1 ] && [ ${#TASKS[@]} -gt 1 ]; then
  mapfile -t TASKS < <(for id in "${TASKS[@]}"; do printf '%s\t%s\n' "$(dur_of "$id")" "$id"; done | sort -t$'\t' -k1,1nr -s | cut -f2)
fi
if [ "$DRY_RUN" = 1 ]; then
  echo "=== ordre de départ (BATT_JOBS=$BATT_JOBS, serveur $BATT_SERVER, ports $BATT_PORT_MIN-$BATT_PORT_MAX par blocs de $BATT_PORT_BLOCK)"
  for id in "${TASKS[@]}"; do printf '%-22s %6s s  poids %s%s\n' "$id" "$(dur_of "$id")" "$(weight_of "$id")" "$(in_list "$BATT_DEV_ONLY" "$id" && [ "$BATT_SERVER" = start ] && echo '  (next dev, une à la fois)')"; done
  echo "build : $([ $NEED_BUILD = 1 ] && echo oui || echo non)"
  exit 0
fi

needs_build() { # attendre la fin du build ? (checks et pdf n'ont besoin ni du standalone ni de .next ; tout le reste attend)
  case "$1" in checks | pdf) return 1 ;; esac
  return 0
}

# Build en arrière-plan : checks et pdf (sans serveur) tournent pendant ce temps.
if [ $NEED_BUILD = 1 ]; then
  if [ "$BATT_JOBS" -le 1 ]; then
    # Un seul créneau (VM modeste) : build d'abord, rien en parallèle.
    do_build && BUILD_OK=1
    [ $BUILD_OK = 1 ] && prepare_standalone
  else
    BUILD_PENDING=1
    (do_build) &
    BUILD_PID=$!
  fi
fi

declare -A RUN_PID=() RUN_W=()
USED=0
DEV_RUNNING=0
reap() {
  local id
  for id in "${!RUN_PID[@]}"; do
    if ! kill -0 "${RUN_PID[$id]}" 2>/dev/null; then
      wait "${RUN_PID[$id]}" 2>/dev/null
      USED=$((USED - ${RUN_W[$id]}))
      if [ "$BATT_SERVER" = start ] && in_list "$BATT_DEV_ONLY" "$id"; then DEV_RUNNING=0; fi
      unset 'RUN_PID[$id]' 'RUN_W[$id]'
    fi
  done
}
build_done() {
  [ $BUILD_PENDING = 1 ] || return 0
  if kill -0 "$BUILD_PID" 2>/dev/null; then return 1; fi
  wait "$BUILD_PID" 2>/dev/null && BUILD_OK=1
  BUILD_PENDING=0
  [ $BUILD_OK = 1 ] && prepare_standalone
  return 0
}
[ $NEED_BUILD = 0 ] && BUILD_OK=0

PENDING=("${TASKS[@]}")
echo "=== ${#PENDING[@]} suites, $BATT_JOBS créneau(x), ports $BATT_PORT_MIN-$BATT_PORT_MAX (blocs de $BATT_PORT_BLOCK)"
while [ ${#PENDING[@]} -gt 0 ]; do
  reap
  build_done
  launched=0
  REST=()
  for id in "${PENDING[@]}"; do
    w=$(weight_of "$id")
    if [ $launched = 1 ] && [ "$BATT_JOBS" -le 1 ]; then REST+=("$id"); continue; fi
    can=1
    needs_build "$id" && [ $BUILD_PENDING = 1 ] && can=0
    [ $USED -gt 0 ] && [ $((USED + w)) -gt "$BATT_JOBS" ] && can=0
    if [ "$BATT_SERVER" = start ] && in_list "$BATT_DEV_ONLY" "$id" && [ $DEV_RUNNING = 1 ]; then can=0; fi
    if [ $can = 1 ]; then
      (run_task "$id") &
      RUN_PID[$id]=$!
      RUN_W[$id]=$w
      USED=$((USED + w))
      if [ "$BATT_SERVER" = start ] && in_list "$BATT_DEV_ONLY" "$id"; then DEV_RUNNING=1; fi
      launched=1
    else
      REST+=("$id")
    fi
  done
  PENDING=("${REST[@]}")
  [ ${#PENDING[@]} -gt 0 ] && sleep 1
done
while [ ${#RUN_PID[@]} -gt 0 ]; do reap; sleep 1; done
[ -n "$BUILD_PID" ] && wait "$BUILD_PID" 2>/dev/null
sync

# --- récapitulatif (ordre de la liste, quel que soit l'ordre d'exécution) ---
echo
echo "##### Récapitulatif ($BATTERY_DIR ; serveur $BATT_SERVER, ${BATT_JOBS} job(s))"
printf '%-16s %-5s %6s %6s %8s %8s\n' suite verdict PASS FAIL secondes attente_s
rc=0
tp=0
tf=0
for id in "${ALL_IDS[@]}"; do
  [ -f "$BATTERY_DIR/.res/$id" ] || continue
  IFS=$'\t' read -r id v p f s sl <"$BATTERY_DIR/.res/$id"
  printf '%-16s %-5s %6s %6s %8s %8s\n' "$id" "$v" "$p" "$f" "$s" "${sl:-0}"
  tp=$((tp + p))
  tf=$((tf + f))
  [ "$v" = PASS ] || rc=1
done
echo "total : $tp PASS, $tf FAIL"
echo "durée totale : $(($(date +%s) - T0)) s"
if [ $rc = 0 ]; then echo "BATTERIE : TOUT VERT"; else echo "BATTERIE : ECHECS"; fi
exit $rc
