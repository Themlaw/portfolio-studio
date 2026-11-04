# Sauvegardes automatiques (lot 50)

Le site peut se sauvegarder tout seul dans son propre volume (`/data/backup`). Elle est **désactivée par défaut** : sans
`WITH_BACKUP`, rien ne change et aucun fichier n'est créé.

## Variables d'environnement

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `WITH_BACKUP` | absent (désactivé) | `1` ou `true` pour activer. Absent, `0` ou `false` : aucune sauvegarde, aucun fichier. |
| `BACKUP_QUIET_MIN` | `10` | Minutes sans nouvelle modification avant de sauvegarder (fin d'une session de travail). |
| `BACKUP_MAX_HOURS` | `6` | Au plus N heures entre deux sauvegardes tant qu'il y a des modifications, même si le travail continue. |
| `BACKUP_KEEP` | `3` | Nombre de sauvegardes AUTOMATIQUES gardées (les plus récentes). Voir « Rotation » : d'autres restent en plus. |
| `BACKUP_MAX_DISK_PCT` | `30` | Place totale des sauvegardes, en % de la taille du volume (5 à 90). Environnement seul, jamais réglable depuis l'admin. |
| `BACKUP_MEDIA` | `1` | `0` ou `false` : sauvegarde la base seule (voir « Poids »). |
| `BACKUP_QUIET_SEC` | absent | Quiétude en secondes (tests ; prioritaire sur `BACKUP_QUIET_MIN`). |

Une valeur invalide est remplacée par le défaut, avec un avertissement dans le journal.

## Écran Admin > Sauvegardes (lot 76)

Menu de l'admin, sous Réglages. On y voit : la liste des sauvegardes (date, taille, base seule ou avec médias, version du site et
raison, lues dans `manifest.json` sans décompresser l'archive), l'état (nombre, prochaine sauvegarde prévue ou « aucune modification
en attente », dernière erreur, espace libre du volume), les réglages, « Sauvegarder maintenant » (avec l'avancement) et
« Télécharger » pour chaque archive.

- **Réglages en base.** Ligne `backup` de la table `settings` (JSON `{ enabled, keep, quietMin, maxHours, media }`, chaque champ
  facultatif). Un champ présent PRIME sur l'environnement, qui reste la valeur par défaut ; l'écran dit pour chaque valeur « Réglé
  ici », « Valeur du serveur (VARIABLE) » ou « Valeur d'origine », et « Revenir à la valeur d'origine » retire le champ. Pris en
  compte sans redémarrage. Pas de migration. Même l'activation peut venir de l'admin (sans `WITH_BACKUP`).
- **Sauvegarder maintenant.** Même verrou que les sauvegardes automatiques (une seule à la fois), part tout de suite, fonctionne aussi
  quand les sauvegardes automatiques sont désactivées (le dossier `backup/` est alors créé à ce moment-là). Raison « manuel ».
- **Télécharger.** `GET /api/admin/sauvegardes/<nom>` : session admin vérifiée en base (401 sinon) ET confirmation récente (403 sinon,
  audit de sécurité P2) : connexion de moins de 10 minutes, ou mot de passe retapé dans la fenêtre « Confirmer ton mot de passe »
  (`unlockBackupDownloadAction`, même frein que la connexion, journalisée) qui pose pour 10 minutes un cookie `pf-backup-unlock` lié à
  CETTE session, signé par `BETTER_AUTH_SECRET`, limité au chemin `/api/admin/sauvegardes` (`src/lib/backup/unlock.ts`). Connexion par
  Authentik seulement : se reconnecter. Nom strict
  `portfolio-AAAAMMJJ-HHMMSS[-n].tar.gz` (404 sinon), lecture en flux par blocs de 256 Ko (rien en mémoire), pièce jointe,
  `Range` (206 / 416) et `If-Range` pour reprendre un téléchargement. Pour l'artiste : « Garde une copie sur ton ordinateur de
  temps en temps ».
- Code : `settings.ts` (lecture / écriture des réglages), `download.ts` (nom et Range), `service.ts` (`getBackupStatus`,
  `startBackupNow`, `applyBackupSettings`), `archive.ts` (`readArchiveManifest`), `src/app/admin/(espace)/sauvegardes/`,
  `src/components/admin/BackupPanel.tsx`. Test : suite `admin76`.

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
  fichier en écriture), sans bloquer les écritures. **Sans secrets d'authentification** (audit de sécurité P2, `scrub.ts`, appliqué à la
  copie seulement) : tables `session`, `verification` et `rate_limit` vidées, jetons OAuth de `account` (`access_token`, `refresh_token`,
  `id_token` et leurs dates) effacés, puis `VACUUM` (rien ne reste dans les pages libres). Les comptes et l'empreinte du mot de passe
  restent : après une restauration, il suffit de se reconnecter (mot de passe ou Authentik, qui réécrit ses jetons).
- `media/…` : **tout le stockage, SAUF ce qui est prouvé régénérable** (lot 85, archive par exclusion : un futur dossier que personne
  n'a prévu est sauvegardé par défaut). Y entrent :
  - `originals/` : les ORIGINAUX envoyés ;
  - `kit/` : dessins du kit appliqués aux thèmes (et leurs versions), logo du thème, cadres importés, fichiers d'une archive de thème importée ;
  - `icons/` : icône du site choisie dans la médiathèque (rien ne la recrée après une restauration) ;
  - les variantes d'un média SANS original (vidéo dont l'original est supprimé après conversion, `KEEP_VIDEO_ORIGINALS` absent) et les médias du seed.
- `cache/kits/manifests/` : fiches et aperçus « avant » des kits exportés. Seule exception à l'exclusion de `cache/` : sans elles, un PSD
  exporté avant le déménagement n'est plus reconnu au réimport.
- `fonts/…` : polices installées (quelques centaines de Ko).
- `manifest.json` (premier fichier) : `complete`, `storage` (fichiers et octets par catégorie), `regenerable` (ce qui n'est pas dans
  l'archive parce qu'il se refait), `missingRefs` (voir « Garde-fou »). Un manifest SANS `storage` = archive d'avant le lot 85.
- **Jamais** : `tmp/`, `kit-imports/`, `backup/`, `cache/` (sauf les fiches), les `*.tmp`, et les régénérables :
  - variantes `img/`, `vid/`, `doc/` d'un média dont l'original est présent (le worker les refait) ;
  - `icons-auto/` (icônes automatiques, refaites à la première requête, **à condition que `kit/` soit restauré**).
- `BACKUP_MEDIA=0` : base, polices, `kit/`, `icons/` et fiches de kit seulement (petits et non renvoyables).

### Inventaire de ce que le site écrit dans `/data`

| Où | Écrit par | Catégorie |
| --- | --- | --- |
| `portfolio.db` (+ `-wal`, `-shm`) | tout le site | (a) instantané `.backup` de SQLite |
| `media/originals/` | envois (images, vidéos, PDF) | (a) table `media` |
| `media/img/`, `vid/`, `doc/` | worker | (b) régénérable si l'original est là ; sinon sauvegardé |
| `media/<racine>` (seed) | `db/seed.ts` | (a) |
| `media/kit/` | `kit/apply.ts`, `kit/logo.ts`, `edit/frames.ts`, `themes/transfer.ts` | (c) sauvegardé |
| `media/icons/` | `favicon.ts` (image choisie) | (c) sauvegardé |
| `media/icons-auto/` | `favicon.ts` (auto) | (b) |
| `fonts/` | `fonts/library.ts` | (c) sauvegardé |
| `cache/kits/manifests/` | `kit/manifest.ts`, `kit/build*.ts` | (c) sauvegardé (exception) |
| `cache/crops/`, `cache/kits/*.zip` | recadrages, export du kit | (b) ; `cache/crops` vidé à la restauration |
| `tmp/`, `kit-imports/`, `backup/` | envois, imports de kit, sauvegardes | hors archive |

Le test `scripts/test-storage-writers85.mjs` (dans `npm test`) échoue si un nouveau fichier de `src/` écrit dans `/data` sans être classé
dans cette table.

## Garde-fou : références que l'archive ne contient pas

À chaque sauvegarde, le site cherche dans TOUTE la base (colonnes texte de toutes les tables, thèmes et versions, réglages, pages,
brouillons, blocs, projets, `frameLibrary`…) les adresses `/media/…`, plus les formes qui ne s'écrivent pas ainsi : le dossier de l'icône du
site (`seo.favicon.dir`), les polices de `fontLibrary` et chaque média prêt (original ou variantes). Toute référence dont le fichier n'est
NI dans l'archive NI régénérable est signalée : au journal (`[backup] AVERTISSEMENT : N fichier(s) cité(s)…`), dans `manifest.json`
(`missingRefs`) et en tête de l'écran Sauvegardes. Elle ne bloque jamais la sauvegarde. Le même contrôle se refait au premier démarrage
après une restauration.

## Rotation (audit de sécurité, P1 et P6)

Après chaque sauvegarde réussie (jamais avant), `retentionPlan` (`schedule.ts`, pur) décide ce qui reste :

- les `BACKUP_KEEP` (ou « Nombre de sauvegardes gardées ») sauvegardes **automatiques** les plus récentes ;
- les **3 dernières sauvegardes manuelles** (« Sauvegarder maintenant », raison `manuel` du `manifest.json`), comptées À PART : une
  sauvegarde manuelle ne pousse jamais dehors une sauvegarde automatique. Une archive dont le manifest est illisible compte comme automatique ;
- **toujours**, quel que soit le réglage : la plus récente de toutes, et la plus récente de celles qui ont **plus de 48 heures** (date lue
  dans le nom de l'archive) ;
- **plafond de place** : si le total dépasse `BACKUP_MAX_DISK_PCT` % de la taille du volume, les plus anciennes non protégées partent
  d'abord. Les deux archives protégées restent même si elles dépassent à elles seules (avertissement `[backup] AVERTISSEMENT : les
  sauvegardes gardées dépassent…`).

Pourquoi : avec une session admin volée, il suffisait de régler « garder 1 » puis de cliquer sur « Sauvegarder maintenant » pour effacer
toutes les sauvegardes d'avant l'intrusion. Désormais l'archive de l'avant-veille survit, et le plafond n'est pas réglable depuis l'admin.
Limite : un attaquant qui garde l'accès plus de 48 h finit par faire tourner aussi cette archive ; seule une copie HORS du serveur
(ci-dessous) protège de ce cas, et de la perte du disque.

## Copie hors du serveur, tirée par l'hôte (chiffrée avec `age`)

Les sauvegardes sont dans le MÊME volume que le site : une application compromise peut les lire et les supprimer. La copie de sécurité
doit donc être **tirée par l'hôte** (ou mieux, par une autre machine), jamais poussée par l'application : le conteneur n'a ni clé ni accès
à la destination. Elle est **chiffrée** (l'archive contient la base) avec [`age`](https://age-encryption.org), vers une clé publique ;
la clé privée n'est PAS sur le serveur (gestionnaire de mots de passe, clé USB).

Une fois, sur un poste de confiance : `age-keygen -o portfolio-backup.key` (garder ce fichier hors du serveur) ; noter la ligne
`Public key: age1…`. Sur l'hôte (hote-de-prod) : `apt install age`, puis un script lancé par cron, par exemple `/usr/local/sbin/portfolio-offsite.sh` :

```sh
#!/bin/sh
# Copie chiffrée des sauvegardes du portfolio vers un autre disque. Lancé par l'hôte, jamais par le conteneur.
set -eu
SRC=/var/lib/docker/volumes/portfolio_portfolio-data/_data/backup   # adapter au nom du volume (docker volume ls)
DST=/mnt/sauvegardes/portfolio                                      # autre disque, ou point de montage distant
RECIPIENT=age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
umask 077
mkdir -p "$DST"
for f in "$SRC"/portfolio-*.tar.gz; do
  [ -f "$f" ] || continue
  out="$DST/$(basename "$f").age"
  [ -e "$out" ] && continue                     # déjà copiée : une archive ne change plus une fois renommée
  age -r "$RECIPIENT" -o "$out.part" "$f" && mv "$out.part" "$out"
done
# Rétention de la copie : 60 jours, indépendante de celle du site (qu'un attaquant peut régler).
find "$DST" -name 'portfolio-*.tar.gz.age' -mtime +60 -delete
```

Crontab de root : `17 3 * * * /usr/local/sbin/portfolio-offsite.sh`. Seuls les `portfolio-*.tar.gz` sont lus (jamais les `.tmp` en
cours d'écriture, qui ont un autre nom). Mieux encore : une AUTRE machine qui vient chercher les fichiers (`rsync` par une clé SSH en
lecture seule sur `$SRC`), puis chiffre chez elle : un serveur compromis ne peut alors ni effacer ni modifier les copies. Un stockage
distant (`rclone`, S3…) doit être en ajout seul (pas de droit de suppression pour la clé de l'hôte).

Restaurer depuis la copie : `age -d -i portfolio-backup.key -o portfolio-….tar.gz portfolio-….tar.gz.age`, puis « Restaurer » ci-dessous.
Vérifier de temps en temps qu'une copie se déchiffre et que `restore-backup.mjs --list` la lit.

## Cohérence base / fichiers

La base est figée d'abord, les fichiers sont lus ensuite. Deux accidents sont refusés (la sauvegarde est reportée et réessayée,
l'ancienne archive reste) : un fichier qui rétrécit ou disparaît pendant la copie (jamais une archive complétée de zéros qui a l'air bonne),
et une conversion de vidéo à cheval sur l'instantané dont l'original a été supprimé depuis (la vidéo serait perdue).

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

Mesure du lot 85 (données synthétiques, kit complet de 28 fichiers environ, trois jeux, un cadre PNG et un SVG, une icône en image) : l'archive passe de
5,3 Mo à 9,2 Mo, soit +3,9 Mo, dont 2,7 Mo pour 83 fichiers de `kit/` (environ 0,9 Mo par kit complet) et 1,2 Mo pour l'icône en image. Un kit
réel peut peser plus : compter quelques Mo par kit gardé dans les versions de Mon thème. Avec les médias, chaque sauvegarde pèse à peu près la somme des originaux (déjà compressés : gzip n'y gagne presque rien) ; trois
sauvegardes gardées = environ trois fois cette somme dans le volume. Si la médiathèque est grosse, `BACKUP_MEDIA=0` ne sauvegarde que
la base (quelques Mo) : les médias restent protégés seulement par le volume lui-même. La sauvegarde de la base seule se restaure
de la même façon ; les originaux manquants devront être renvoyés.

**Limite à connaître :** les sauvegardes sont dans le MÊME volume que les données. Elles protègent d'une fausse manœuvre ou d'une
mise à jour ratée, pas de la perte du disque ni d'une intrusion longue : voir « Copie hors du serveur, tirée par l'hôte ».

## Journal

> Lot 97 : le journal d'ÉDITION (qui a modifié quoi, `edit-log.db`) est un autre fichier, hors archive ; une restauration ne le touche pas. Voir `docs/JOURNAL.md`.

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
pose `manifest.json` à la racine de `/data`. Il VIDE `cache/crops` (indexé par identifiant de média : une base plus ancienne pourrait
resservir le recadrage d'une autre image), refuse une archive plus RÉCENTE que le site (`--force` pour passer outre, à tes risques),
et avertit si l'archive date d'avant le lot 85 (restaurée quand même : ni kit, ni cadres importés, ni icônes) ou cite des fichiers absents.

Au démarrage suivant, le site voit ce `manifest.json`, remet en file la régénération des variantes d'images, de vidéos et de PDF
dont les fichiers manquent, puis le renomme `manifest.restored.json` (journal : `[backup] restauration détectée : N média(s) remis
en file…`). Les images s'affichent de nouveau au fur et à mesure du traitement.

**À la main, sans le script** (volume visible depuis l'hôte, site arrêté) : SUPPRIMER `portfolio.db-wal` et `portfolio.db-shm`
(un ancien `-wal` fausserait la base restaurée), puis `tar xzf portfolio-….tar.gz -C <dossier du volume>` (qui remet `media/kit`, `media/icons` et `cache/kits/manifests`), supprimer `cache/crops`,
puis `chown -R 1000:1000` sur ce dossier. Le démarrage fait le reste (même `manifest.json`).

## Déménager le site (autre hébergeur)

1. Sur le NOUVEL hôte : image de la même version que la sauvegarde **ou plus récente**, volume NEUF, restauration AVANT le premier démarrage
   (sinon le seed crée des médias de démonstration orphelins).
2. À recopier à la main, car hors archive (volontairement) :
   - **`PUBLIC_BASE_URL`** : OBLIGATOIRE. Son défaut est l'ancien domaine : sans elle, l'origine de connexion de l'admin est refusée, et canonical, hreflang et sitemap pointent vers l'ancien site ;
   - **`BETTER_AUTH_SECRET`** (voir ci-dessous) ;
   - `AUTH_OIDC_*`, `AUTH_ADMIN_GROUP/SUBS`, `ADMIN_EMAILS`, `AUTH_PASSWORD_DISABLED` : si l'admin ne se connecte que par Authentik, le nouvel hôte doit pouvoir le joindre, sinon on est enfermé dehors ; `AUTH_TRUSTED_PROXY_HOPS` (nombre de proxys, pour la limitation de débit) ;
   - **`KEEP_VIDEO_ORIGINALS`** : décide si les vidéos se régénèrent ; sans original gardé, leurs fichiers servis sont dans l'archive ;
   - `MEDIA_MAX_TOTAL_GB` (une médiathèque restaurée au-dessus du quota bloque les envois suivants) et les bornes du worker (`MAX_IMAGE_MB`, `IMAGE_HEAVY_MPX`, `IMAGE_DECODE_BUDGET_MB`, `MEMORY_GATE`, `JOB_MAX_DURATION_S`, `KIT_*`) : des bornes plus basses font échouer la régénération d'images acceptées autrefois ;
   - `WITH_BACKUP` et `BACKUP_*` (le réglage de l'admin, en base, prime), `TZ` (affichage seulement) ;
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` sont inutiles : ignorés dès qu'un utilisateur existe.
3. Copier aussi `/data/backup` ailleurs : il est dans le même volume.
4. **Si `BETTER_AUTH_SECRET` change** : toutes les sessions tombent (se reconnecter), les jetons de réinitialisation et d'état OAuth en cours sont
   invalides, et toute URL de recadrage déjà diffusée (`/media/crop/…`, signée avec ce secret : HTML en cache, image de partage sur un
   réseau social) répond 404 jusqu'à sa remise en cache. Le site re-signe tout seul ses propres pages. Les jetons OAuth d'Authentik sont
   chiffrés avec ce secret (`encryptOAuthTokens`) mais le site ne les relit jamais, et la sauvegarde ne les contient pas : la prochaine
   connexion les réécrit. Rien d'autre (mots de passe et empreintes des messages n'en dépendent pas).
5. Limites : après la restauration, les images n'apparaissent qu'à mesure que le worker refait leurs variantes (durée selon l'hôte) ; une
   image qui échoue sous des bornes plus basses reste invisible. Les octets des variantes peuvent différer si la version de `sharp` change.
   Perdus : envois par morceaux en cours, imports de kit analysés mais pas appliqués (`kit-imports/` : renvoyer le PSD, ses fiches sont gardées).

## Pour le code

- `src/lib/backup/` : `config.ts` (réglages), `schedule.ts` (déclenchement et rotation, purs, testés avec une horloge simulée),
  `tar.ts` (écriture tar en flux), `archive.ts` (instantané, liste des fichiers, écriture, rotation), `service.ts` (minuterie,
  `data_version`, état), `restore.ts` (variantes à régénérer après restauration). Démarré par `src/lib/db/start.ts` après le worker,
  jamais fatal.
- Tests : `scripts/test-backup.mjs` (`npm test`), `scripts/e2e-backup50.mjs` (suite `backup50`, vrai serveur, restauration de bout en bout).
- `refs.ts` (garde-fou), `archive.ts` (`storageToSave` : exclusion, jamais liste). Un nouveau dossier sous `media/` est sauvegardé tout seul ;
  un nouveau dossier de `/data` HORS `media/` et `fonts/` qui porte des données non régénérables doit être ajouté à `archive.ts` ET au motif
  `TOP` de `scripts/restore-backup.mjs`, puis classé dans `scripts/test-storage-writers85.mjs`.
- Tests : `scripts/e2e-backup85.mjs` (suite `backup85`, aller-retour complet sur volume neuf, archive d'avant le lot).
