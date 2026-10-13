#!/usr/bin/env bash
# Mesure mémoire d'un conteneur de 1 Gio (scénario de l'audit v0.17) : image lourde et import de kit.
# Usage : mem17.sh <image|import|both> [gate|nogate] [délai en s] [jpg|png]   (nogate = MEMORY_GATE=0 : comportement d'avant ;
# délai = attente entre le début de l'import et l'envoi de l'image, pour faire tomber l'image sur le pic du kit)
# Prérequis : ~/pf/mem17/app (standalone + static + public + drizzle + seed), ~/pf/mem17/big.jpg, ~/pf/mem17/kit.zip
set -uo pipefail
MODE=${1:-both}; GATE=${2:-gate}; DELAY=${3:-1}; IMG=${4:-jpg}
SUF=$GATE-d$DELAY-$IMG
NAME=pf-mem17-$MODE-$SUF
PORT=3230
D=$HOME/pf/mem17
DATA=$HOME/pf/data-v017f/mem-$MODE-$SUF
OUT=$D/out-$MODE-$SUF.txt
rm -rf "$DATA"; mkdir -p "$DATA"
docker rm -f "$NAME" >/dev/null 2>&1
ENVGATE=()
[ "$GATE" = nogate ] && ENVGATE=(-e MEMORY_GATE=0)
docker run -d --name "$NAME" --memory=1g --memory-swap=1g --network host --user 1000:1000 \
  -e NODE_ENV=production -e PORT=$PORT -e HOSTNAME=0.0.0.0 -e DATA_DIR="$DATA" -e NEXT_TELEMETRY_DISABLED=1 \
  -e MALLOC_ARENA_MAX=2 -e MALLOC_MMAP_THRESHOLD_=131072 -e MALLOC_TRIM_THRESHOLD_=131072 \
  -e ADMIN_EMAIL=mem@example.test -e ADMIN_PASSWORD=mem-mot-de-passe-42 \
  -e BETTER_AUTH_SECRET=mem-secret-0123456789abcdef-0123456789abcdef -e PUBLIC_BASE_URL=http://localhost:$PORT \
  -e CROP_WARM=0 "${ENVGATE[@]}" \
  -v "$HOME/pf:$HOME/pf" -w "$D/app" pf-pw:1.62.1 node server.js >/dev/null
ID=$(docker inspect -f '{{.Id}}' "$NAME")
CG=/sys/fs/cgroup/system.slice/docker-$ID.scope
for i in $(seq 90); do sleep 1; [ "$(curl -s -o /dev/null -w %{http_code} --max-time 20 localhost:$PORT/fr)" = 200 ] && break; done
curl -s -o /dev/null --max-time 30 localhost:$PORT/admin/connexion
BASEU=http://localhost:$PORT; EM=mem@example.test; PW=mem-mot-de-passe-42
echo "mode=$MODE porte=$GATE image=$IMG conteneur=$NAME" > "$OUT"
echo "au repos : $(( $(cat $CG/memory.current) / 1048576 )) Mo" >> "$OUT"
# Échantillons de la mémoire du conteneur (cgroup) toutes les 250 ms.
( while [ -d "$CG" ]; do echo "$(date +%s.%N) $(cat $CG/memory.current 2>/dev/null)"; sleep 0.25; done > "$D/series-$MODE-$SUF.txt" ) &
SAMPLER=$!
T0=$(date +%s)
if [ "$MODE" != image ]; then
  python3 $D/memdrive.py $BASEU $EM $PW import $D/kit.zip > $D/imp-$MODE-$SUF.txt 2>&1 &
  IMP=$!
fi
if [ "$MODE" != import ]; then
  [ "$MODE" = both ] && sleep "$DELAY"
  python3 $D/memdrive.py $BASEU $EM $PW image $D/big.$IMG > $D/img-$MODE-$SUF.txt 2>&1 &
fi
[ -n "${IMP:-}" ] && wait "$IMP" 2>/dev/null
IMPID=""
# Attente de la fin des jobs créés pendant la mesure (base SQLite en lecture).
case $MODE in both) EXPECT=2 ;; *) EXPECT=1 ;; esac
for i in $(seq 900); do
  sleep 1
  R=$(python3 - "$DATA/portfolio.db" "$T0" "$EXPECT" <<'PY'
import sqlite3, sys
db = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True, timeout=5)
rows = db.execute("select status from jobs where kind in ('image','kit-import') and created_at >= ?", (int(sys.argv[2]) - 2,)).fetchall()
live = [r for r in rows if r[0] in ("queued", "running")]
print("done" if len(rows) >= int(sys.argv[3]) and not live else "wait")
PY
)
  [ "$R" = done ] && break
done
sleep 2
T1=$(date +%s)
PEAK=$(( $(cat $CG/memory.peak) / 1048576 ))
echo "durée totale : $((T1 - T0)) s" >> "$OUT"
echo "pic du conteneur (memory.peak) : $PEAK Mo (limite 1024 Mo)" >> "$OUT"
echo "memory.events : $(tr '\n' ' ' < $CG/memory.events)" >> "$OUT"
echo "OOMKilled=$(docker inspect -f '{{.State.OOMKilled}}' $NAME) état=$(docker inspect -f '{{.State.Status}}' $NAME) code=$(docker inspect -f '{{.State.ExitCode}}' $NAME)" >> "$OUT"
docker logs -t "$NAME" 2>&1 | grep -E "\[jobs\]|\[kit|kit-import|import de kit|mémoire" | cut -c1-200 >> "$OUT"
kill $SAMPLER 2>/dev/null
docker rm -f "$NAME" >/dev/null 2>&1
cat "$OUT"
