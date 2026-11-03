#!/usr/bin/env bash
# Vérifie, APRES la bascule, que les anciens commits ne sont plus servis par GitHub (lecture seule, sans jeton).
# Usage : scripts/check-old-shas.sh <proprietaire/depot> <fichier-de-SHA> [nombre-max]
#   <fichier-de-SHA> : un SHA complet par ligne (public-mirror.git.old-shas), seuls ceux qui n'existent pas dans le
#   dépôt public réécrit comptent (voir ci-dessous). Résultat 404 = inaccessible ; 200 = encore servi (cache, ou
#   objet resté dans le réseau de dépôts : demander la purge au support GitHub).
# Les SHA encore valides dans le miroir (non réécrits) sont ignorés si on passe --keep <fichier-de-SHA-valides>.
set -euo pipefail
REPO=${1:?usage: check-old-shas.sh <proprietaire/depot> <fichier-de-SHA> [max]}
FILE=${2:?}
MAX=${3:-200}
KEEP=""; [ "${4:-}" = --keep ] && KEEP=${5:-}
n=0; bad=0
while read -r sha; do
  [ -n "$sha" ] || continue
  [ -n "$KEEP" ] && grep -q "^$sha" "$KEEP" && continue
  n=$((n + 1)); [ $n -gt "$MAX" ] && break
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "https://github.com/$REPO/commit/$sha")
  api=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "https://api.github.com/repos/$REPO/commits/$sha")
  if [ "$code" = 404 ] && { [ "$api" = 404 ] || [ "$api" = 422 ]; }; then :; else echo "ENCORE SERVI  $sha  (web $code, api $api)"; bad=$((bad + 1)); fi
  sleep 0.3
done <"$FILE"
echo "$n SHA contrôlés, $bad encore servis"
[ $bad = 0 ]
