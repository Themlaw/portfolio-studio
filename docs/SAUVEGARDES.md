# Sauvegardes automatiques (lot 50)

Le site peut se sauvegarder tout seul dans son propre volume (`/data/backup`). Elle est **désactivée par défaut** : sans
`WITH_BACKUP`, rien ne change et aucun fichier n'est créé.

## Variables d'environnement

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `WITH_BACKUP` | absent (désactivé) | `1` ou `true` pour activer. Absent, `0` ou `false` : aucune sauvegarde, aucun fichier. |
| `BACKUP_QUIET_MIN` | `10` | Minutes sans nouvelle modification avant de sauvegarder (fin d'une session de travail). |
| `BACKUP_MAX_HOURS` | `6` | Au plus N heures entre deux sauvegardes tant qu'il y a des modifications, même si le travail continue. |
| `BACKUP_KEEP` | `3` | Nombre de sauvegardes gardées (les plus récentes). |
| `BACKUP_MEDIA` | `1` | `0` ou `false` : sauvegarde la base seule (voir « Poids »). |
| `BACKUP_QUIET_SEC` | absent | Quiétude en secondes (tests ; prioritaire sur `BACKUP_QUIET_MIN`). |

Une valeur invalide est remplacée par le défaut, avec un avertissement dans le journal.

## Quand une sauvegarde part

Une sauvegarde part s'il y a eu des modifications **et** que l'un de ces délais est atteint : `BACKUP_QUIET_MIN` minutes sans
nouvelle modification, ou `BACKUP_MAX_HOURS` heures depuis la précédente. Sans modification, rien ne part. Une première
sauvegarde est faite peu après le premier démarrage si aucune n'existe.

**Détection des modifications.** `PRAGMA data_version` lu sur une connexion SQLite en lecture seule à part : SQLite change cette
valeur à chaque validation d'une AUTRE connexion que celle qui la lit, donc toute écriture du site (publication, brouillon, médias,
réglages, thèmes, messages, file de traitements) est vue, sans qu'aucune action d'écriture ait à signaler quoi que ce soit.
Pourquoi pas un compteur dans chaque écriture : il faudrait le tenir à jour pour toujours, et un oubli serait une modification jamais
sauvegardée. Coût : une lecture d'un entier toutes les quelques secondes. Les écritures de fond comptent aussi ; le pire cas est
une sauvegarde de trop, jamais une de moins. L'état « modifications en attente » est écrit dans `backup/state.json` : une mise à jour
du conteneur juste après une session de travail n'oublie rien.

## Contenu d'une archive

`/data/backup/portfolio-AAAAMMJJ-HHMMSS.tar.gz` (heure du conteneur, UTC par défaut), lisible par `tar` :

- `manifest.json` : version de l'application, date, raison du déclenchement, nombre de médias, taille.
- `portfolio.db` : instantané COHÉRENT, pris pendant que le site tourne par l'API de sauvegarde de SQLite (jamais une copie du
  fichier en écriture), sans bloquer les écritures.
- `media/originals/…` : les ORIGINAUX envoyés. Les variantes (`img/`, `vid/`, `doc/`) ne sont pas sauvegardées : le worker les
  régénère à partir des originaux (c'est ce que fait « Réessayer » dans la médiathèque). Le cache des recadrages et des kits se
  refait à la demande.
- Exceptions non régénérables, sauvegardées telles quelles : une vidéo dont l'original a été supprimé après conversion
  (`VIDEO_KEEP_ORIGINALS` absent) garde ses fichiers servis ; un média du seed (SVG, clé hors `originals/`) est copié.
- `fonts/…` : polices installées (quelques centaines de Ko).
- Jamais : `tmp/` (envois en cours), `cache/`, `kit-imports/`, `backup/` lui-même.

Un seul fichier à la fois, écrit en flux (rien n'est chargé en mémoire) dans un `.tmp` puis renommé d'un coup ; les plus anciennes
sauvegardes ne sont supprimées qu'APRÈS l'écriture complète de la nouvelle.

## Légèreté

- Minuterie dans le processus du site (aucune requête bloquée) ; copie de la base par pages ; gzip niveau 3 dans le pool de
  threads de Node, qui cède la main entre deux blocs de 256 Ko.
- Une sauvegarde à la fois. Pas de priorité système plus basse : Node ne sait baisser que celle de tout le processus, ce qui
  ralentirait aussi le site.
- Pas de sauvegarde si l'espace libre du volume est inférieur au poids brut des fichiers + 64 Mo : avertissement
  `[backup] AVERTISSEMENT : espace libre insuffisant…`, nouvel essai plus tard, sauvegardes existantes intactes.
- Après un échec, nouvel essai au plus tôt une minute plus tard.

## Poids et `BACKUP_MEDIA=0`

Avec les médias, chaque sauvegarde pèse à peu près la somme des originaux (déjà compressés : gzip n'y gagne presque rien) ; trois
sauvegardes gardées = environ trois fois cette somme dans le volume. Si la médiathèque est grosse, `BACKUP_MEDIA=0` ne sauvegarde que
la base (quelques Mo) : les médias restent protégés seulement par le volume lui-même. La sauvegarde de la base seule se restaure
de la même façon ; les originaux manquants devront être renvoyés.

**Limite à connaître :** les sauvegardes sont dans le MÊME volume que les données. Elles protègent d'une fausse manœuvre ou d'une
mise à jour ratée, pas de la perte du disque. Copier de temps en temps `/data/backup` ailleurs.

## Journal

Au démarrage : `[backup] sauvegardes activées : après 10 min sans modification ou au plus 6 h après la précédente, 3 gardée(s),
médias inclus, dossier /data/backup`. Par sauvegarde : `[backup] portfolio-… .tar.gz : 12,3 Mo en 4,1 s (calme ; 34 média(s),
37 fichier(s)) ; 3 sauvegarde(s) gardée(s), 1 ancienne(s) supprimée(s)`. Un échec s'affiche en `[backup] ÉCHEC…` et n'arrête
jamais le site.

## Restaurer

Conteneur ARRÊTÉ. Le script `restore-backup.mjs` est dans l'image (sans `tar` ni shell : l'image n'en a pas) :

```sh
docker compose stop portfolio
docker compose run --rm --no-deps --entrypoint /nodejs/bin/node portfolio \
  restore-backup.mjs /data/backup/portfolio-AAAAMMJJ-HHMMSS.tar.gz /data
docker compose up -d portfolio
```

(`--list <archive>` affiche seulement le manifest.) Le script : extrait d'abord TOUTE l'archive dans un dossier de travail (une archive
tronquée ou abîmée est refusée avant que quoi que ce soit change), RANGE l'ancienne base (`portfolio.db`, `-wal`, `-shm`) dans
`/data/restore-previous-<date>/` (à supprimer une fois la restauration vérifiée), met la base, les originaux et les polices en place, et
pose `manifest.json` à la racine de `/data`.

Au démarrage suivant, le site voit ce `manifest.json`, remet en file la régénération des variantes d'images, de vidéos et de PDF
dont les fichiers manquent, puis le renomme `manifest.restored.json` (journal : `[backup] restauration détectée : N média(s) remis
en file…`). Les images s'affichent de nouveau au fur et à mesure du traitement.

**À la main, sans le script** (volume visible depuis l'hôte, site arrêté) : SUPPRIMER `portfolio.db-wal` et `portfolio.db-shm`
(un ancien `-wal` fausserait la base restaurée), puis `tar xzf portfolio-….tar.gz -C <dossier du volume>`, puis
`chown -R 1000:1000` sur ce dossier. Le démarrage fait le reste (même `manifest.json`).

## Pour le code

- `src/lib/backup/` : `config.ts` (réglages), `schedule.ts` (déclenchement et rotation, purs, testés avec une horloge simulée),
  `tar.ts` (écriture tar en flux), `archive.ts` (instantané, liste des fichiers, écriture, rotation), `service.ts` (minuterie,
  `data_version`, état), `restore.ts` (variantes à régénérer après restauration). Démarré par `src/lib/db/start.ts` après le worker,
  jamais fatal.
- Tests : `scripts/test-backup.mjs` (`npm test`), `scripts/e2e-backup50.mjs` (suite `backup50`, vrai serveur, restauration de bout en bout).
- Tout nouveau fichier lu à l'exécution hors traçage de Next doit rester dans l'archive (ou être régénérable) : si un nouveau dossier de
  `/data` porte des données NON régénérables, l'ajouter à `src/lib/backup/archive.ts`.
