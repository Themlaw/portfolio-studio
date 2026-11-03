#!/usr/bin/env bash
# Prépare l'historique PUBLIC dans une COPIE (clone miroir) : le dépôt d'origine n'est jamais modifié.
# Cas retenu : MÊME dépôt GitHub, force-push de `main` et des tags `v*` seulement.
#
# Usage : scripts/prepare-public-history.sh <liste-fichiers> <remplacements> <mailmap>
#   <liste-fichiers>  à retirer de TOUT l'historique, une ligne chacun :
#                       un chemin, un motif (*, **), un dossier (terminé par /) ;
#                       blob:<sha>            une version précise d'un fichier ;
#                       old-versions:<chemin> TOUTES les versions de ce chemin (fichier ou dossier/) sauf
#                                             celles de la tête de MAIN_REF (images régénérées à garder).
#   <remplacements>   format `git filter-repo --replace-text` (« texte==>remplacement », « regex:… »), appliqué au
#                     contenu des fichiers ET aux messages de commit. FICHIER NON COMMITÉ (vraies valeurs).
#   <mailmap>         format .mailmap : réécrit auteurs, committers et taggers. Il peut être commité s'il ne
#                     contient que des adresses noreply.
#   Un argument « - » ignore l'étape correspondante.
# Environnement :
#   SRC=$HOME/pf/repo              dépôt source (cloné, jamais modifié)
#   OUT=$HOME/pf/public-mirror.git miroir réécrit (supprimé puis recréé)
#   MAIN_REF=main                  branche (ou ref) de SRC qui devient `main` du miroir (ex. lot/103-depot-public
#                                  tant qu'elle n'est pas fusionnée)
#   TAG_FILTER='^v[0-9]'           étiquettes gardées (expression grep -E) ; toutes les autres refs sont retirées
#   AUDIT_ARGS=''                  options d'audit-public.mjs SANS liste d'exceptions (--patterns, --hosts, --forbidden…)
#   AUDIT_ALLOW=''                 fichier d'exceptions relues, utilisé seulement pour le bilan « à revoir »
#   AUDIT_SCRIPT=<dossier du script>/audit-public.mjs
# Sorties : $OUT, $OUT.commit-map (ancien nouveau), $OUT.tags.tsv, $OUT.main-avant-apres, $OUT.old-shas (tous les
# anciens SHA de commits : à vérifier côté GitHub avec scripts/check-old-shas.sh).
# Prérequis : git, git-filter-repo, node. NE PUBLIE RIEN : aucun push, aucun accès à GitHub.
set -euo pipefail
LISTE=${1:?usage: prepare-public-history.sh <liste-fichiers|-> <remplacements|-> <mailmap|->}
REMPL=${2:?}
MAILMAP=${3:?}
SRC=${SRC:-$HOME/pf/repo}
OUT=${OUT:-$HOME/pf/public-mirror.git}
MAIN_REF=${MAIN_REF:-main}
TAG_FILTER=${TAG_FILTER:-^v[0-9]}
HERE=$(cd "$(dirname "$0")" && pwd)
AUDIT_SCRIPT=${AUDIT_SCRIPT:-$HERE/audit-public.mjs}
command -v git-filter-repo >/dev/null || { echo "git-filter-repo introuvable" >&2; exit 2; }
for f in "$LISTE" "$REMPL" "$MAILMAP"; do [ "$f" = - ] || [ -f "$f" ] || { echo "fichier introuvable : $f" >&2; exit 2; }; done
case "$OUT" in "$SRC"|"$SRC"/*) echo "OUT ne doit pas être dans SRC" >&2; exit 2 ;; esac
git -C "$SRC" rev-parse --verify -q "$MAIN_REF^{commit}" >/dev/null || { echo "MAIN_REF introuvable dans SRC : $MAIN_REF" >&2; exit 2; }

echo "== 1. clone miroir de $SRC vers $OUT ; main = $MAIN_REF"
rm -rf "$OUT"
git clone --quiet --mirror "$SRC" "$OUT"
git -C "$SRC" log --all --format=%H | sort -u >"$OUT.old-shas"
MAIN_OLD=$(git -C "$SRC" rev-parse "$MAIN_REF^{commit}")
git -C "$OUT" update-ref refs/heads/main "$MAIN_OLD"
git -C "$OUT" symbolic-ref HEAD refs/heads/main

echo "== 2. versions à retirer (avant de supprimer les refs)"
: >"$OUT.blobs"; : >"$OUT.paths"
if [ "$LISTE" != - ]; then
  while IFS= read -r l || [ -n "$l" ]; do
    l=${l%$'\r'}
    case "$l" in
      ''|'#'*) ;;
      blob:*) echo "${l#blob:}" | awk '{print $1}' >>"$OUT.blobs" ;;
      old-versions:*)
        p=${l#old-versions:}; p=${p%% *}
        git -C "$OUT" log --all --no-renames --raw -r --format= -- "$p" | awk '{print $4}' | grep -Ev '^0+$' | sort -u >"$OUT.hist"
        git -C "$OUT" ls-tree -r refs/heads/main -- "$p" | awk '{print $3}' | sort -u >"$OUT.keep"
        comm -23 "$OUT.hist" "$OUT.keep" >>"$OUT.blobs"
        echo "      $p : $(wc -l <"$OUT.hist") versions dans l'historique, $(wc -l <"$OUT.keep") gardées (tête de main), $(comm -23 "$OUT.hist" "$OUT.keep" | wc -l) retirées"
        rm -f "$OUT.hist" "$OUT.keep" ;;
      *) echo "$l" >>"$OUT.paths" ;;
    esac
  done <"$LISTE"
fi

echo "== 3. seules main et les étiquettes /$TAG_FILTER/ restent"
git -C "$OUT" for-each-ref --format='%(refname)' | while read -r ref; do
  case "$ref" in
    refs/heads/main) ;;
    refs/tags/*) printf '%s' "${ref#refs/tags/}" | grep -Eq "$TAG_FILTER" || git -C "$OUT" update-ref -d "$ref" ;;
    *) git -C "$OUT" update-ref -d "$ref" ;;   # autres branches, notes, refs/pull, remotes…
  esac
done
git -C "$OUT" for-each-ref --format='%(refname:strip=2)' refs/tags | sort >"$OUT.tags-avant"

echo "== 4. git filter-repo"
args=(--force)
[ -s "$OUT.blobs" ] && args+=(--strip-blobs-with-ids "$OUT.blobs")
while IFS= read -r p; do
  case "$p" in */) args+=(--path "$p") ;; *\**) args+=(--path-glob "$p") ;; *) args+=(--path "$p") ;; esac
done <"$OUT.paths"
[ -s "$OUT.paths" ] && args+=(--invert-paths)
[ "$REMPL" != - ] && args+=(--replace-text "$REMPL" --replace-message "$REMPL")
[ "$MAILMAP" != - ] && args+=(--mailmap "$MAILMAP")
(cd "$OUT" && git filter-repo "${args[@]}") 2>&1 | grep -vE '^Parsed [0-9]+ commits' | tail -n 6
cp "$OUT/filter-repo/commit-map" "$OUT.commit-map"
git -C "$OUT" rev-parse refs/heads/main | awk -v o="$MAIN_OLD" '{print o" "$1}' >"$OUT.main-avant-apres"

echo "== 5. vérifications"
rc=0
# 5a. seules les refs voulues
extra=$(git -C "$OUT" for-each-ref --format='%(refname)' | grep -Ev '^refs/(heads/main|tags/)' || true)
[ -z "$extra" ] && echo "PASS  refs : main et $(git -C "$OUT" for-each-ref refs/tags | wc -l) étiquettes seulement" || { echo "FAIL  refs en trop : $extra"; rc=1; }
# 5b. tags conservés + table
git -C "$OUT" for-each-ref --format='%(refname:strip=2)' refs/tags | sort >"$OUT.tags-apres"
if diff -q "$OUT.tags-avant" "$OUT.tags-apres" >/dev/null; then echo "PASS  étiquettes conservées ($(wc -l <"$OUT.tags-apres"))"; else echo "FAIL  étiquettes différentes"; rc=1; fi
: >"$OUT.tags.tsv"
while read -r t; do
  old=$(git -C "$SRC" rev-parse "refs/tags/$t^{commit}"); new=$(git -C "$OUT" rev-parse "refs/tags/$t^{commit}")
  printf '%s\t%s\t%s\n' "$t" "$old" "$new" >>"$OUT.tags.tsv"
  mapped=$(awk -v o="$old" '$1==o {print $2}' "$OUT.commit-map")
  [ -z "$mapped" ] || [ "$mapped" = "$new" ] || { echo "FAIL  tag $t : commit-map incohérente"; rc=1; }
done <"$OUT.tags-apres"
echo "      table des tags (ancien nouveau) : $OUT.tags.tsv ; tous les commits : $OUT.commit-map ; main : $OUT.main-avant-apres"
# 5c. blobs et chemins retirés absents
gone=0
while IFS= read -r b; do [ -n "$b" ] && git -C "$OUT" cat-file -e "$b" 2>/dev/null && { echo "FAIL  blob $b encore présent"; gone=1; }; done <"$OUT.blobs"
while IFS= read -r p; do
  case "$p" in */) pat="^${p}" ;; *\**) continue ;; *) pat="^${p}\$" ;; esac
  if git -C "$OUT" log --all --name-only --format= | grep -Eq "$pat"; then echo "FAIL  chemin encore présent dans l'historique : $p"; gone=1; fi
done <"$OUT.paths"
[ $gone = 0 ] && echo "PASS  blobs et chemins interdits absents de tout l'historique du miroir" || rc=1
rm -f "$OUT.blobs" "$OUT.paths"
# 5d. fsck
if git -C "$OUT" fsck --strict --no-dangling >"$OUT.fsck" 2>&1; then echo "PASS  git fsck --strict propre"; else echo "FAIL  git fsck :"; head -20 "$OUT.fsck"; rc=1; fi
# 5e. audit SANS exceptions : 0 secret, 0 fichier interdit, 0 motif
# shellcheck disable=SC2086
if node "$AUDIT_SCRIPT" --repo "$OUT" ${AUDIT_ARGS:-} >"$OUT.audit.txt" 2>&1; then echo "PASS  audit sans exceptions : 0 bloquant (secret, fichier interdit, motif confidentiel)"; else echo "FAIL  audit :"; grep -E '^## |^  - ' "$OUT.audit.txt" | head -n 40; rc=1; fi
# shellcheck disable=SC2086
node "$AUDIT_SCRIPT" --repo "$OUT" --strict ${AUDIT_ARGS:-} ${AUDIT_ALLOW:+--allow "$AUDIT_ALLOW"} >"$OUT.audit-strict.txt" 2>&1 || true
echo "INFO  audit --strict (à revoir) : $(grep '^bilan' "$OUT.audit-strict.txt") ; détail : $OUT.audit-strict.txt"
# 5f. anciens SHA : combien survivent à l'identique dans le miroir (ils resteraient atteignables par SHA)
same=0; while read -r s; do git -C "$OUT" cat-file -e "$s" 2>/dev/null && same=$((same + 1)); done <"$OUT.old-shas"
echo "INFO  anciens SHA de commits : $(wc -l <"$OUT.old-shas"), encore identiques dans le miroir : $same (non réécrits, donc sans risque de fuite propre)"
echo "== taille : $(du -sh "$OUT" | cut -f1) ; commits : $(git -C "$OUT" rev-list --all --count)"
exit $rc
