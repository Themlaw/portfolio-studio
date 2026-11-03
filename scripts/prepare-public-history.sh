#!/usr/bin/env bash
# Prépare l'historique PUBLIC dans une COPIE (clone miroir) : le dépôt d'origine n'est jamais modifié.
#
# Usage : scripts/prepare-public-history.sh <liste-fichiers> <remplacements> <mailmap>
#   <liste-fichiers>  fichiers à retirer de TOUT l'historique : un chemin, un motif (*, **) ou
#                     « blob:<sha> » par ligne (un blob précis, sans toucher au même chemin plus tard).
#   <remplacements>   format de `git filter-repo --replace-text` (« texte==>remplacement »,
#                     « regex:motif==>remplacement »), appliqué au contenu des fichiers ET aux
#                     messages de commit. FICHIER NON COMMITÉ (il contiendrait les vraies valeurs).
#   <mailmap>         format .mailmap : réécrit auteurs, committers et taggers.
#   Un argument « - » ignore l'étape correspondante.
# Environnement (valeurs par défaut) :
#   SRC=$HOME/pf/repo                   dépôt source (lu seulement : cloné, jamais modifié)
#   OUT=$HOME/pf/public-mirror.git      miroir réécrit (supprimé puis recréé)
#   BRANCH_FILTER='.*'                  expression (grep -E) des branches à garder ; tags toujours gardés
#   AUDIT_ARGS=''                       options passées à audit-public.mjs (--patterns, --hosts, --allow…)
#   AUDIT_SCRIPT=<dossier du script>/audit-public.mjs
# Sorties : $OUT (miroir), $OUT.commit-map (ancien nouveau), $OUT.tags.tsv (tag, ancien SHA, nouveau SHA).
# Prérequis : git, git-filter-repo (pip install --user git-filter-repo, ou le script seul dans le PATH), node.
# NE PUBLIE RIEN : aucun push, aucun accès à GitHub.
set -euo pipefail
LISTE=${1:?usage: prepare-public-history.sh <liste-fichiers|-> <remplacements|-> <mailmap|->}
REMPL=${2:?}
MAILMAP=${3:?}
SRC=${SRC:-$HOME/pf/repo}
OUT=${OUT:-$HOME/pf/public-mirror.git}
BRANCH_FILTER=${BRANCH_FILTER:-.*}
HERE=$(cd "$(dirname "$0")" && pwd)
AUDIT_SCRIPT=${AUDIT_SCRIPT:-$HERE/audit-public.mjs}
command -v git-filter-repo >/dev/null || { echo "git-filter-repo introuvable" >&2; exit 2; }
for f in "$LISTE" "$REMPL" "$MAILMAP"; do [ "$f" = - ] || [ -f "$f" ] || { echo "fichier introuvable : $f" >&2; exit 2; }; done
case "$OUT" in "$SRC"|"$SRC"/*) echo "OUT ne doit pas être dans SRC" >&2; exit 2 ;; esac

echo "== 1. clone miroir de $SRC vers $OUT"
rm -rf "$OUT"
git clone --quiet --mirror "$SRC" "$OUT"
git -C "$SRC" for-each-ref --format='%(refname) %(objectname)' >"$OUT.refs-avant"
git -C "$OUT" for-each-ref --format='%(refname:strip=2)' refs/tags | sort >"$OUT.tags-avant"

echo "== 2. branches gardées : /$BRANCH_FILTER/"
git -C "$OUT" for-each-ref --format='%(refname)' refs/heads | while read -r ref; do
  short=${ref#refs/heads/}
  printf '%s' "$short" | grep -Eq "$BRANCH_FILTER" || git -C "$OUT" update-ref -d "$ref"
done
# Références qui ne doivent pas être publiques (demandes de tirage, remotes, notes).
git -C "$OUT" for-each-ref --format='%(refname)' | grep -Ev '^refs/(heads|tags)/' | while read -r ref; do git -C "$OUT" update-ref -d "$ref"; done

echo "== 3. git filter-repo"
args=(--force)
if [ "$LISTE" != - ]; then
  : >"$OUT.blobs"; : >"$OUT.paths"
  while IFS= read -r l || [ -n "$l" ]; do
    l=${l%$'\r'}; case "$l" in ''|'#'*) continue ;; blob:*) echo "${l#blob:}" >>"$OUT.blobs" ;; *) echo "$l" >>"$OUT.paths" ;; esac
  done <"$LISTE"
  [ -s "$OUT.blobs" ] && args+=(--strip-blobs-with-ids "$OUT.blobs")
  while IFS= read -r p; do
    case "$p" in */) args+=(--path "$p") ;; *\**) args+=(--path-glob "$p") ;; *) args+=(--path "$p") ;; esac
  done <"$OUT.paths"
  [ -s "$OUT.paths" ] && args+=(--invert-paths)
fi
[ "$REMPL" != - ] && args+=(--replace-text "$REMPL" --replace-message "$REMPL")
[ "$MAILMAP" != - ] && args+=(--mailmap "$MAILMAP")
(cd "$OUT" && git filter-repo "${args[@]}")
rm -f "$OUT.blobs" "$OUT.paths"
cp "$OUT/filter-repo/commit-map" "$OUT.commit-map"

echo "== 4. vérifications"
rc=0
# 4a. tags conservés, table ancien -> nouveau SHA
git -C "$OUT" for-each-ref --format='%(refname:strip=2)' refs/tags | sort >"$OUT.tags-apres"
if diff -q "$OUT.tags-avant" "$OUT.tags-apres" >/dev/null; then echo "PASS  tags conservés ($(wc -l <"$OUT.tags-apres"))"; else echo "FAIL  tags différents :"; diff "$OUT.tags-avant" "$OUT.tags-apres" || true; rc=1; fi
: >"$OUT.tags.tsv"
while read -r t; do
  old=$(git -C "$SRC" rev-parse "refs/tags/$t^{commit}"); new=$(git -C "$OUT" rev-parse "refs/tags/$t^{commit}")
  mapped=$(awk -v o="$old" '$1==o {print $2}' "$OUT.commit-map")
  printf '%s\t%s\t%s\n' "$t" "$old" "$new" >>"$OUT.tags.tsv"
  [ -z "$mapped" ] || [ "$mapped" = "$new" ] || { echo "FAIL  tag $t : la table commit-map ne correspond pas"; rc=1; }
done <"$OUT.tags-apres"
echo "      table des tags (ancien -> nouveau SHA) : $OUT.tags.tsv ; correspondance de tous les commits : $OUT.commit-map"
# 4b. blobs interdits absents
if [ "$LISTE" != - ]; then
  gone=0
  while IFS= read -r l; do
    case "$l" in blob:*) git -C "$OUT" cat-file -e "${l#blob:}" 2>/dev/null && { echo "FAIL  blob ${l#blob:} encore présent"; gone=1; } ;; esac
  done <"$LISTE"
  [ $gone = 0 ] && echo "PASS  blobs interdits absents du miroir" || rc=1
fi
# 4c. git fsck
if git -C "$OUT" fsck --strict --no-dangling >"$OUT.fsck" 2>&1; then echo "PASS  git fsck --strict propre"; else echo "FAIL  git fsck :"; head -20 "$OUT.fsck"; rc=1; fi
# 4d. audit à zéro
# shellcheck disable=SC2086
if node "$AUDIT_SCRIPT" --repo "$OUT" --strict ${AUDIT_ARGS:-} >"$OUT.audit.txt" 2>&1; then echo "PASS  audit : 0 résultat (--strict)"; else echo "FAIL  audit :"; tail -n 25 "$OUT.audit.txt"; rc=1; fi
echo "== taille : $(du -sh "$OUT" | cut -f1) ; commits : $(git -C "$OUT" rev-list --all --count) ; branches : $(git -C "$OUT" for-each-ref refs/heads | wc -l) ; tags : $(wc -l <"$OUT.tags-apres")"
exit $rc
