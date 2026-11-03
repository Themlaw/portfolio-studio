#!/usr/bin/env bash
# Lot 104 : batterie répartie sur plusieurs machines (un shard par machine), résultats rassemblés.
# À lancer depuis une machine qui n'a que ssh/scp (rien de lourd ici). Le lot 103 (CI GitHub en matrice) utilise le même
# mécanisme : `test-all-local.sh --shards N --shard k` ; seule la façon de lancer les shards change.
#
# Usage : scripts/batt-multi.sh --conf <fichier> --commit <sha> [--tag nom] [--changed <base>] [--out dossier] [-- suites…]
# Fichier de machines (une par ligne, # = commentaire) :
#   nom|hôte ssh|worktree distant|lanceur|créneaux|port min|port max|capacité
#   ex. ssp|ssp|~/pf/wt-104||14|4200|4399|2.5
#       machine-de-dev|machine-de-dev|~/pf/wt-104|~/pf/pw.sh|6|3800|3859|1
# - lanceur : commande qui exécute dans le worktree (pw.sh sur machine-de-dev, vide sur ssp) ;
# - capacité : poids relatif de la machine dans le partage des suites (voir --capacity de test-all-local.sh) ;
# - chaque machine doit avoir le worktree au commit demandé, avec node_modules (vérifié, jamais modifié ici).
# Sortie : <out>/<tag>/<machine>/{*.log,.res/*,run.out} et <out>/<tag>/recap.txt (PASS/FAIL cumulés, durée = la plus lente).
# Ne tue aucun processus ; attentes bornées (boucles de 30 s, 10 min par passe, reprise automatique).
set -uo pipefail
CONF="" COMMIT="" TAG="m$(date +%H%M%S)" CHANGED="" OUT="$HOME/pf/multi" SUITES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --conf) CONF=$2; shift 2 ;;
    --commit) COMMIT=$2; shift 2 ;;
    --tag) TAG=$2; shift 2 ;;
    --changed) CHANGED=$2; shift 2 ;;
    --out) OUT=$2; shift 2 ;;
    --) shift; SUITES=("$@"); break ;;
    *) echo "option inconnue : $1" >&2; exit 2 ;;
  esac
done
[ -f "$CONF" ] && [ -n "$COMMIT" ] || { echo "usage : batt-multi.sh --conf f --commit sha [--tag t] [--changed base] [-- suites]" >&2; exit 2; }
mapfile -t M < <(grep -vE '^\s*(#|$)' "$CONF")
N=${#M[@]}
CAPS=$(for l in "${M[@]}"; do IFS='|' read -r _ _ _ _ _ _ _ c <<<"$l"; echo -n "${c:-1},"; done); CAPS=${CAPS%,}
DEST="$OUT/$TAG"; mkdir -p "$DEST"
echo "=== $N machine(s), tag $TAG, commit $COMMIT, capacités $CAPS"

k=0
for l in "${M[@]}"; do
  k=$((k + 1))
  IFS='|' read -r name host wt launcher jobs pmin pmax cap <<<"$l"
  got=$(ssh -n "$host" "git -C $wt rev-parse HEAD" 2>/dev/null) || { echo "$name : worktree $wt illisible" >&2; exit 3; }
  case "$got" in "$COMMIT"*) ;; *) echo "$name : worktree à $got, attendu $COMMIT : amène le commit (bundle) d'abord" >&2; exit 3 ;; esac
  rd="~/pf/multi-$TAG"
  extra=""; [ -n "$CHANGED" ] && extra="--changed $CHANGED"
  ssh -n "$host" "mkdir -p $rd; cd $wt && setsid nohup env LOCK= NODE_OPTIONS=--max-old-space-size=4096 BATT_SERVER=start BATT_JOBS=$jobs PORT=$pmin BATT_PORT_MAX=$pmax BATT_PORT_DIR=\$HOME/pf/.ports BATT_PREFIX=\$HOME/pf/multi-$TAG/data BATT_REUSE_BUILD= BATTERY_DIR=\$HOME/pf/multi-$TAG/logs $launcher bash scripts/test-all-local.sh --shards $N --shard $k --capacity $CAPS $extra ${SUITES[*]:-} > $rd/run.out 2>&1 </dev/null &" 
  echo "  shard $k/$N lancé sur $name ($host, $jobs créneaux, ports $pmin-$pmax)"
done

# Attente : chaque machine écrit « BATTERIE : » à la fin. Passes de 10 min au plus, puis reprise.
T0=$(date +%s)
while :; do
  left=0; k=0
  for l in "${M[@]}"; do
    k=$((k + 1)); IFS='|' read -r name host _ <<<"$l"
    ssh -n "$host" "grep -q '^BATTERIE :' ~/pf/multi-$TAG/run.out" 2>/dev/null || left=$((left + 1))
  done
  [ $left = 0 ] && break
  sleep 30
  [ $(( ($(date +%s) - T0) % 600 )) -lt 30 ] && echo "  ... $left machine(s) en cours ($(( ($(date +%s) - T0) / 60 )) min)"
done

# Rassemblement.
rc=0; tp=0; tf=0; slow=0
: >"$DEST/recap.txt"
for l in "${M[@]}"; do
  IFS='|' read -r name host _ <<<"$l"
  mkdir -p "$DEST/$name"
  scp -q -r "$host:~/pf/multi-$TAG/logs/." "$DEST/$name/" 2>/dev/null
  scp -q "$host:~/pf/multi-$TAG/run.out" "$DEST/$name/run.out" 2>/dev/null
  for f in "$DEST/$name"/.res/*; do
    [ -f "$f" ] || continue
    IFS=$'\t' read -r id v p fl s sl <"$f"
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$v" "$p" "$fl" "$s" "$name" >>"$DEST/recap.txt"
    tp=$((tp + p)); tf=$((tf + fl)); [ "$v" = PASS ] || rc=1
  done
  d=$(grep -oE 'durée totale : [0-9]+' "$DEST/$name/run.out" | grep -oE '[0-9]+$'); [ "${d:-0}" -gt "$slow" ] && slow=$d
  grep -q 'BATTERIE : TOUT VERT' "$DEST/$name/run.out" || rc=1
done
sort -o "$DEST/recap.txt" "$DEST/recap.txt"
echo "##### $N machine(s) : $(wc -l <"$DEST/recap.txt") suites, $tp PASS, $tf FAIL, durée (machine la plus lente) ${slow} s, mur $(( $(date +%s) - T0 )) s" | tee -a "$DEST/recap.txt"
awk -F"\t" '$1 !~ /^#/ && $2!="PASS"{print "ECHEC : "$1" ("$6")"}' "$DEST/recap.txt"
exit $rc
