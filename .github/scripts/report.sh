#!/usr/bin/env bash
# Résumé d'une suite : PASS/FAIL comptés dans son journal, lignes FAIL listées.
# Écrit dans $GITHUB_STEP_SUMMARY et dans $RUNNER_TEMP/result/<id>.tsv (agrégé
# par le job « summary »).
# Usage : .github/scripts/report.sh <id> <issue du pas : success|failure|…>
set -u
ID=$1
OUTCOME=$2
LOG="${RUNNER_TEMP:-/tmp}/logs/$ID.log"
OUT="${RUNNER_TEMP:-/tmp}/result"
mkdir -p "$OUT"
pass=0
fail=0
if [ -f "$LOG" ]; then
  pass=$(grep -cE '^PASS\b' "$LOG" || true)
  fail=$(grep -cE '^FAIL\b' "$LOG" || true)
fi
verdict=FAIL
[ "$OUTCOME" = success ] && verdict=PASS
printf '%s\t%s\t%s\t%s\n' "$ID" "$verdict" "$pass" "$fail" >"$OUT/$ID.tsv"
{
  echo "### $ID : $verdict ($pass PASS, $fail FAIL)"
  if [ -f "$LOG" ] && [ "$fail" != 0 ]; then
    echo '```'
    grep -E '^FAIL\b' "$LOG" | head -40
    echo '```'
  elif [ "$verdict" = FAIL ] && [ -f "$LOG" ]; then
    echo '```'
    tail -n 25 "$LOG"
    echo '```'
  fi
} >>"${GITHUB_STEP_SUMMARY:-/dev/stdout}"
