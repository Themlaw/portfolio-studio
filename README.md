# Portfolio

Portfolio d'artiste — Next.js 16 (App Router) + TypeScript + Tailwind v4 + next-intl (fr/en).

## Développement

Sur la VM de dev (`vm-dev`, dossier `~/portfolio`, Node 24 via nvm) :

```bash
. ~/.nvm/nvm.sh
npm ci
npm run dev -- -p 3001      # http://192.0.2.10:3001 (ou portfolio.example.org)
npx tsc --noEmit            # typecheck
npm run lint
npm run build:local        # build à mémoire réduite (VM de dev) ; la CI utilise npm run build
PORT=3001 node verify.mjs   # harnais de régression Playwright (serveur dev lancé)
```

Les scripts Playwright ponctuels (captures, contrôles) sont dans `scripts/`.

### Scripts d'installation des paquets désactivés (`.npmrc`)

Le `.npmrc` du dépôt pose `ignore-scripts=true` : `npm ci` / `npm install` n'exécutent
**aucun** script `preinstall` / `install` / `postinstall` des paquets (un paquet compromis
ne tourne pas en root sur la VM au moment de l'installation). Comme en CI et dans l'image.

Vérifié par un `npm ci` complet sous ce `.npmrc` (dossier vide) : **rien à reconstruire**.
Les paquets qui déclarent un script fonctionnent sans lui :

| Paquet | Pourquoi ça marche sans script |
|---|---|
| `better-sqlite3` | binaires N-API précompilés dans `prebuilds/` (le script ne ferait qu'un `node-gyp rebuild`) |
| `esbuild` (direct, `tsx`, `drizzle-kit`) | `bin/esbuild` reste le lanceur JS, qui appelle le binaire du paquet optionnel `@esbuild/linux-x64` (le script ne fait que le recopier, pour gagner quelques ms au démarrage) |
| `@swc/core` (via `next-intl`), `@parcel/watcher`, `unrs-resolver` | binaire du paquet optionnel de la plateforme (`@swc/core-linux-x64-gnu`…), chargé directement |
| `fsevents` | macOS seulement |

`sharp`, `lightningcss`, `@tailwindcss/oxide`, `@next/swc-*`, `@neplex/vectorizer` n'ont pas
de script (paquets optionnels par plateforme).

Si un paquet en a vraiment besoin un jour, le reconstruire **explicitement**, en levant le
drapeau pour cette seule commande (sans lui, `npm rebuild` ne fait que relier les binaires
et n'exécute rien) :

```bash
npm rebuild <paquet> --ignore-scripts=false     # ex. npm rebuild esbuild --ignore-scripts=false
```

et ajouter l'étape équivalente au Dockerfile (`RUN npm rebuild <paquet>`, l'image passe
`--ignore-scripts`) et à la CI. `npm run <script>` n'est pas concerné (les scripts du
projet tournent) ; seuls les scripts `pre…` / `post…` du projet seraient ignorés (il n'y en a
aucun : ne pas en ajouter).

## Thèmes

Le rendu est piloté par un thème (tokens + variantes + assets), voir
`docs/ARCHITECTURE.md` et `src/themes/`. Presets livrés :

| id | Direction |
|---|---|
| `galerie-lumineuse` (défaut) | papier clair, hero parallaxe, planches à vif |
| `pro` | état du tag `da/pro` : étiquettes grises, calques du hero plus neutres |
| `salle-de-projection` | sombre, hero « spotlight » ambre, lightbox plein cadre |
| `carnet-d-atelier` | papier pointillé, hero typographique, planches scotchées, légendes manuscrites |

- Thème actif : en base (`settings.activeThemeId`), appliqué à l'exécution, sans
  rebuild. `PORTFOLIO_THEME` ne sert qu'au seed initial (volume vide).
- Aperçu (développement uniquement ; phase 3 : admins connectés) : ouvrir
  `/api/theme-preview?id=<id>`, qui active le draft mode de Next (rendu hors
  cache ISR) ; `?id=` le désactive. Un visiteur anonyme reçoit toujours la page
  en cache, jamais un aperçu.
- Contrôles : `npm run check:tokens` (aucune couleur en dur hors `src/themes/`),
  `npm run check:contrast` (AA ≥ 4,5:1 des tokens pour chaque preset), bloquants
  en CI ; `PORT=3001 npm run check:contrast:render` (contraste mesuré au pixel sur
  le rendu, serveur dev requis), obligatoire en local avant de valider un thème.

## Données

Tout le contenu vient d'une base SQLite, sans admin pour l'instant : le seed fait foi.

- Fichier `${DATA_DIR}/portfolio.db` (`/data` en prod, `./data` en dev, ignoré
  par git) ; médias dans `${DATA_DIR}/media/` (clés `<hash>-<nom>`).
- Au démarrage du serveur (`src/instrumentation.ts`) : migrations `./drizzle`,
  puis seed si la base est vide (`seed/` : `site.ts` pour les pages, blocs et
  réglages ; `artworks.json`, `projects.json` ; `media/`).
- Repartir de zéro en dev : arrêter le serveur, `rm -rf data`, relancer.
- Modifier le schéma : `src/lib/db/schema.ts`, puis
  `npx drizzle-kit generate --name <nom>` et commiter la migration.
- Pages : route unique `src/app/[locale]/[[...slug]]`, slugs localisés en base ;
  une page = une liste de blocs (`src/blocks/registry.ts`).
- 404 : `src/proxy.ts` vérifie le slug sur l'URL brute et sert la page réservée
  `/<langue>/_404` (rendu serveur complet, thème, en-tête et pied) avec le statut
  404 et `Cache-Control: no-store`.
- `PUBLIC_BASE_URL` (défaut `https://portfolio.example.org`) : base des URL
  absolues (canonical, hreflang).
- `REDIRECT_FROM` (défaut vide) : ancien(s) domaine(s), séparés par des virgules,
  renvoyés vers `PUBLIC_BASE_URL` (même chemin, même requête ; 301 en GET/HEAD,
  308 sinon). Mode d'emploi : `docs/DOMAINE.md`.
- Médias : `GET /media/<clé>` (Range 206/416, ETag 304 en comparaison faible,
  cache immuable, `nosniff`, CSP `default-src 'none'; style-src 'unsafe-inline';
  sandbox` sur tous les médias). Stockage : liens symboliques et non-fichiers refusés.
- Seed : une seule fois dans la vie de la base (marqueur `settings.seededAt`) ;
  migrations et seed sous `BEGIN IMMEDIATE` (plusieurs processus sur une base
  vide : un seul seed). Échec au démarrage → arrêt du processus (code 1).
- Tests : `npm test` (références blocs → médias/pages).

### Cache

Lectures en base via `unstable_cache` étiquetées (`theme`, `settings`, `nav`,
`page:<id>`, `project:<id>`, `projects`, `media`) ; pages publiques rendues à la
première visite puis servies depuis le cache (ISR à la demande, rien n'est
généré au build, qui se fait donc sans base). Invalidation :
`src/lib/revalidate.ts`. Cache ISR en mémoire (`isrFlushToDisk: false`,
conteneur en lecture seule) : il repart à vide à chaque redémarrage.

## Administration et authentification

`/admin` (en français, hors i18n, interface indépendante du thème public) :
tableau de bord, Thèmes, Pages, Projets, Médiathèque, Réglages (avec un
**Diagnostic** réseau). Connexion sur `/admin/connexion`. Pages toujours dynamiques,
`noindex`, interdites dans `robots.txt`.

Authentification : [Better Auth](https://www.better-auth.com) 1.7 (adaptateur
Drizzle, tables `user`, `session`, `account`, `verification`, `rate_limit`,
`oidc_identity`, `auth_throttle` dans la même base SQLite). Pas d'inscription
publique : tout utilisateur est administrateur.

| Variable | Rôle |
|---|---|
| `BETTER_AUTH_SECRET` | **Obligatoire en production**, ≥ 32 caractères (`openssl rand -base64 48`). Sans lui, le serveur refuse de démarrer. |
| `PUBLIC_BASE_URL` | URL publique exacte (`https://…`, sans `/` final). Sert d'origine de confiance : si elle diffère de l'origine réelle du navigateur, **toutes les connexions renvoient 403**. En http en production, avertissement au démarrage (cookies `Secure` non renvoyés). |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Premier administrateur, créé au démarrage **si aucun utilisateur n'existe** (le mot de passe n'est jamais journalisé). Ensuite, `ADMIN_PASSWORD` est ignoré (avertissement) : le retirer. |
| `AUTH_OIDC_ISSUER`, `AUTH_OIDC_CLIENT_ID`, `AUTH_OIDC_CLIENT_SECRET` | Connexion Authentik (les trois, sinon désactivée avec avertissement). |
| `AUTH_ADMIN_GROUP` | **Recommandé** : groupe Authentik autorisé (claim `groups`). L'appartenance se gère dans Authentik. |
| `AUTH_ADMIN_SUBS` | Identifiants Authentik (`sub`) autorisés, séparés par des virgules. Le plus strict. |
| `ADMIN_EMAILS` | E-mails autorisés, **seulement si Authentik les déclare vérifiés** (`email_verified: true`). **Mode le plus faible** : il suppose une instance Authentik sans auto-inscription et où un utilisateur ne peut pas changer librement son e-mail. Préférer le groupe ou les `sub`. |
| `AUTH_PASSWORD_DISABLED` | `true` coupe le mot de passe (et `/change-password`, `/set-password`…) **seulement si** l'OIDC est complet ; sinon ignoré (avertissement) pour ne jamais s'enfermer dehors. |
| `AUTH_TRUSTED_PROXY_HOPS` | Nombre de proxys de confiance devant le site (défaut `1`). L'IP client est l'entrée n°N de `X-Forwarded-For` en partant de la droite. À régler avec Réglages → Diagnostic après déploiement. |

### Éditeurs (phase 4a)

- **Thèmes** : mettre en ligne (confirmation « actuel → nouveau », avec
  « Prévisualiser d'abord ↗ »), prévisualiser, dupliquer, modifier (thèmes
  personnels seulement : un thème livré se duplique d'abord), supprimer (thème
  personnel hors ligne). Éditeur `/admin/themes/<id>` : couleurs avec contraste
  en direct (moins de 4,5:1 → enregistrement refusé, bouton « Ajuster à la teinte
  la plus proche qui passe »), typographies, formes (vignettes), arrondis et
  espacements ; aperçu en direct de l'accueil dans un cadre (onglet sous 1100px).
- **Pages** : liste (adresses fr/en, publiée, menu), ordre du menu par
  glisser-déposer (clavier : Espace, flèches, Espace), création (adresses
  proposées depuis les titres), publier/dépublier, suppression bloquée si des
  blocs pointent vers la page. Éditeur `/admin/pages/<id>` : titre, adresses,
  référencement, accent de page (contrôlé AA contre le thème en ligne), blocs.
  **Enregistrer publie aussitôt** une page publiée : il n'y a pas de brouillon
  séparé ; « Prévisualiser la page ↗ » montre la version enregistrée (pages non
  publiées comprises, pour l'admin connecté seulement).
- **Réglages** : nom, métier, e-mail, mention de pied (fr/en), réseaux (https
  uniquement).

Rien n'est enregistré sans le bouton « Enregistrer » ; quitter un écran modifié
demande confirmation. Toutes les écritures passent par des server actions
(`assertAdmin()` + validation zod côté serveur, contraste compris) puis
invalident les étiquettes de cache concernées : un visiteur voit le changement
à la requête suivante, sans redémarrage.

Tests : `npm run test:e2e` (parcours complet des éditeurs, Playwright, serveur
dev **redémarré puis pré-chauffé**, une connexion) et `npm run shots:editors`
(captures → `screenshots/phase4a/`). Ils restaurent l'état initial.

### Projets, planches et médiathèque (phase 4b)

- **Projets** (`/admin/projets`) : cartes réordonnables, « Nouveau projet », suppression
  (bloquée si un bloc « Projets mis en avant » le cite ; les images restent dans la
  médiathèque).
- **Planche** (`/admin/projets/<id>`) : dépose des images sur la bande (en fin) ou sur un
  emplacement vide ; réordonne par la poignée (clavier : Espace, flèches, Espace) ; clique
  sur une image pour son panneau (titre, description, collection, année, mis en avant, texte
  alternatif ; remplacer, retirer en gardant la place, supprimer l'emplacement). Les
  emplacements vides sont masqués sur le site.
- **Médiathèque** (`/admin/medias`, ancienne adresse `/admin/mediatheque` redirigée) :
  filtres, recherche, envoi, détail avec « Utilisée dans… », suppression.
- **Formats acceptés** : JPEG, PNG, WebP, AVIF, GIF (première image), reconnus par leur
  contenu ; 200 Mo, 100 mégapixels et 32 768 px de côté au plus (PNG entrelacé et JPEG progressif : 350 Mo de mémoire de décodage au plus). Les métadonnées (EXIF,
  GPS) sont retirées, et seul le site sert les variantes AVIF/WebP : l'original est
  conservé, jamais servi.
- **Titres** : une image envoyée n'a pas de titre ; le panneau propose un « Titre
  suggéré » tiré du nom du fichier, appliqué d'un clic. Le nom du fichier n'est jamais
  publié. Sans titre, la planche publique n'affiche que l'année.
- Un emplacement vidé garde la largeur de l'image retirée.

| Variable | Rôle |
|---|---|
| `MAX_IMAGE_MB` | Taille maximale d'une image envoyée (défaut 200). La lecture s'arrête dès le dépassement. |
| `MEDIA_MAX_TOTAL_GB` | Quota facultatif de stockage des médias (originaux + variantes). Au-delà, envoi refusé (« Ton espace de stockage est plein… ») ; l'occupation s'affiche dans la médiathèque. Absent = sans limite (comportement d'avant). **Recommandé en production** : sans lui, un compte admin compromis ou un script qui boucle remplit `/data` (base, sauvegardes, journal). Le régler en laissant la place des sauvegardes. |
| `UPLOAD_MIN_FREE_MB` | Espace laissé libre sur le disque des données (défaut 512 Mo, `0` = aucune garde) : un envoi, ou un morceau d'envoi, qui le consommerait est refusé (507 « Le disque du serveur est presque plein… »), avec ou sans quota. Un administrateur a au plus 10 envois par morceaux ouverts à la fois. |
| `UPLOAD_IDLE_TIMEOUT_S` | Abandon d'un envoi qui ne reçoit plus rien (défaut 30 s), fichier temporaire supprimé. |
| `UPLOAD_MAX_DURATION_S` | Durée totale maximale d'un envoi (défaut 600 s). |
| `JOB_MAX_DURATION_S` | Durée maximale d'un traitement d'image (défaut 120 s) ; au-delà, l'image passe en échec. |
| `MAX_MEGAPIXELS_16BIT` | Plafond facultatif pour les PNG 16 bits (défaut : 100, comme les autres). |
| `WITH_BACKUP` | `1` ou `true` active les sauvegardes automatiques dans `/data/backup` (défaut : désactivées, aucun fichier créé). Détail et restauration : docs/SAUVEGARDES.md. |
| `BACKUP_QUIET_MIN` | Minutes sans modification avant une sauvegarde (défaut 10). |
| `BACKUP_MAX_HOURS` | Au plus N heures entre deux sauvegardes tant qu'il y a des modifications (défaut 6). |
| `BACKUP_KEEP` | Nombre de sauvegardes gardées (défaut 3). |
| `BACKUP_MEDIA` | `0` ou `false` : base seule, sans les médias (défaut : médias inclus). |

Tests : `npm run test:e2e` lance aussi `scripts/e2e-planche.mjs` ; captures :
`npm run shots:planche` (→ `screenshots/phase4b/`).

### Vidéos (phase 5)

- **Envoi par morceaux** (vidéos, et images de plus de 8 Mo) : morceaux de 8 Mo,
  reprise automatique après une coupure (3 essais, délai croissant), progression réelle.
  Un envoi interrompu se reprend depuis la médiathèque (« Envois interrompus » : choisir
  de nouveau le même fichier) ; il est purgé après 24 h sans nouvelle.
- **Formats** : MP4/MOV et WebM/Matroska, reconnus par leur contenu puis confirmés par
  ffprobe (piste vidéo réelle). Codecs acceptés : vidéo H.264, HEVC, VP8, VP9, AV1,
  ProRes, MPEG-4 ; son AAC, MP3, Opus, Vorbis, FLAC, ALAC, PCM. Durée, dimensions et poids
  limités (voir ci-dessous).
- **Conversion** (ffmpeg, une à la fois, file séparée des images) : `1080.mp4` (si la
  source atteint 1080p) et `720.mp4` en H.264 High, CRF 22, AAC 128k (ou sans son),
  rotation appliquée, sans métadonnées ; poster WebP vers 10 % de la durée. La
  médiathèque et la planche affichent « Conversion… 42 % » ; « Réessayer » relance un échec.
- **Site** : une vidéo muette de moins de 20 s est une **boucle** (muette, en boucle,
  jouée seulement quand elle est visible, fixe avec ▶ si « réduire les animations ») ; les
  autres montrent leur poster et leur durée dans la planche et se lisent dans la
  visionneuse. Le bloc vidéo (page Animation) accepte une demoreel de la médiathèque
  (titre = texte alternatif, durée du média) en plus du lien YouTube existant.

| Variable | Rôle |
|---|---|
| `MAX_VIDEO_MB` | Poids maximal d'une vidéo (défaut 2048), vérifié dès l'annonce de l'envoi. |
| `MAX_VIDEO_DURATION_S` | Durée maximale (défaut 1800), lue par ffprobe avant la conversion. |
| `MAX_VIDEO_DIMENSION` | Plus grand côté (défaut 3840), lu par ffprobe. |
| `VIDEO_JOB_MAX_DURATION_S` | Durée maximale d'une conversion (défaut 3600) ; au-delà, ffmpeg est arrêté et la vidéo passe en échec. |
| `KEEP_VIDEO_ORIGINALS` | `true` garde le fichier envoyé après conversion (régénération future possible). Défaut `false` : l'original est supprimé une fois les sorties validées, pour économiser le disque ; « Réessayer » reste possible tant que la conversion n'a pas réussi. |

Tests : `node scripts/e2e-video.mjs` (inclus dans `npm run test:e2e`) ; captures :
`npm run shots:video` (→ `screenshots/phase5/`).

### Envoi unifié et tags (phase 6a)

- **Un seul composant d'envoi** (planche, au-dessus de la bande ; sélecteur de média
  des blocs ; médiathèque) : une ligne quand il est vide, un panneau d'aperçus dès
  qu'il reçoit des fichiers (aperçu local immédiat, première image d'une vidéo ou
  icône si le navigateur ne la décode pas), une barre de progression par fichier,
  puis un bilan (« 4 fichiers ajoutés à ta bibliothèque »). L'envoi part aussitôt.
- **Tags** : un champ pour le lot, et en option par fichier (« Tags de ce
  fichier »). Ils partent avec le fichier (le serveur les attache au média créé ;
  un fichier déjà connu reçoit les nouveaux tags) ; ceux ajoutés pendant ou après
  l'envoi sont synchronisés dès que le média existe.
- **Champ de tags** : recherche et création dans le même champ ; « Créer « mot » »
  en premier, sauf si un tag identique (sans accents ni casse) existe ; Entrée
  valide, Retour arrière sur le champ vide sélectionne puis retire la dernière
  pastille, Échap ferme. 40 caractères par tag, 20 tags par fichier, 500 tags
  utilisés en tout (un tag posé sur aucun média ne compte pas ; l'onglet Tags
  propose « Supprimer les tags inutilisés »).
- **File d'envoi globale** : elle continue quand tu changes d'écran ; « 2 envois en
  cours » dans la barre latérale l'ouvre. Échec : « Réessayer » (reprise là où
  l'envoi s'est arrêté) ; quota plein : refus définitif.
- **Planche** : sous l'envoi, le bandeau « Bibliothèque » (plus récents d'abord,
  filtre par tags, recherche) ; une vignette se glisse dans la bande, entre deux
  emplacements ou sur un emplacement vide, ou s'ajoute à la fin avec « + ». Un
  média en conversion se place (l'emplacement montre son état) ; un média en échec,
  non. Déposer des fichiers sur la bande ou sur un emplacement vide reste possible.
- **Kit Photoshop** (thèmes) : « Télécharger le kit Photoshop » (éditeur et liste
  des thèmes) génère un PSD pré-rempli avec l'état enregistré du thème (quelques
  secondes ; il attend la fin d'une conversion vidéo en cours). « Kit rempli… »
  (/admin/themes/<id>/kit) : renvoyer le PSD peint, relire chaque élément
  (redessiné, inchangé, à corriger), puis « Appliquer au thème » : une copie
  brouillon à prévisualiser, le thème en ligne ne change pas. Voir
  `docs/THEME-KIT.md`.
- **Médiathèque** : filtre par tags (tous les tags choisis), tags dans le détail,
  sélection multiple (« Ajouter des tags » / « Retirer des tags »), onglet « Tags »
  (renommer, fusionner, supprimer avec le nombre de médias concernés).

Tests : `node scripts/e2e-tags.mjs` (inclus dans `npm run test:e2e`, captures
`screenshots/phase6a/`) ; `scripts/test-tags.mjs` (règles pures, dans `npm test`).

### Éditeur visuel (phase 7a)

`/admin/pages/<id>/editer` : la page s'édite sur le site lui-même (toile en
iframe, vue brouillon), avec enregistrement automatique du brouillon et
« Publier ». Ouverture depuis la liste des Pages, le Tableau de bord, ou le
bouton « Modifier cette page » du site (admin connectée seulement). Détails :
docs/ARCHITECTURE.md, « Éditeur visuel : brouillon et publication ».

- **HTTPS (ou localhost) requis pour la toile.** La route de la toile
  (`/admin/api/editeur/toile`) n'accepte qu'une requête de la même origine,
  reconnue par l'en-tête `Sec-Fetch-Site` ; les navigateurs ne l'envoient
  qu'en contexte sécurisé. En HTTP sur une autre adresse (ex.
  `http://192.0.2.10:3001`), la toile répond **403** : passer par l'URL
  HTTPS (proxy) ou `http://localhost:3001` (tunnel SSH).
- Deux onglets, ou l'éditeur et le formulaire, ne s'écrasent jamais :
  chaque écriture porte la version lue ; si la page a changé ailleurs,
  l'écriture est refusée et l'éditeur propose de recharger.
- Planches : le bloc « Planche d'un projet » se crée sur la page (nom du projet,
  ou projet existant) ; images glissées depuis l'onglet Médias ou depuis
  l'ordinateur, à la position voulue ; barre au survol d'une image (Remplacer,
  Supprimer, Retirer la place). Un projet créé ainsi reste invisible partout
  jusqu'à la publication de la page.
- Tests : `npm run test:e2e-editor` et `npm run test:e2e-boards` (serveur dev
  redémarré, un chromium).

### Authentik (réglages exacts)

1. *Applications → Providers → Create* : **OAuth2/OpenID Provider**.
   - *Client type* : **Confidential** ; noter le *Client ID* et le *Client Secret*.
   - *Redirect URIs/Origins* (mode *strict*) :
     `https://portfolio.example.org/api/auth/callback/authentik`
     (= `${PUBLIC_BASE_URL}/api/auth/callback/authentik`). Better Auth 1.7 utilise le
     callback standard `/callback/<id>`, **pas** `/oauth2/callback/<id>` (vérifié de
     bout en bout par `npm run test:auth`).
   - *Signing Key* : une clé RS256 (celle d'Authentik par défaut convient).
   - *Scopes* : `openid`, `email`, `profile` (mappings par défaut
     `authentik default OAuth Mapping: OpenID 'openid' / 'email' / 'profile'`) ; le
     claim **`groups`** est fourni par le mapping `profile` par défaut.
   - *Subject mode* : **Based on the User's hashed ID** (défaut) : c'est la valeur
     `sub` à mettre dans `AUTH_ADMIN_SUBS` (une connexion refusée l'écrit dans les
     journaux du serveur : « connexion Authentik refusée (sub « … ») »).
2. *Applications → Create* : lier le provider ; slug par ex. `portfolio`.
   `AUTH_OIDC_ISSUER` = `https://auth.example.org/application/o/portfolio`
   (découverte `/.well-known/openid-configuration`, PKCE S256, nonce).
3. Créer le groupe (ex. `admins-portfolio`), y mettre l'artiste, et fixer
   `AUTH_ADMIN_GROUP=admins-portfolio`. Optionnel : lier l'application à ce groupe
   (*Policy / Group / User Bindings*) pour qu'Authentik refuse aussi en amont.
4. Pas d'auto-inscription sur ce flux ; si `ADMIN_EMAILS` est utilisé, laisser la
   vérification d'e-mail active et interdire le changement d'e-mail libre.

Comportement : un compte non autorisé est refusé sans rien créer ; une identité
Authentik qui porte l'e-mail d'un compte existant n'est **jamais liée** à lui (même
message que tout autre refus : l'existence du compte n'est pas révélée) ;
l'autorisation est **revérifiée à chaque requête** contre la configuration courante,
et une identité refusée à la reconnexion (ex. retirée du groupe dans Authentik) perd
aussi ses sessions en cours.

### Sécurité

- Cookies `Secure`/`HttpOnly`/`SameSite=Lax` en production ; garde en profondeur
  (proxy → layout de l'admin → `assertAdmin()` dans chaque server action, 403 sinon).
- Limitation, appliquée avant Better Auth : **5 tentatives par minute et par IP**
  (IP calculée avec `AUTH_TRUSTED_PROXY_HOPS`), toutes comptées, refus compris ;
  puis un **délai progressif par couple (e-mail, IP)** (à partir de 5 échecs en
  15 min : 2, 4, 8… s, plafond 60 s). Un attaquant ne ralentit que ses propres
  tentatives : l'administrateur, depuis une autre IP, n'est jamais bloqué. Alerte
  dans les journaux au-delà de 20 échecs par heure sur un même compte.
- En-têtes : `X-Frame-Options: DENY`, `frame-ancestors 'none'`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `nosniff`, `Permissions-Policy`,
  pas de `X-Powered-By`. L'admin a une CSP complète à nonce (`script-src 'nonce-…'
  'strict-dynamic'`, sans `unsafe-eval` en production). Le site public garde une CSP
  minimale (`frame-ancestors`) : ses pages sont en cache ISR, un nonce par requête y
  est impossible, et l'embed YouTube du bloc vidéo reste permis.
- Aperçu de thème : Admin → Thèmes → « Prévisualiser sur le site » ouvre le site
  dans un **nouvel onglet** (formulaire natif vers `POST /admin/apercu` : session
  admin + même origine). Un bandeau « Aperçu : <thème> · Quitter l'aperçu » (UI de
  l'admin) reste fixé en bas du site tant que l'aperçu dure ; il n'existe que dans
  les requêtes en draft mode, jamais dans le HTML en cache public. Fin de l'aperçu
  à la déconnexion. `/api/theme-preview` n'existe qu'en développement.
- Sessions (audit de sécurité P3) : expiration après **3 jours sans utilisation**, et au plus tard **7 jours après la
  connexion** (vérifié par la garde de l'admin, même pour une session utilisée chaque jour). Admin → Réglages →
  **Sécurité du compte** (`/admin/compte`) : changer le mot de passe (déconnecte TOUJOURS les autres appareils, forcé
  côté serveur, même par un appel direct à `/api/auth/change-password`), liste des appareils connectés (navigateur, IP,
  dates), « Déconnecter les autres sessions ».
- Mot de passe perdu ou intrusion : `reset-password.mjs` est dans l'image (ni shell ni sqlite3) ; il pose un nouveau mot
  de passe (lu sur l'entrée standard, ou tiré au hasard et affiché une fois) et **coupe toutes les sessions** :
  ```sh
  docker compose run --rm --no-deps -T --entrypoint /nodejs/bin/node portfolio reset-password.mjs moi@exemple.fr < /dev/null
  printf '%s\n' 'nouvelle phrase de passe' | docker compose run --rm --no-deps -T --entrypoint /nodejs/bin/node portfolio reset-password.mjs moi@exemple.fr
  ```
  Changer aussi `BETTER_AUTH_SECRET` invalide d'un coup toutes les sessions (voir docs/SAUVEGARDES.md, « Déménager »).

Tests : `npm test` (statique, inclut la garde des server actions) ;
`npm run build:local && npm run test:auth` (intégration sur le build standalone, faux
fournisseur OIDC local, serveur dev arrêté).

## Déploiement

Flux : **push GitHub → GitHub Actions → GHCR (privé) → Komodo sur hote-de-prod**.

1. `.github/workflows/docker.yml` se déclenche sur push `main`, sur les tags
   `v*` / `da/*` et à la main (`workflow_dispatch`) :
   - job `check` : `npm ci`, `tsc --noEmit`, `npm run lint`, `check:tokens`,
     `check:contrast`, `npm test` ;
   - job `image` : build buildx `linux/amd64` (cache `gha`), couches
     reproductibles (`SOURCE_DATE_EPOCH=0`, `rewrite-timestamp=true`), push sur
     `ghcr.io/themlaw/portfolio` avec les tags `latest` (main), `sha-<court>` et
     le nom du tag git nettoyé (`da/pro` → `da-pro`).
2. Sur hote-de-prod, Komodo déploie `docker-compose.yml` (service `portfolio`,
   `pull_policy: always`) ; Newt (Pangolin) joint le conteneur sur le réseau
   externe `traefik` : `http://portfolio:3000`. Aucun port publié.

### Stack Komodo

Deux façons, même fichier (`docker-compose.yml` du dépôt ≡
`/home/user/docker/portfolio/compose.yaml`, octet pour octet) :

- **depuis le dépôt git** : Stack → *Git Repo* = ce dépôt, branche `main`,
  *File Paths* = `docker-compose.yml` ; un redeploy relit le fichier à jour ;
- **depuis le fichier** : Stack → *UI Defined* (ou dossier sur l'hôte) avec le
  contenu de `docker-compose.yml`.

Variables : onglet *Environment* de la stack (Komodo l'écrit en `.env` à côté du
compose), modèle commenté : `.env.example`. Seul `BETTER_AUTH_SECRET` est
obligatoire (`openssl rand -base64 48`) ; `PORTFOLIO_TAG` épingle une version
(`sha-1a2b3c4`, `v0.8.0`, `da-pro`… ; défaut `latest`).

#### Épingler l'image de prod (recommandé)

`latest` + `pull_policy: always` déploie **n'importe quelle** image poussée sous
ce nom : si un jour une image piégée arrivait sur GHCR (jeton de CI volé,
dépendance compromise), le redeploy suivant la mettrait en ligne. Mieux vaut
déployer une image précise, choisie à la main :

- par étiquette de commit : `PORTFOLIO_TAG=sha-1a2b3c4` (les 7 premiers caractères
  du commit de `main`, visibles dans l'onglet *Actions* ou par `git rev-parse --short
  HEAD`). La CI ne repousse jamais une étiquette `sha-…` vers un autre contenu ;
- encore plus strict, par **digest** (immuable : l'image ne peut pas changer sous
  ce nom) : `PORTFOLIO_TAG=sha-1a2b3c4@sha256:<digest>`. Le digest se lit dans le
  journal du job `image` (étape *Build and push*, ligne `digest:`), sur la page du
  paquet GHCR, ou par `docker buildx imagetools inspect
  ghcr.io/themlaw/portfolio:sha-1a2b3c4` (ligne `Digest:`). Docker vérifie alors le
  contenu tiré contre ce digest.

Mise à jour : changer `PORTFOLIO_TAG` dans l'onglet *Environment* de la stack puis
redéployer ; revenir en arrière = remettre l'ancienne valeur. Les actions GitHub
des workflows sont, elles aussi, épinglées par SHA de commit (version en
commentaire) : pour en monter une, `git ls-remote --tags
https://github.com/<propriétaire>/<action>` donne le SHA de la nouvelle version.

### Premier démarrage

Le volume nommé `portfolio-data` (nom réel `<projet>_portfolio-data`, voir
`docker volume ls`) est vide : Docker l'initialise avec le `/data` de l'image,
déjà possédé par 1000:1000 (`media/`, `tmp/`). Au démarrage : migrations, seed
(thème `PORTFOLIO_THEME`), premier administrateur si `ADMIN_EMAIL` /
`ADMIN_PASSWORD` sont définis. Le conteneur passe `healthy` en quelques secondes.

### Si /data n'est pas inscriptible

Un volume déjà rempli par root, ou un dossier monté (bind) créé par root, bloque
l'utilisateur 1000:1000. Le conteneur s'arrête alors (et redémarre en boucle)
avec un message qui donne la commande exacte, nom du volume compris :

```
[data] ÉCHEC du démarrage : /data n'est pas inscriptible par l'utilisateur 1000:1000 (EACCES).
[data]   volume nommé : docker run --rm -v portfolio_portfolio-data:/data alpine chown -R 1000:1000 /data
[data]   avec le docker-compose.yml du dépôt : docker compose --profile setup run --rm fix-permissions
```

Le service `fix-permissions` (profil `setup`, jamais lancé par défaut) fait ce
`chown -R 1000:1000 /data` en root avec la seule capacité `CHOWN`, sans réseau.
Sur l'hôte, dans le dossier de la stack : `docker compose --profile setup run
--rm fix-permissions`, puis redéployer. Pour un bind mount :
`sudo chown -R 1000:1000 <dossier>`.

### Mise à jour

Redeploy de la stack (ou webhook Komodo) : `pull_policy: always` tire l'image,
et **seules les couches modifiées sont téléchargées**. Un changement de code ne
change que `.next/static` et le code serveur (~4 Mo sur ~170 Mo compressés) ; un
changement de dépendances change aussi la couche `node_modules` (~16 Mo) ; la
base et ffmpeg ne changent qu'avec une mise à jour de sécurité de Debian ou de
l'image distroless (reconstruction de l'image).

### Image

`Dockerfile` multi-stage : `deps` (npm ci) → `builder` (`next build`, sortie
`standalone` séparée en dépendances / code) → `ffmpeg` (Debian 13 : ffmpeg,
ffprobe, `nice` et leurs bibliothèques, collectées par `ldd`) → `runner` sur
**`gcr.io/distroless/nodejs24-debian13`**.

| Couche (de la plus stable à la plus volatile) | Compressé |
|---|---|
| base distroless (glibc, OpenSSL, node 24) | 55 Mo |
| ffmpeg / ffprobe / nice + 200 bibliothèques (186 paquets Debian) | 93 Mo |
| comptes (`app` 1000:1000) et `/data` | < 0,1 Mo |
| `node_modules` tracées du standalone | 16 Mo |
| migrations, seed, `public/` | < 0,1 Mo |
| `.next/static` | 0,9 Mo |
| `server.js` + `.next/server` | 3,3 Mo |

610 Mo décompressés, 169 Mo compressés (avant : `node:24-slim` + ffmpeg Debian,
1,06 Go / 275 Mo).

Surface d'attaque :

- **ni shell** (`sh`, `bash`, `dash`, `busybox`), **ni `apt` / `dpkg`**, ni
  perl / python, **aucun binaire setuid/setgid** ; seuls exécutables : `node`,
  `ffmpeg`, `ffprobe`, `nice`. `docker run --entrypoint sh` échoue ;
- utilisateur **1000:1000** ; code possédé par root, droits `u=rwX,go=rX`, en
  lecture seule ; seuls `/data` et les tmpfs sont inscriptibles ;
- `nice` est fourni (coreutils) : `os.setPriority` après coup ne toucherait que
  le fil principal de ffmpeg, pas ceux déjà créés (la priorité est par fil sous
  Linux) ; lancé par `nice -n 10`, tous les fils en héritent ;
- versions Debian conservées : un enregistrement dpkg par paquet copié dans
  `/var/lib/dpkg/status.d/` (convention distroless) : Trivy / Grype voient les
  versions réelles et leurs CVE ;
- `HEALTHCHECK` en exec : `/nodejs/bin/node -e "fetch('…/fr')"`, sans shell.

Couches reproductibles : `COPY --link` avec propriétaire explicite, droits
normalisés, dates ramenées à `SOURCE_DATE_EPOCH` à l'export
(`rewrite-timestamp=true`). La constante `0` (et non la date du commit) garde
les couches stables d'un commit à l'autre. Conséquence : les fichiers de
`public/` ont tous la même date ; leur ETag ne dépend plus que de leur taille.
Changer un fichier de `public/` sans changer sa taille : le renommer.

- `npm ci --ignore-scripts` : better-sqlite3 13 embarque ses binaires N-API
  (`prebuilds/`), aucun script d'installation n'est nécessaire ;
- build-arg `NODE_MAX_OLD_SPACE` (défaut 1024 Mo, 4096 en CI) : plafond du tas
  pendant `next build`.

### Build local (test ponctuel uniquement)

Les images se construisent sur GitHub Actions. **Ne pas builder l'image sur la
VM de dev sauf test ponctuel** (l'hôte Proxmox est en surallocation de RAM ;
pic mesuré ≈ 2,7 Go, serveur dev arrêté) :

```bash
# Même export que la CI (dates réécrites), puis chargement dans Docker.
SOURCE_DATE_EPOCH=0 docker buildx build --build-arg LOW_MEM_BUILD=1 \
  --output type=docker,name=portfolio:test,dest=/tmp/portfolio.tar,rewrite-timestamp=true .
docker load -i /tmp/portfolio.tar && rm /tmp/portfolio.tar
docker run -d --name portfolio-test -p 3002:3000 --memory 1g --init \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 48)" \
  -v portfolio-test-data:/data portfolio:test
docker inspect -f '{{.State.Health.Status}}' portfolio-test
docker rm -f portfolio-test && docker volume rm portfolio-test-data
sync; echo 3 > /proc/sys/vm/drop_caches
```

Couches d'une image : `docker image inspect -f '{{json .RootFS.Layers}}' portfolio:test`.
