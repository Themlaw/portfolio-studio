# Architecture — Portfolio + CMS

Document de cadrage de la refonte « CMS ». Il fixe les décisions d'architecture ;
chaque phase s'y réfère. Toute déviation se discute et met ce fichier à jour.

## Décisions actées (2026-09-30)

| Sujet | Décision |
|---|---|
| Build & distribution | GitHub (repo privé `Themlaw/portfolio`) → Actions → `ghcr.io/themlaw/portfolio` (privé) |
| Prod | hote-de-prod, stack Komodo (`/home/user/docker/portfolio/compose.yaml`, image `latest`), `pull_policy: always`, réseau `traefik` partagé avec Newt, aucun port publié |
| Dev | vm-dev, `npm run dev -- -p 3001` ; hôte Proxmox en surallocation RAM → une charge lourde à la fois, pas de build d'image en local |
| Contenu | SQLite (better-sqlite3 + Drizzle ORM, WAL), fichier `/data/portfolio.db` |
| Médias | Volume local `/data/media`, derrière une interface `MediaStorage` (bascule Garage/S3 possible sans toucher aux composants) |
| Auth admin | Better Auth : OAuth Authentik (generic OAuth/OIDC) + email/mot de passe en secours. `AUTH_PASSWORD_DISABLED=true` coupe le mot de passe **seulement si** l'OIDC est configuré (sinon ignoré + avertissement au démarrage : on ne s'enferme jamais dehors). Inscription publique désactivée. Détails : section « Authentification (phase 3) ». |
| Vidéo | Transcodage ffmpeg à l'upload → MP4 H.264 « faststart » 1080p + 720p + vignette, servis en HTTP Range |

## Principe directeur : un thème = tokens + variantes + assets

Les DA « Pro » et « Galerie lumineuse » ne diffèrent presque pas par leurs couleurs :
ce qui les distingue, ce sont les assets du hero et des choix de forme. Un thème est
donc un document JSON en trois parties, validé par un schéma zod :

```ts
// Source de vérité : src/themes/schema.ts (mis à jour en phase 1).
type Theme = {
  id: string; name: string; preset: boolean;       // preset = non supprimable, dupliquable
  tokens: {
    color: { bg, bgDeep, surface, ink, inkSoft, line,
             primary, primaryHover, onPrimary, secondary, tertiary,
             eyebrow?,                             // étiquettes ; défaut : secondary
             accentGlow?,                          // halo (hero spotlight, images) ; absent = aucun
             heroHalo? };                          // halo typographique des petits textes sur les calques du hero
    font:  { display, body, caption };             // ids du catalogue (src/themes/fonts.ts)
    radius:{ sm, md, lg, btn, strip };
    space: { sectionGap, pageMax, gutter };
    motion:{ durFast, durBase, easing };
  };
  variants: {                                      // choix de FORME, jamais de fond
    header:   "inline" | "centered";
    hero:     "parallax-layers" | "spotlight" | "type-only";
    strip:    "edge" | "taped";                   // taped s'applique aussi aux tuiles de collection
    caption:  "mono-split" | "handwritten";
    lightbox: "passe-partout" | "full-bleed";
    button:   "pill" | "square";
    texture:  "none" | "paper-dots";
  };
  assets: { heroLayers?: string[]; heroNote?: { fr, en } };  // chemins publics (MediaRef en phase 2)
};
```

Écarts phase 1 par rapport au premier cadrage : variantes alignées sur les quatre
presets livrés (`spotlight`, `taped`, `handwritten`, `texture` ; `still-image`,
`framed`, `serif-below`, `underline` et `grain` abandonnés faute d'usage) ; tokens
optionnels `eyebrow` (Pro garde des étiquettes grises), `accentGlow` et `heroHalo`
(halo typographique serré, ajouté après la mesure du contraste au pixel). Le schéma
refuse toute valeur contenant `;{}<>` (la feuille est injectée telle quelle).

Règles non négociables pour les composants :
1. **Aucune valeur visuelle en dur.** Couleurs, polices, rayons, espacements, durées
   viennent de variables CSS. (Déjà vrai aujourd'hui, à conserver et à tester en CI par grep.)
2. **Les variantes passent par des attributs `data-*`** posés sur `<html>`
   (`data-strip="edge"`…), et le CSS réagit (`[data-strip=framed] .strip{…}`). Un composant
   ne lit jamais le thème en JS pour son style : le même HTML sert tous les thèmes, donc
   changer de thème = changer une feuille `:root` + des attributs, sans rebuild.
3. **Les fonctionnalités ne dépendent pas du thème** (barre de glissement, vignettes de
   lightbox, i18n, accessibilité). Un thème change l'apparence, jamais le comportement.

Application à l'exécution : le layout racine lit le thème actif (cache mémoire invalidé
à l'enregistrement) et émet `<style id="theme">:root{--t-color-bg:…}</style>` + les
`data-*` (préfixe `--t-` distinct pour éviter toute auto-référence côté Tailwind). Tailwind v4 garde un `@theme` dont les valeurs pointent vers ces variables,
de sorte que les utilitaires (`bg-bg`, `text-ink`…) restent utilisables.

Polices : catalogue fini déclaré avec `next/font/local` (fichiers woff2 du dépôt, `src/themes/fonts/`, aucun réseau au build ; sans CLS). Un thème
choisit dans le catalogue. Ajouter une police = ajouter une entrée au catalogue (plus tard :
upload de police depuis l'admin).

Personnalisation légère : chaque page peut surcharger quelques tokens (ex. l'accent),
fusionnés au-dessus du thème actif. Contraste AA vérifié à l'enregistrement : l'admin
refuse une combinaison texte/fond sous 4,5:1 et propose la teinte la plus proche qui passe.

Presets livrés : **Galerie lumineuse** (actif), **Pro**, et une direction radicalement
différente reprise des propositions (sombre) qui sert de **test d'acceptation** du moteur :
si elle ne se rend pas sans toucher aux composants, le moteur n'est pas fini.

## Modèle de contenu

```
pages ─┬─ blocks (ordonnés, typés, props JSON validées)
       │     └─ ex. block "project-strip" → project_id
projects ── slots (ordonnés) ── media (nullable : slot vide = place gardée)
media (image | video, variantes générées, statut de traitement)
themes, settings (thème actif, identité du site, liens contact)
users/sessions/accounts (tables Better Auth)
jobs (file de traitement : transcodage vidéo, variantes d'image)
```

- **pages** : `id`, `slug` localisé `{fr, en}` (`""` = accueil), `title` localisé,
  `nav_order` (null = hors menu), `published`, `theme_overrides` JSON. La route unique
  `[locale]/[[...slug]]` résout la page depuis la base. Les pages actuelles (Personnages,
  Décors, Animation, À propos) deviennent des lignes seedées, plus des fichiers.
- **blocks** : `page_id`, `position`, `type`, `props` JSON. Registre de types de blocs :
  chaque type = composant React + schéma zod des props + formulaire d'édition admin.
  Types initiaux : `hero`, `project-strip`, `projects-by-collection`, `collection-tiles`,
  `video` (demoreel), `rich-text`, `contact`. Ajouter un type de bloc = une entrée au
  registre, rien d'autre.
- **projects** : `slug`, `title/context/description` localisés, `year`, `collection`
  (personnages, décors…), `featured`, `position`.
- **slots** : `project_id`, `position`, `media_id` **nullable**, `caption` localisée.
  Supprimer une image met `media_id` à null : la place reste, visible en pointillés dans
  l'admin, masquée côté public. On peut ensuite y déposer une autre image ou retirer le slot.
- **media** : `kind`, `original_path`, `width/height/duration`, `variants` JSON,
  `dominant_color` (fond pendant le chargement), `alt` localisé, `status`
  (`processing | ready | failed`), `error`.

Tous les accès passent par `src/lib/` (déjà le cas avec `gallery.ts`) : les composants ne
parlent jamais à Drizzle directement. Le seed initial reprend `projects.json`/`artworks.json`.

### Écarts retenus en phase 2 (implémentation)

- **slots portent l'œuvre** : en plus de `project_id`, `position`, `media_id`, un slot a
  `slug`, `collection`, `title` et `description` localisés, `year`, `featured`,
  `duration`, `video_id`, `reel`. Une œuvre n'appartient qu'à un projet ; ses champs
  n'ont pas leur place dans `media` (un média peut changer, l'œuvre reste). L'ordre
  global des œuvres (collections, couverture, demoreel) est l'ordre des slots (`id`).
- **projects sans `collection`** : un projet mêle plusieurs métiers ; la collection est
  portée par chaque slot.
- **pages.meta** `{title, description}` localisés pour `<title>`/description ; `title`
  reste le libellé court (menu).
- **Blocs livrés** : `hero`, `collection-tiles`, `featured-projects`, `collection-intro`,
  `collection-projects`, `video`, `rich-text`, `contact`, et **`profile`** (page À propos :
  portrait, présentation, contact et réseaux en une grille, indécoupable sans changer
  le rendu). Les entrées des collections (`collection-tiles`, libellé « Entrées des
  collections » depuis la v0.13.1 : une grande image par collection, qui mène à sa
  page ; type inchangé en base) portent leurs propres textes (dupliqués depuis
  l'intro de la collection) et référencent la page cible par id.
- **Références sans FK** : les ids portés par les props des blocs (`portraitMediaId`,
  `pageId`…) sont déclarés par type dans `src/blocks/refs.ts` ;
  `findMediaUsages(mediaId)` et `findPageReferences(pageId)` (`src/lib/references.ts`)
  inspectent slots ET blocs. L'admin s'en sert pour afficher « utilisé dans… » et
  refuser une suppression qui casserait une page.
- **Médias** : CSP `default-src 'none'; style-src 'unsafe-inline'; sandbox` sur toutes
  les réponses `/media`. En phase 4, l'upload aura une **liste blanche de types MIME**
  (vérifiés sur le contenu, pas sur l'extension) : aucun HTML ni script accepté.
- **404** : servie par `src/proxy.ts` (page réservée rendue normalement, statut 404,
  `no-store`), `notFound()` produisant ici une coquille d'erreur rendue côté client.
- **Cache** : modèle « unstable_cache + étiquettes » plutôt que `use cache` : ce dernier
  exige `cacheComponents`, qui change tout le modèle de rendu (Suspense obligatoire
  autour des accès dynamiques comme le cookie d'aperçu, prérendu au build qui toucherait
  la base). ISR en mémoire (`isrFlushToDisk: false`) : le conteneur est en lecture seule.

## Médias

- **Upload** : route handler en streaming vers le disque (jamais tout en mémoire : la VM
  de prod partage sa RAM), taille max configurable. À vérifier : la limite de corps de
  requête de Pangolin pour les grosses vidéos (sinon upload par morceaux).
- **Images** : `sharp` produit AVIF + WebP en 480/960/1600/2400 px, couleur dominante,
  dimensions. `<picture>` + `srcset` + `sizes`, lazy sauf au-dessus de la ligne de flottaison.
  Les SVG sont servis tels quels.
- **Vidéos** : job ffmpeg (concurrence 1, file persistée en SQLite, reprise au redémarrage)
  → `1080.mp4` / `720.mp4` en H.264 CRF ~22 `+faststart`, AAC, + `poster.webp`. Le lecteur
  choisit la source selon la largeur d'écran ; la route `/media/*` gère `Range` (206),
  `ETag` et `Cache-Control: immutable` (noms de fichiers versionnés par hash).
- **Stockage** : interface `MediaStorage { put, get(range), delete, url }`, implémentation
  `LocalStorage` sur `/data/media`. `S3Storage` (Garage) plus tard, même contrat.

### Livré en phase 4b (images)

- **Envoi** : `POST /admin/api/upload` (une image par requête : progression par fichier),
  `assertAdmin()` + même origine. Hors du `matcher` du proxy : un proxy Next met le corps en
  mémoire et le tronque à 10 Mo. busboy écrit en flux dans `${DATA_DIR}/tmp` (jamais `/tmp`,
  tmpfs), SHA-256 au fil de l'eau, plafond `MAX_IMAGE_MB` (200) appliqué pendant le flux.
- **Type** par signature (`src/lib/upload/sniff.ts`) : JPEG, PNG, WebP, AVIF, GIF ; tout le
  reste refusé (415). Dimensions lues dans l'en-tête : plus de 100 mégapixels → refus (422)
  sans décodage. Même contenu envoyé deux fois → même média.
- **Clés** : original `originals/<sha256>.<ext>` (sans le nom du fichier, qui reste en
  métadonnée admin `original_name`), jamais servi ; variantes `img/<hash16>/<boîte>.<avif|webp>`,
  servies seulement pour un média `ready` qui les liste. `media.sha256` est unique
  (migration 0005) : un contenu = une ligne ; un contenu renvoyé alors qu'il est en échec
  relance le traitement de cette ligne ; une suppression n'efface que les fichiers qu'aucune
  autre ligne ne référence, et vérifie les usages dans la même transaction.
- **Worker** (`src/lib/jobs/worker.ts`) : table `jobs` (migration `0003_jobs`), concurrence 1,
  démarré par l'instrumentation, jobs `running` orphelins remis en file au démarrage, médias
  `processing` sans job passés en échec. sharp : `concurrency(1)`, `cache(false)`,
  `limitInputPixels` 100 MP, `.rotate()` puis aucune métadonnée en sortie ; l'original est
  décodé une fois (≤ 2400 px), chaque variante en découle. Fin de traitement → invalidation
  des étiquettes `media` et `projects` (requête interne à jeton si hors requête).
- **Mémoire du conteneur (1 Gio)** : un import ou un export de kit (processus enfant plafonné à 650 Mo) et le
  traitement d'une image lourde (plus de `IMAGE_HEAVY_MPX` = 16 Mpx, ou décodage d'un bloc de plus de 100 Mo) ne
  tournent JAMAIS ensemble : `src/lib/jobs/memory-gate.ts` (exclusion mutuelle, ordre d'arrivée, libération sur
  erreur) ; le worker ne démarre pas une image lourde pendant un kit (ni un kit pendant une image lourde, ni une
  image lourde quand un kit est prêt : pas de famine) et laisse passer les images légères. Mesuré avant
  correction : 556 Mo (image seule) + 579 Mo (import seul) = 891 Mo sans le serveur, OOM avec. Le journal
  dit quand une tâche attend (`[jobs] mémoire : …`). `MEMORY_GATE=0` désactive la porte (mesures « avant / après »
  seulement). Tests : `test-memory-gate.mjs` ; mesure sous `docker run --memory=1g` : `scripts/mem/mem17.sh`
  (conteneur du standalone, image de 100 Mpx et import d'un kit en même temps, `memory.peak` du cgroup, `OOMKilled`).
  Mesuré (v0.17, conteneur de 1 Gio, PNG entrelacé 20000 × 4000, import de l'archive de 22 Mo, image lancée 1, 4 ou 7 s
  après l'import) : image seule 591 Mo, import seul 736 Mo ; sans porte 940, 1024 (limite atteinte 495 fois) et 976 Mo ;
  avec la porte 749, 743 et 737 Mo, l'image démarrant à la fin du kit (aucun OOM dans les deux cas : le noyau purge le
  cache, mais sans marge pour une image plus lourde).
- **Rendu** : `src/components/Picture.tsx` (`<picture>` AVIF puis WebP, `sizes`, dimensions,
  fond = couleur dominante d'une image opaque, `loading="lazy"` sauf `priority`). La
  visionneuse ne propose que la plus grande variante. Les SVG du seed gardent `next/image`.
- **Admin** : `/admin/projets` (cartes réordonnables), `/admin/projets/<id>` (informations +
  planche : bande de 180 px de haut, emplacements au ratio de l'image, dépôt de fichiers en
  fin de bande ou sur un emplacement vide, panneau latéral / feuille du bas), `/admin/medias`
  (grille, filtres, recherche, détail, « Utilisée dans… »). Les gestes de la planche
  (déposer, réordonner, retirer, supprimer) sont des actions immédiates et annoncées ; les
  textes s'enregistrent avec un bouton. Un emplacement vidé garde sa place (ratio 4:3).
- **Robustesse (passe 4b2)** :
  - côté de plus de 32 768 px refusé dès l'en-tête (les décors panoramiques dépassent 16 384 px ;
    c'est le plafond de 100 Mpx qui borne la mémoire) ; décodage borné à une boîte de
    2400 × 2400 (`fit: inside`, réduction au décodage JPEG/WebP), sortie 8 bits sRGB ;
    variantes en boîtes carrées (`img/<hash>/<boîte>.<format>`). Pics mesurés (VmHWM du
    serveur, `test:auth` section F) : JPEG 6000×4000 +146 Mo, PNG 2400×16000 +15 Mo,
    PNG 16 bits 8000×8000 +237 Mo, 16384×16384 refusé (> 100 MP) sans décodage ;
  - **Mémoire de décodage (lot 17b)** : un PNG classique ou un JPEG de base se décodent en flux (pic
    mesuré : 20000 × 4000 RGBA +100 Mo, PNG de 60 Mo +200 Mo, 30 Mpx JPEG +90 Mo). Un PNG ENTRELACÉ
    (Adam7), un JPEG progressif, un AVIF/HEIF ne se lisent qu'entiers : 20000 × 4000 RGBA entrelacé
    = +370 Mo, 100 Mpx 16 bits = 800 Mo, au-delà de ce que le conteneur (1 Gio, serveur compris)
    supporte. `src/lib/images/budget.ts` estime ce coût depuis l'en-tête (`IMAGE_DECODE_BUDGET_MB`,
    350 par défaut) : refus 422 à l'envoi, avec la marche à suivre (« décoche Entrelacé »), et même
    garde-fou dans le worker. Plafond d'envoi `MAX_IMAGE_MB` : 200 (PNG de 80 Mpx = 100 à 180 Mo).
  - **Panoramas** : une image au moins deux fois plus large que haute reçoit deux variantes de plus
    (3600 et 4800 px) ; une case étroite n'en montre qu'une bande étirée bien au-delà de 2400 px.
    `sizes` d'une image rognée (`src/lib/images/sizes.ts`) = largeur de la case × part rognée ×
    zoom du cadrage, pas la largeur de la case.
  - **Un traitement ne reste jamais « en cours »** : toute exception du worker met job ET média en
    échec (`settleFailure`) ; un chien de garde (`reapStalled`) échoue un job « running » oublié ;
    une image dont le traitement a déjà interrompu le serveur une fois n'est pas reprise (échec
    lisible, « Réessayer » à la demande) pour ne pas boucler sur des plantages. Côté éditeur, la
    grille de l'onglet Médias suit les médias en traitement (`useMediaWatch`) et rafraîchit à la fin ;
    un média en échec y propose « Réessayer ».
  - job interrompu `MAX_ATTEMPTS` (3) fois : au démarrage, job et média passent en échec
    (message lisible), le média reste supprimable ; délai croissant entre essais
    (`jobs.run_after` : 10 s, 60 s, 5 min) ; 2 min au plus par traitement
    (`JOB_MAX_DURATION_S`) ; une image illisible échoue au premier essai ;
  - sharp lit l'original par CHEMIN (un flux serait gardé en mémoire) ; orientation EXIF
    appliquée après réduction. Pics mesurés (section F) : PNG 16 bits 99 Mpx +250 Mo
    (448 Mo au total), sous le seuil de 500 Mo : pas de plafond 16 bits par défaut
    (`MAX_MEGAPIXELS_16BIT` pour en fixer un) ; PNG 9000×6000 orienté 6 : +133 Mo ;
  - deux envois simultanés du même contenu : l'erreur d'unicité renvoie le média existant ;
    noms de fichiers temporaires uniques dans le stockage ; un original écrit dont la
    transaction échoue est supprimé ;
  - envoi muet 30 s (`UPLOAD_IDLE_TIMEOUT_S`) ou de plus de 10 min
    (`UPLOAD_MAX_DURATION_S`) → 408 ; fichiers temporaires (envois et `*.tmp` du stockage)
    purgés au démarrage puis toutes les 15 min ; quota `MEDIA_MAX_TOTAL_GB` (507, avant et
    après la lecture) ; entrées des server actions en `z.strictObject`.
- **Emplacements** : `slots.aspect` (migration 0004) garde le ratio de la dernière image ;
  4:3 seulement pour un emplacement créé vide. Pas de titre par défaut (suggestion dans le
  panneau) : aucun nom de fichier côté public.
- **Suppressions** : projet bloqué s'il est cité par « Projets mis en avant » (refs
  `projects[]`) ; média bloqué s'il est cité par un bloc, sinon ses emplacements sont vidés
  et l'original et les variantes sont effacés du stockage.

### Livré en phase 5 (vidéo)

- **Envoi par morceaux** (`src/lib/upload/chunks.ts`, table `uploads`, migration 0006) :
  `POST /admin/api/upload/init` → identifiant ; `PUT /admin/api/upload/<id>/chunk?offset=N`
  écrit exactement à l'offset attendu (409 sinon ; un morceau interrompu est tronqué à
  l'offset confirmé ; un seul morceau à la fois par envoi) ; `GET …/status` ;
  `POST …/complete` ; `DELETE …`. Hors proxy, `assertAdmin` + même origine ; un envoi
  appartient à l'administrateur qui l'a ouvert (`uploads.user_id`, migration 0007 : un
  autre reçoit 404). `offset` strictement numérique. Quota vérifié à l'annonce (taille
  réservée) et à chaque morceau ; un refus de quota (507) est définitif : le client annule
  l'envoi, ce qui rend la réservation. Purge après 24 h sans nouvelle, y compris des
  fichiers `.part` sans ligne.
- **Validation** : signature (ISO-BMFF hors marques d'image, ou EBML) puis ffprobe forcé
  sur le format de la liste blanche (`-f mov` / `-f matroska`, `-protocol_whitelist file`) :
  piste vidéo réelle, durée et plus grand côté (rotation appliquée) bornés ; sortie de
  ffprobe plafonnée à 1 Mo. **Liste blanche de codecs** : vidéo {h264, hevc, vp8, vp9,
  av1, prores, mpeg4}, audio {aac, mp3, opus, vorbis, flac, alac, pcm_*} ; tout autre
  codec est refusé à l'envoi (422), et la conversion force le décodeur (`-c:v`/`-c:a`
  avant `-i`, AV1 par `libdav1d`) : aucun autre décodeur de ffmpeg n'est atteignable.
- **Conversion** (`src/lib/video/transcode.ts`, worker : file vidéo séparée, concurrence 1) :
  arguments en tableau, `-nostdin`, protocole `file` seul, format d'entrée forcé, une sortie
  par processus (décodage sur un fil, `-threads 2`, `rc-lookahead=10`), priorité basse
  (`nice -n 10` au lancement : tous les fils en héritent ; idem ffprobe), `-max_alloc`
  256 Mo, délai dur `VIDEO_JOB_MAX_DURATION_S` (SIGKILL, « trop de temps » ; un SIGKILL
  venu d'ailleurs = OOM, « mémoire insuffisante »), progression `-progress pipe:1` →
  `jobs.progress`. Sorties validées par ffprobe avant enregistrement ; un échec après
  écriture supprime les clés déjà écrites ; les dossiers `tmp/video-*` d'un arrêt brutal
  sont supprimés au démarrage. Pendant la conversion, le quota réserve une estimation des
  sorties (8 Mbit/s si 1080p, 2,5 Mbit/s sinon). Clés `vid/<hash16>/{1080,720}.mp4` et
  `poster-{960,1600,full}.webp`.
- **Mesures** (VM de dev, ffmpeg 7.1, `test:auth` section V) : 1080p 60 s avec son → 81 s,
  ffmpeg 309 Mo / 159 s CPU, serveur +53 Mo, sorties 46,7 + 13,7 Mo ; 4K 20 s → 23 s,
  ffmpeg 413 Mo / 63 s CPU, serveur +63 Mo ; boucle 720p 4 s → 2 s, ffmpeg 175 Mo.
  Avec `-max_alloc` et `nice` (passe 5b) : 4K 20 s → 22,6 s, ffmpeg 413 Mo ; 1080p 60 s
  → 80,9 s, ffmpeg 312 Mo ; boucle 720p → 1,9 s, ffmpeg 175 Mo (inchangés).
  Deux sorties dans un même processus montaient à 1 Go pour la 4K : écarté (limite du
  conteneur). Conteneur (ffmpeg 5.1, `--read-only --memory 1g`) : 4K 20 s convertie,
  pic du cgroup 689 Mo, aucun OOM.
- **Image** : ffmpeg du paquet Debian (`--no-install-recommends`) : +472 Mo non
  compressés (image 1,06 Go, 275 Mo compressés contre 99 Mo avant). Choisi pour les
  correctifs de sécurité de Debian (ffmpeg analyse des fichiers envoyés) plutôt qu'un
  binaire statique épinglé (~150 Mo, mais figé et sans suivi).
- **Lecture** : `Video` (`<video>` poster, `preload=metadata`, `playsinline`, contrôles,
  `<source media="(min-width: 1280px)">` 1080 puis 720 en repli) ; `LoopVideo`
  (IntersectionObserver, `prefers-reduced-motion` → poster fixe et ▶ ; bouton pause /
  lecture au clavier, visible au survol et au focus, toujours dans l'arbre
  d'accessibilité — WCAG 2.2.2 ; la vidéo porte le texte alternatif de l'œuvre). Une
  boucle ouverte dans la visionneuse ne démarre pas seule en « réduire les animations ».
  La route `/media` sert les MP4 avec Range (206).

### Image durcie (phase 6)

- **Base distroless** `gcr.io/distroless/nodejs24-debian13` : ni shell, ni apt/dpkg,
  ni setuid. ffmpeg 7.1, ffprobe et `nice` viennent de Debian 13 (même glibc que la
  base) avec leur fermeture `ldd` (200 bibliothèques, 186 paquets, 206 Mo), copiée
  déréférencée ; enregistrements dpkg dans `status.d/` pour les scanners. Écartés :
  `debian:trixie-slim` « nettoyé » (supprimer sh/dpkg après coup laisse des
  binaires et des chemins que rien ne garantit), et `os.setPriority` à la place de
  `nice` (la priorité est par fil : les fils déjà créés par ffmpeg y échappent).
- **Couches** stables → volatiles, toutes en `COPY --link` avec propriétaire
  explicite, dates réécrites à `SOURCE_DATE_EPOCH=0` : base 55 Mo, ffmpeg 93 Mo,
  comptes + `/data`, `node_modules` 16 Mo, migrations/seed/public, `.next/static`
  0,9 Mo, code serveur 3,3 Mo (compressés). Mesuré : après une ligne changée dans
  un composant, seules les deux dernières couches changent (4,2 Mo à tirer sur
  169 Mo) ; ffmpeg reconstruit sans cache donne le même digest.
- **Image** : 610 Mo (169 Mo compressés), contre 1,06 Go (275 Mo).
- **/data** existe dans l'image en 1000:1000 (`media/`, `tmp/`) : un volume nommé
  neuf en hérite. Sinon, `src/lib/db/writable.ts` arrête le démarrage avec la
  commande de réparation (nom du volume ou chemin du bind lus dans
  `/proc/self/mountinfo`) ; service compose `fix-permissions` (profil `setup`,
  CAP_CHOWN seule).
- Conteneur `--read-only --cap-drop ALL --no-new-privileges --memory 1g` : vidéo
  1080p 20 s convertie (ffmpeg 1000:1000, 11 fils à nice 10, pic 311 Mo, cgroup
  788 Mo, aucun OOM), image traitée, écriture hors `/data` → EROFS.

### Envoi unifié et tags (phase 6a)

- **Données** (migration 0008) : `tags` (`label` tel que saisi la première fois,
  `key` normalisée unique : minuscules, sans accents, espaces réduits, caractères
  invisibles retirés), `media_tags` (clé composite, FK en cascade des deux côtés),
  `uploads.tags` (JSON). Règles pures dans `src/lib/tag-key.ts` (client et serveur :
  clé, bornes, classement match-sorter) ; écritures dans `src/lib/tags.ts`. Bornes :
  1–40 caractères, 20 tags par média, 500 tags en tout.
- **Envoi** : `init` et l'envoi simple (champ `tags`, avant le fichier) acceptent
  des tags, validés avant tout enregistrement, attachés au média à sa création (ou
  ajoutés au média existant si le contenu est déjà connu). Un dépassement au moment
  d'attacher ne fait pas échouer l'envoi : `tagWarning` revient avec le média.
- **Actions** (`assertAdmin` + zod + bornes, dans la garde) : `listTagsAction`,
  `setMediaTagsAction`, `addMediaTagsAction`, `removeMediaTagsAction`,
  `renameTagAction` (refus si la clé existe : fusionner), `mergeTagsAction`,
  `deleteTagAction`. `addSlotsAction(projectId, ids, at?)` insère à une position ;
  un média en échec ne se place pas (`addSlots`, `setSlotMedia`).
- **Client** : `UploadQueueProvider` (AdminShell) : file globale (un envoi à la
  fois, lots, tags du lot et par fichier, synchronisation des tags après coup,
  placement sur la planche APRÈS création du média, Réessayer : reprise par
  morceaux, nouvel envoi simple ou relance du traitement). `Uploader`, `TagInput`
  (React Aria `ComboBox` multiple + `TagGroup` hors du ComboBox : une collection
  imbriquée dans la sienne boucle à l'infini), `LibraryStrip` (dnd-kit : la bande
  et le bandeau partagent un `DndContext` ; collision « sous le pointeur » pour une
  vignette, « le plus proche » pour réordonner ; marque d'insertion).
- **Clé** : NFKC (pleine chasse, ligatures), formats (Cf), contrôles (Cc),
  remplissages hangul et blanc braille retirés, `ß` → `ss` ; une clé vide est
  refusée. Plafond de 500 : seuls les tags posés sur un média comptent ;
  « Supprimer les tags inutilisés » (onglet Tags) les retire à la demande.
- **Synchronisation** : un refus (plafonds, réseau) est mémorisé pour la demande
  en cours (`tagRefused`) : un seul appel, un seul message, nouvel essai quand
  les tags changent. `complete` reçoit les tags courants (reprise d'un envoi).
- **Standalone** : chemins de données marqués `turbopackIgnore`, exclusions
  explicites pour le proxy et l'instrumentation ; `scripts/check-standalone.mjs`
  (dans `npm test`, et en CI après `next build`) refuse `src/`, `data/`,
  `docs/`, bases, `.env*` et fichiers de configuration.
- **Mesures** : e2e-tags 19/19, pic VM 2,4 Go (dev + chromium).

### Lot médias (bande, visionneuse, lecteur, CV)

- **Bande d'une planche** (`ProjectStrip`) : « N œuvres » seul dans l'en-tête ;
  flèches `.strip-nav` posées sur les bords de la bande (`.strip-viewport`, qui
  porte la géométrie `--strip-h`, `--rail-inset`, `--rail-room`), centrées sur
  les images, visibles au survol et au focus, masquées sur écran tactile
  (`hover: none` : le doigt et l'accrochage suffisent), désactivées en butée (le
  focus passe à l'autre flèche). Une image à la fois (`rail-step.ts` : arrêts =
  bords des `.strip-frame`, cible cumulée pour les appuis rapprochés). Fondu
  des bords : `mask-image` dégradé sur le rail (l'image se dissout dans ce qui
  est derrière : fond, texture, papier), bords pilotés par `--strip-fade-l/-r`
  (`@property`, sans animation : animer le masque coûtait 5–6 images longues
  par glisser). Chaque bord ne se fond que contre une image réellement coupée
  (lot 17b) : `--strip-fade-l/-r` sont écrits sur le DOM dans un rAF (sans rendu React) et valent
  `min(--strip-fade, partie visible de l'image coupée par ce bord)`, `0px` sans coupe : jamais sur
  une image entièrement visible (la marge de fin de la bande ne compte pas comme du contenu à
  faire défiler) ; `data-at-start` /
  `data-at-end` / `data-overflows` ne pilotent plus que les flèches. Jetons `--strip-nav-*`.
- **Barre de défilement** (`RailScrollbar`) : aucun état React pendant le
  défilement ; curseur en `transform` dans un rAF ; glisser et molette regroupés
  par image ; accrochage suspendu pendant le geste (`.strip-rail[data-dragging]`) ;
  molette au-dessus de la barre = défilement horizontal ; ← / → image par image.
  Mesure : `node scripts/rail-perf.mjs` (Chromium ×4 ralenti, et Firefox).
- **Visionneuse** : image posée à nu (`.lightbox-frame` sans passe-partout ni cadre
  du kit), fond `--color-viewer` = gris neutre de même luminance que le voile
  (`neutralGray`, `src/themes/css.ts`), opaque ; variante plein cadre = ce gris
  assombri. Flèches, ← / →, Échap, balayage (pointeurs « touch »). Le cadre
  dessiné du kit habille désormais les tuiles de collection.
- **Curseur** : main (`var(--t-cursor-pointer, pointer)`) sur toute image qui
  ouvre la visionneuse ou un lien (`src/app/medias.css`).
- **Lecteur** (`VideoPlayer`, bloc Vidéo « lecteur » et visionneuse) : commandes
  maison sur `<video>` (mêmes sources, Range/206 inchangé) : lecture / pause,
  barre cliquable et glissable (slider accessible), temps, « Revoir », muet,
  plein écran (API, iPhone : `webkitEnterFullscreen`), clavier (Espace/K, ← / →
  ± 5 s, F, M), commandes masquées après 2,5 s de lecture sans geste. Boucles
  décoratives : inchangées, sans commandes.
- **CV** (bloc `cv`, médias `kind: "pdf"`) : envoi simple ou par morceaux, type
  par signature `%PDF-` au premier octet (`sniffPdf`), 15 Mo et 10 pages au plus
  (`MAX_PDF_MB`, `MAX_PDF_PAGES`), mot de passe refusé ; `pdfinfo` à l'envoi,
  rendu par `pdftoppm` (poppler-utils, Debian) dans un job « pdf » de la file
  LOURDE : processus à part sous `nice`, environnement minimal, police non
  embarquée remplacée par celles du dépôt (`public/kit/pdf-fonts.conf`), délai
  dur et plafond RSS (`PDF_MAX_RSS_MB`, 400 pour le rendu ; `PDF_INFO_MAX_RSS_MB`,
  64 pour pdfinfo ; lu dans /proc toutes les 100 ms),
  OOM d'abord ; poppler n'a pas de moteur JavaScript et ne lit que le fichier.
  Pages : `doc/<hash16>/p<n>-<800|1600>.<avif|webp>` via sharp ; PDF servi
  seulement sous `doc/<hash16>/document.pdf`, TOUJOURS en pièce jointe
  (`Content-Disposition: attachment`, nom `?name=` réduit à [a-z0-9-], nosniff,
  CSP sandbox, `X-Frame-Options: DENY`) ; `originals/` jamais servi. Un PDF ne se
  place pas dans une planche. Tests : `npm test` (test-pdf : règles, lancement,
  rendu réel de PDF hostiles si poppler est installé), `test:auth` section PDF,
  `test:e2e-medias`.

### Recadrage libre, image seule (lot 17d)

- **Donnée** : `look.crop.mediaId.rect` (aussi accepté dans `look.tileCrop[…]`) = rectangle normalisé
  `{x, y, w, h}` de l'image ORIENTÉE (0..1, côtés ≥ 1 %, dans l'image : `RectSchema`, `src/lib/images/crop.ts`).
  Par emplacement (bloc, case de grille) : la même image posée plusieurs fois a un recadrage par placement ;
  l'original n'est jamais modifié. Avec `rect`, `x/y/zoom` restent à 50/50/1 et sont ignorés ; sans `rect`,
  l'ancien cadrage (point focal + zoom dans un cadre au format imposé) fonctionne comme avant.
- **Rendu** (`ImageBlock`, `crop-view.ts`) : un recadrage libre donne une variante extraite de l'ORIGINAL ; le
  cadre prend son rapport (`data-free` : `aspect-ratio: auto`, le format imposé du bloc ou de la grille est
  ignoré), les cases d'une grille restent alignées en haut de la rangée et gardent chacune leur hauteur. Un ancien
  cadrage dans un cadre au format imposé, et un décor sans cadrage dont le cadre le rogne d'au moins 1,5 fois,
  sont servis de la même façon (leur fenêtre est un rectangle de l'original) : netteté pleine au lieu d'une
  image entière agrandie par CSS (`data-cropped` neutralise alors décalage et zoom CSS).
- **Variantes recadrées** : `GET /media/crop/<média>/<rect>-<signature>/<largeur>.<avif|webp>`
  (`src/app/media/[...key]/route.ts`). Rectangle en dix-millièmes (`x1235y2000w5000h4000`), largeur dans une
  liste fermée (480, 960, 1600, 2400, 3600, 4800, ou la taille réelle du recadrage) bornée à 12 Mpx de sortie.
  **Signature** HMAC (`BETTER_AUTH_SECRET`) posée au rendu par le serveur : on ne génère que ce que le site a
  écrit lui-même (brouillon compris), jamais un recadrage choisi par un tiers ; signature, forme, rectangle,
  largeur et média (image raster prête avec original) sont vérifiés AVANT tout accès au disque ou à sharp.
  Changer le secret invalide les signatures des pages en cache (pages à régénérer).
- **Génération** (`src/lib/images/crop-cache.ts`) : `extract` puis réduction depuis l'original lu par chemin
  (lecture séquentielle dans tous les cas : le rectangle de l'image VUE est reporté dans le repère du fichier
  selon l'orientation EXIF 1 à 8 (`fileRect`), extrait et réduit là, puis seulement orienté ; un JPEG de 100 Mpx
  en orientation 6 coûte comme en orientation 1, ~135 Mo, au lieu de ~410 Mo quand l'image entière était tournée ;
  budget de décodage de `budget.ts` vérifié), concurrence 1, file bornée (`MAX_WAITING` = 24, modifiable par
  `CROP_MAX_WAITING` ; au-delà 503 + `Retry-After`), deux demandes de la même variante n'en font qu'une. Une demande
  refusée (503) est gardée (256 au plus) et préparée en fond dès que la file se libère : la nouvelle tentative la trouve. Cache disque `${DATA_DIR}/cache/crops/<média>/<rect>/<largeur>.<format>`, au plus `MAX_RECTS` (32)
  rectangles par média (le plus ancien est effacé, il se régénère si on le redemande). Le dossier d'un média
  est purgé à sa suppression (`deleteMedia`). La file n'est pas partagée avec le worker des jobs : une
  extraction peut tourner pendant un job d'image (sharp reste à un thread).
- **Préchauffage** (`src/lib/jobs/crop-warm.ts`, job `crop-warm` de la file image, servi APRÈS les images et cédant
  la place dès qu'une image attend) : le job demande la page PUBLIQUE à ce serveur (`127.0.0.1:$PORT`,
  `CROP_WARM_ORIGIN` pour changer) et lit les URLs `/media/crop/…` du HTML rendu : mêmes règles de cadrage que les
  visiteurs (cases de grille, tuiles, anciens cadrages convertis) sans les recopier ; une variante à la fois, largeurs
  courantes d'abord. Mis en file à la publication d'une page (`publishDraftAction`, `savePageAction`, mise en ligne)
  et au démarrage pour chaque page publiée (le brouillon n'est pas préchauffé : la route génère à la demande).
  `CROP_WARM=0` le désactive. Test : `test-crop-warm.mjs`.
- **Repli côté client** (`CroppedPicture.tsx`, composant client monté seulement pour une variante recadrée) : si la
  variante échoue (503, hors ligne), pas d'image cassée : l'image entière (variante standard) prend sa place, cadrée
  en CSS comme avant la v0.17 (rectangle libre : image agrandie et décalée dans un cadre au rapport de la zone ;
  ancien cadrage : `object-position` et zoom du bloc, inchangés), puis une sonde invisible redemande la variante
  recadrée après 4, 10, 30, 60, 120 s (± 40 %, pour ne pas redemander toutes ensemble) et la remplace dès qu'elle
  arrive. Un échec survenu AVANT l'hydratation laisse l'icône d'image cassée jusqu'à la prise en charge par React
  (quelques centaines de ms en production), puis est repéré au montage. Test e2e : suite `crop17g` (40 recadrages à
  froid, file de 3 : aucune image cassée, bon personnage, variantes revenues).
- **Image seule** : plafond de hauteur `width: min(100%, 85svh × --ir)` (`data-solo`, `--ir` = rapport affiché) :
  une image plus haute est réduite et centrée, jamais rognée (hors cases de grille : la grille fixe sa géométrie). Option du bloc `fit` : « Image entière »
  (`contain`) ou « Remplir le cadre » (`cover`) ; sans choix, entière pour un bloc NEUF pleine largeur, remplie sinon. La
  migration **0019** (`pinImageFit`) écrit `fit: "cover"` sur les blocs Image pleine largeur à format imposé déjà présents
  (publiés, dans un conteneur, brouillons) : une page publiée avant la v0.17 garde son aspect.
- **Modale « Cadrer l'image »** : `FreeCropDialog.tsx` (mode Libre par défaut : huit poignées, glisser, formats
  rapides Original / 1:1 / 4:5 / 3:2 / 16:9 qui verrouillent le rapport aux coins) et, quand le bloc impose un
  format, l'onglet « Dans le cadre du bloc » (ancien point focal + zoom). La modale montre toujours l'image
  ENTIÈRE (`data-full-src` posé par le bloc ou la tuile en édition seulement). Tuile de collection : recadrage
  libre aussi (`look.tileCrop[collection].rect`, couverture raster ; la tuile prend le rapport du rectangle,
  `data-free`, même route signée) ; fond de l'ouverture et portrait : ancien mode seulement.
- Tests : `npm test` (`test-crop.mjs` : schéma, clés, signature, cache réel), `scripts/e2e-crop.mjs` (suite
  `crop17d`, chromium) et `scripts/e2e-crop-http.mjs` (mêmes contrôles de rendu, de route et de tuile sans
  navigateur : HTML servi + octets des variantes ; pour les machines sans chromium).

### Kit de thème PSD (phases 6b–6d)

Spécification, mesures et décisions : `docs/THEME-KIT.md`. En bref : module
`src/lib/kit/` (export v2, import, formats, fidélité du contour) ;
`Theme.assets.kit` rendu par variables `--t-kit-*` / attributs `data-kit-*`
(rien sans asset : parité) ; export à la demande dans un processus enfant
(`kit-child.cjs`), mis en cache, sur la file lourde partagée avec la vidéo
(migration 0009). Import (phase 6d) : envoi par morceaux (`purpose: kit`,
migration 0010), en-tête contrôlé sans décodage, job « kit-import » de la même
file lourde dans l'enfant, manifeste d'export pour reconnaître les éléments
inchangés, écran de revue `/admin/themes/<id>/kit`, application en copie
brouillon (`apply.ts`). Jeu de test réel : `tests/fixtures/kit-synthetique.psd`.
Lot 17e : le kit exporté est une archive de trois PSD (décor à calques libres, logo et
papier, icônes et curseurs ; cases en grand, réduites à l'import), l'import accepte le .zip,
un PSD ou plusieurs PSD choisis ensemble (`docs/THEME-KIT.md` §9).

## Admin (`/admin`, hors i18n, en français)

- **Thèmes** : liste des thèmes avec aperçu, « Activer », « Dupliquer », édition des tokens
  (sélecteurs de couleur avec contrôle de contraste en direct), choix des variantes, aperçu
  live dans une iframe de la page publique avant d'activer.
- **Pages** : arbre des pages (ajouter, renommer, slug fr/en, ordre du menu, publier).
  Éditeur de page = liste de blocs : ajouter un bloc depuis le registre, réordonner par
  glisser-déposer (dnd-kit, clavier inclus), éditer les props, supprimer.
- **Projets** : éditeur de planche qui ressemble à la planche publique : slots en bande,
  glisser-déposer pour réordonner, déposer des fichiers directement sur un slot vide ou en
  fin de bande, supprimer une image (garde la place) ou le slot.
- **Médiathèque** : tous les médias, statut de traitement, alt fr/en, où chaque média est utilisé.
- Rendu public : pages statiques régénérées à la demande (`revalidateTag` à chaque
  enregistrement) : le site public reste aussi rapide qu'aujourd'hui.

### Éditeurs livrés en phase 4a

- **Écritures** : `src/lib/edit/{themes,pages,settings}.ts` (validation et
  écriture, sans dépendance à Next) appelées par les server actions
  `src/app/admin/(espace)/{themes,pages,reglages}/actions.ts` :
  `assertAdmin()` → zod → écriture → `revalidate*`. Résultat sérialisable
  `{ ok, data } | { ok: false, message, fieldErrors }` (erreurs par chemin de champ).
- **Contraste** : `src/themes/contrast.ts`, logique unique partagée par la CI
  (`check-contrast`), l'éditeur (indicateurs, « Ajuster » = même teinte,
  luminosité corrigée au minimum) et le serveur (jamais de confiance au client).
- **Aperçu en direct** : le cadre charge l'accueil en draft mode (POST
  `/admin/apercu`, cible = le cadre). L'éditeur envoie par `postMessage` (même
  origine) la feuille `themeToCss()` et les attributs de variantes, appliqués par
  `PreviewBridge` (rendu seulement en aperçu admin) ; le cadre est rechargé après
  enregistrement. Le site public n'est encadrable (`frame-ancestors 'self'`) qu'avec
  le cookie de draft mode ; les visiteurs gardent `DENY`. `src/themes/css.ts` et
  `font-stacks.ts` sont purs (importables côté client).
- **Blocs** : chaque entrée du registre déclare `{ type, schema, Component, Editor,
  label, description, defaults, summary }` (+ `refs` dans `refs.ts`). L'éditeur de
  page reçoit `<Editor />` sans props (élément sérialisable) et lui fournit le bloc
  par contexte (`useBlockEditor()`). Kit de champs : `src/app/admin/_fields`.
- **Pages non publiées** : rendues seulement en draft mode avec session admin
  (`resolvePage`) ; le proxy ne les laisse passer qu'avec un cookie de draft
  valide (identifiant du build en production) ET une session admin vérifiée en
  base ; sinon vrai 404, identique à une adresse inconnue.
- **Accent de page** : `pages.theme_overrides = { primary }`, appliqué par un
  conteneur `display: contents` qui surcharge `--color-primary` (aucune boîte
  ajoutée) ; refusé sous AA contre le thème en ligne à l'enregistrement, et
  ignoré au rendu (log serveur) s'il ne passe plus avec le thème actif.
- **Glisser-déposer** : dnd-kit (`src/components/admin/Sortable.tsx`), poignée,
  clavier, annonces en français ; l'ordre du menu s'enregistre avec un bouton.

### Éditeur visuel : brouillon et publication (phase 7a)

Entrée principale de l'édition : `/admin/pages/<id>/editer` (groupe de routes
`(editeur)`, plein écran, `requireAdmin`). Accès depuis la liste des Pages (clic
sur la page), le Tableau de bord (« Modifier la page d'accueil ») et le site
public (bouton « Modifier cette page »). Le formulaire `/admin/pages/<id>` reste
disponible (lien « Formulaire »).

**Modèle (migrations `0011_editor_drafts`, `0012_editor_drafts_rev`).**

- `pages.draft` (JSON) + `pages.draft_updated_at` : TOUT l'état éditable de la
  page (titre, adresses, méta, publication, menu, accent, blocs), chaque bloc
  avec un identifiant stable `uid`. `null` = pas de brouillon, la version
  publiée fait foi. Pourquoi un JSON plutôt qu'une table `draft_blocks` : le
  brouillon est un état de travail d'une seule personne, lu et écrit d'un bloc ;
  il doit pouvoir être incomplet (un bloc ajouté n'a pas encore ses textes) ; la
  publication repasse de toute façon par la validation complète.
- Emplacements de planche (`slots`, données de projet partagées entre pages) :
  surcouche `draft_state` (`added` : créé dans un brouillon, inexistant pour le
  public et pour l'écran Projets ; `removed` : média retiré, place gardée),
  `draft_position`, `draft_media_id` (FK `media`, `ON DELETE SET NULL`), et
  `draft_page_id` : la page dont le brouillon porte la surcouche. Pas de copie
  des slots : publier CETTE page applique sa surcouche, « Abandonner » l'efface
  (ses `added` sont supprimés) ; une autre page qui partage le projet n'y touche
  jamais. Depuis la v0.13.1, sa vue brouillon la MONTRE (l'ordre d'une planche
  est celui du projet : une planche reposée ailleurs affiche le brouillon courant,
  sinon l'ordre publié), signalé au survol (`edit.heldBy`,
  `data-edit-board-held`) ; seule la page qui la
  porte la modifie et la publie. Supprimer la page abandonne sa
  surcouche. Les colonnes sont prêtes en 7a ; leur écriture depuis la toile
  arrive en 7b.
- `pages.draft_rev` : contrôle de version optimiste. Augmente à chaque écriture
  du contenu éditable (brouillon, publication, abandon, formulaire, publication
  ou menu changés depuis la liste quand un brouillon existe). Chaque écriture
  envoie la version lue ; si elle a changé, refus `code: "conflict"` sans rien
  écrire : deux onglets, ou l'éditeur et le formulaire, ne s'écrasent jamais,
  et un onglet en retard ne recrée pas un brouillon après une publication.
  L'éditeur s'arrête (« Modifié ailleurs ») et propose « Recharger », avec ses
  textes en cours à copier ; le formulaire affiche le même refus.
- Brouillon illisible (un type de bloc a disparu…) : `readDraft` le signale
  (`corrupt`) au lieu de le perdre ; enregistrement, publication et formulaire
  refusent de l'écraser (`code: "corrupt"`) tant que l'artiste n'a pas choisi
  « Repartir de la version publiée » (abandon explicite, confirmé).

**Écritures** (`src/lib/edit/drafts.ts`, actions de `pages/actions.ts`, toutes
gardées par `assertAdmin()`).

- `saveDraftAction(id, brouillon, version)` : enregistrement automatique
  (~800 ms après la dernière modification, aussitôt pour un changement de
  structure). Contrôle de forme seulement (types connus, 40 blocs, uid uniques,
  256 Ko, 16 niveaux d'imbrication ; toute erreur → refus, jamais un 500) ;
  écriture conditionnelle sur la version ; rien n'est revalidé (un brouillon
  n'est jamais en cache).
- `publishDraftAction(id, version)` : refus immédiat sans brouillon ; en UNE
  transaction, `savePage()` sur le brouillon — exactement la
  validation d'un enregistrement (schémas des blocs, références, adresses,
  contraste de l'accent), erreurs par champ `blocks.<i>.props.…` rattachées au
  bloc —, surcouche de la page appliquée, brouillon vidé et version incrémentée ;
  puis `revalidatePage({ structure })` et `revalidateProject` des projets cités
  avant ET après (version publiée lue avant l'écriture) et de ceux de la surcouche.
- `discardDraftAction` : brouillon et surcouche effacés (confirmation dans l'UI).
- Cohérence des autres écrans : le formulaire de page reprend le brouillon
  (bandeau) et son « Enregistrer » le publie (un seul état, jamais deux) ;
  Publier/Dépublier et le menu depuis la liste mettent à jour le brouillon ;
  la liste des Pages marque « Brouillon non publié » ; l'écran Projets montre la
  planche publiée et signale les emplacements en brouillon ; « Utilisé dans… »
  compte les brouillons (on ne supprime pas ce qu'un brouillon utilise).

**Vue brouillon** (`src/lib/draft-view.ts`) = draft mode de Next + cookie
`page-draft=1` + session admin vérifiée en base. Le cookie est posé par
`GET /admin/api/editeur/toile?page=&langue=` (`assertAdmin`, même origine via
`Sec-Fetch-Site`), qui redirige vers la page. Dans cette vue seulement : blocs
du brouillon lus sans cache, galerie avec la surcouche appliquée, chaque bloc
enveloppé d'un repère `display: contents` (`data-edit-block`, type, libellé ;
clé React = uid + empreinte des props, pour remonter à neuf un bloc modifié en
place), champs `inline` marqués `data-inline`, bloc incomplet signalé au lieu
d'être masqué. Hors draft mode, aucun cookie n'est lu : les pages restent
statiques et le HTML public ne contient jamais de brouillon ni de repère.
`frame-ancestors 'self'` reste limité aux requêtes portant le cookie de draft
mode. `page-draft` est un cookie de session ; « Quitter l'aperçu » le retire.
La toile exige `Sec-Fetch-Site: same-origin`, envoyé seulement en contexte
sécurisé : en HTTP hors localhost, elle répond 403 (README).

**Toile et couche d'édition.** La toile est le site dans une iframe de la même
origine. En vue brouillon, la page prend aussi le méta-titre et l'accent du
brouillon. `EditLayer` (rendu par `PreviewBanner` en vue brouillon seulement,
chargé à part avec `next/dynamic` : ni son JS ni `edit-layer.css` dans le
bundle public)
reste inerte tant que l'éditeur parent ne l'a pas allumée ; messages
`postMessage` validés par un schéma zod discriminé par `kind`
(`src/lib/edit/protocol.ts`, testé par `scripts/test-protocol.mjs`), origine ET
source vérifiées des deux côtés ; un message invalide est ignoré. La couche dessine dans un calque à part (contour au survol,
étiquette, barre ↑ ↓ ⧉ ✕, poignée, repère « Déposer ici ») et envoie les
intentions ; l'éditeur tient le brouillon et l'historique (Annuler/Rétablir,
100 pas), enregistre, puis demande `router.refresh()` à la toile. Textes en
place : métadonnée `inline` du registre (chemins de props localisées, `*` pour
un indice), double-clic ou Entrée, langue de la toile ; l'éditeur refuse un
chemin non déclaré. Glisser depuis la palette : l'éditeur capture le pointeur et
transmet les coordonnées, la couche répond l'index d'insertion. Clavier : Tab
parcourt les blocs (calque en tête du document), Entrée choisit, Suppr demande
confirmation, Échap désélectionne ; Ctrl+Z / Ctrl+Maj+Z depuis la toile aussi.
Aperçu : la couche ne dessine plus rien, l'éditeur masque barre et panneau.

**« Modifier cette page »** (`EditThisPage`, client seulement : rien au rendu
serveur, donc rien dans le HTML en cache ; styles en ligne, aucune feuille de
l'admin dans le CSS public). Il n'interroge
`/admin/api/editeur/session` (lecture seule, `no-store`) que si le cookie
indicateur `portfolio-admin` existe — posé par le proxy sur les requêtes admin
portant une session, ce n'est pas une preuve — ; affiché seulement si la
session est admin, jamais dans un cadre.

### Planches sur la toile (phase 7b)

Les images des projets se placent, se déplacent et se retirent directement sur
la toile, toujours dans la surcouche d'emplacements DE LA PAGE éditée
(migration `0013_editor_boards`) : rien n'est public avant « Publier »,
« Abandonner » efface tout.

- **Modèle.** `slots.draft_state` gagne `retired` (place retirée, supprimée à
  la publication) ; `draft_title` / `draft_description` (textes du brouillon) ;
  `draft_key` (clé stable d'un emplacement ajouté, pour Annuler/Rétablir).
  `projects.draft_page_id` : projet créé depuis la toile (planche neuve),
  invisible du site, de l'écran Projets et des sélecteurs des autres pages
  jusqu'à la publication de SA page ; publié s'il est cité par la page
  publiée, supprimé sinon (ou à l'abandon, ou avec la page). Les actions de
  l'écran Projets refusent un projet en brouillon.
- **Écritures** (`src/lib/edit/boards.ts`). L'état de brouillon d'une planche
  se lit en un instantané (emplacements visibles dans l'ordre, média, textes ;
  + nom, contexte, année d'un projet créé ici). Chaque opération (`add` à une
  position, `move`, `remove` = la place reste, `retire`, `fill`, `text`,
  `project`) transforme l'instantané puis le réécrit en surcouche ; Annuler /
  Rétablir réécrit l'instantané d'avant ou d'après (`restoreBoardAction`), donc
  l'historique de l'éditeur couvre aussi les planches. Gardes : projet publié
  ou créé dans CE brouillon, aucun emplacement du projet sous la surcouche
  d'une autre page (la page qui le tient est nommée dans le refus), projet
  AFFICHÉ par la page (bloc qui le cite, collection ou mis en avant), clés et
  médias contrôlés (un emplacement d'un autre projet est refusé ; un média
  doit être prêt, sauf pour rétablir par Annuler), bornes, version optimiste
  de la page (une écriture de planche crée le brouillon de la page s'il
  n'existe pas). Au plus 10 projets créés par brouillon ; au démarrage, les
  projets en brouillon oubliés (plus cités, plus de 24 h) sont supprimés.
- **Publication.** Seule la surcouche des projets que la page PUBLIÉE affiche
  est appliquée ; celle d'un projet qu'elle n'affiche plus (bloc supprimé)
  est effacée, jamais appliquée — l'éditeur le dit au moment de supprimer le
  bloc (« Les changements d'images de cette planche ne seront pas publiés »,
  Annuler les retrouve). Une planche d'un projet créé ici et encore sans image
  bloque la publication. Un média utilisé par une planche en brouillon
  (remplacement ou ajout) ne se supprime pas. `applySlotDrafts` : ordre, média (ratio de la nouvelle
  image ; une place vidée garde le sien), textes, ajoutés rendus publics,
  places retirées supprimées, positions renumérotées ; projets créés ici réglés.
  Revalidation de `projects` (liste) en plus des projets touchés.
- **Rendu.** Bloc « Planche d'un projet » (`project-board`, un projet = une
  planche ; publication refusée sans projet). En vue brouillon, `ProjectStrip`
  porte les repères (`data-edit-board`, `data-edit-rail`, `data-edit-slot`,
  `data-empty`, `data-slot-inline`, `data-project-inline`) et montre les places
  vides (pointillés au ratio gardé) et les légendes ; rien de tout cela hors
  vue brouillon (parité au pixel).
- **Toile** (`src/components/BoardLayer.tsx`, dans la couche d'édition) :
  barre au survol ou au focus d'une image (Remplacer, Supprimer, Retirer la
  place ; au toucher, un premier toucher la montre) ; glisser une image sur sa
  bande ; clavier ← → / Maj+← → / Suppr / Maj+Suppr / Entrée avec annonces
  aria-live ; curseur d'insertion vertical pour un média glissé depuis
  l'onglet Médias ou des fichiers de l'ordinateur ; fantômes d'envoi insérés à
  la position même (envoi, conversion, « Échec · Réessayer / Retirer »),
  l'emplacement réel n'étant créé qu'avec un média prêt, dans l'ordre du dépôt ;
  textes posés par-dessus (le DOM du site n'est jamais modifié).

### Conteneurs, en-tête commun, formulaire (v0.13)

**Conteneurs de blocs** (`src/blocks/tree.ts`, module pur). Un bloc conteneur
déclare au registre `container: { accepts }` (table `CONTAINERS` de
`tree.ts`, reprise par `define()`) et porte ses composants dans
`props.children` = `{ uid, type, props }[]`. Deux niveaux de conteneurs au
plus (Grille › Vidéo ; au plus un conteneur dans un conteneur), 24 composants par conteneur,
uid obligatoires et uniques dans toute la page. Conteneur livré : « Grille » (`grid` : agencement par
motif répété `1`, `1+2`, `2`, `3`, `2x2`, `4`, `2+1` ; espacement, alignement,
ratio des images ; classes `.block-grid` de `globals.css`, tokens du thème).
**Le conteneur « Projet mis en avant » (`featured-project`, v0.13 à v0.18) a disparu en v0.19** (voir plus bas :
migration 0021) ; son code reste en lecture pour un conteneur que la migration n'aurait pas pu déballer (page de plus
de 40 blocs), il n'est plus proposé ni créable (`deprecated`).
Composants simples : Titre (`section-title`, peut reprendre le nom et la
présentation d'un projet : `linked` + `project`), Planche d'un projet, Image, Texte,
Vidéo (`video-single`, UNE vidéo : médiathèque, ou plan YouTube migré).

- **Validation** : forme de l'arbre (`treeProblem`) au brouillon
  (`DraftSchema.superRefine`) ET à la publication (`savePage` : chaque
  composant validé par le schéma de SON type, erreurs par chemin
  `blocks.2.props.children.0.props.…`, `publishCheck(props, { project })`
  reçoit le projet hérité). Un bloc simple ne porte jamais `children`.
- **Parcours** : tout ce qui lit les blocs d'une page descend dans les
  composants — `walk` / `flatBlocks` / `boardRefs` (planches, projet hérité),
  `refs.ts` (`extractRefs` / `extractProjectRefs` récursifs, profondeur 2 ;
  `depth = 2` = références propres du bloc seulement), `references.ts`,
  `draft-cleanup.ts`, `settleDraftProjects`.
- **Correction I1 étendue** : `displayedProjects(blocks)` (`drafts.ts`) = les
  projets dont une PLANCHE est sur la page (composants compris, projet hérité
  du conteneur) ; seule leur surcouche est appliquée à la publication, et
  c'est la condition des écritures de planche (`boards.ts`). Un conteneur qui
  cite un projet sans montrer sa planche n'en fait pas partie ; supprimer un
  conteneur (ou sa planche) laisse les images en ligne intactes, l'éditeur le
  dit dans la confirmation (nombre de composants retirés).
- **Rendu** : `BlockList` rend les composants récursivement (`ctx.project`,
  `ctx.parent`, `ctx.cell` dans une grille) et les passe au conteneur en
  `children` ; le Projet mis en avant n'ajoute aucune boîte (parité au pixel
  des blocs migrés), vide il ne rend rien. Vue brouillon : enveloppes
  `data-edit-parent`, `data-edit-container`, places `data-edit-container-pick`,
  `data-edit-container-empty`, `data-edit-cell-free` (jamais en public).
- **Toile** (`EditLayer`) : cible de dépôt = conteneur le plus profond sous le
  pointeur qui accepte le composant (bande de 14 px en haut et en bas : entre
  deux blocs de la page), ligne intérieure (barre verticale dans une grille)
  et cadre du conteneur, cadre rouge « n'accepte pas » sinon ; la poignée
  déplace dans / hors d'un conteneur ; barre ⇱ (sortir) / ⇲ (entrer dans le
  conteneur voisin) au clavier ; fil d'Ariane « Grille › Titre »
  (Échap remonte au parent). Panneau : arbre (`StructureTree`, dépliable,
  glisser avant / après / au milieu d'un conteneur), fil d'Ariane, réglages
  du composant choisi. Messages `move { parent }`, `drag-index { parent,
  refused }`, `op out|in`, `layout`, `media-op`, `drop-target media|cell`,
  tous validés par `protocol.ts` (uid au format, champs média en liste
  blanche) ; l'éditeur refuse tout uid absent de l'arbre.
- **Médias des blocs** : `mediaFields` au registre (image, vidéo, fond de
  l'ouverture `backgroundMediaId`, portrait du profil) ; barre Remplacer /
  Retirer au survol, dépôt de vignettes ou de fichiers ; type de média
  contrôlé (une Vidéo n'accepte qu'une vidéo).
- **Palette** : `blockCatalog()` publie aussi des raccourcis (`presets` :
  « Grille de vidéos », « Grille d'images ») et masque les types anciens
  (`deprecated`).

**Migration de contenu 0014** (`src/lib/db/upgrade.ts`, jouée par le
migrateur après `0014_containers.sql` — `DATA_MIGRATIONS` de
`bootstrap.ts`, par étiquette du journal — et par le seed, écrit dans
l'ancien format puis converti), idempotente, publié ET brouillons :
« Projets mis en avant » → conteneur (Titre aux mêmes textes, une planche
par projet, alternance de fond gardée) ; « Planches d'une collection » → une
« Planche d'un projet » par projet (filtrée par métier si le projet en mêle
plusieurs : `collection`, positions `data-slot-pos` pour déposer au bon
rang) ; ancienne vitrine « Vidéos » → Grille 1 grand (demoreel) + Grille 2
(plans). Les listes dynamiques sont figées dans l'état du moment : rendu
public identique au pixel (diff `scripts/parity-diff.mjs` : seules les
icônes de réseaux, nouvelles, diffèrent). Conséquence voulue : un projet
créé dans l'écran Projets n'apparaît plus tout seul sur une page (la
palette signale les projets « pas encore sur une page ») ; le drapeau
« mis en avant » d'un projet ne pilote plus l'accueil. Les anciens types
restent lisibles (rendus) mais ne se créent plus (`deprecatedProblem`).

**Migration de contenu 0021 (v0.19) : plus de conteneur « Projet mis en avant »** (`src/lib/db/unwrap.ts`,
`unwrapContainers` ; `DATA_MIGRATIONS["0021_unwrap_containers"]` et le seed, qui l'enchaîne après `upgradeContent`).
Chaque conteneur (publié, brouillons, conteneurs imbriqués) est « déballé » : ses composants deviennent des blocs de
premier niveau, à la même place et dans le même ordre. Idempotente ; un brouillon réécrit voit son `draft_rev`
augmenter (un onglet resté ouvert reçoit un conflit au lieu de ré-enregistrer l'ancien conteneur).
- `project` du conteneur → porté en dur par ceux qui le reprenaient : Planche d'un projet (`project`) et Titre lié
  (`section-title`, nouveau champ `project`, `linked` gardé), dans une grille comprise. Ils restent donc liés au
  projet (nom, présentation, images ; surcouche de textes `projects.draft_text` et intentions `slot-text` /
  `project-text` inchangées : elles sont clés sur le projet, pas sur le conteneur). Conteneur sans projet : rien à
  porter.
- `more` (lien « voir plus ») → bloc **« Lien vers une page »** (`page-link`, même balisage : rendu public identique)
  posé après le dernier composant ; conteneur vide : disparaît avec son lien (publié) ou garde le lien (brouillon).
- `look` → espace du haut sur le premier composant, du bas sur le dernier (comme le rendu sans boîte), les autres
  réglages (arrondi, titres, fond…) sur chaque composant sous les siens ; `surface` (carte) → la même carte sur chaque
  composant (une carte ne peut plus envelopper un groupe) ; une carte périmée d'un composant est retirée.
- Page qui dépasserait 40 blocs une fois déballée : le conteneur reste en place (lu et rendu), journalisé.
Tests : `scripts/test-composants.mjs` (cas réalistes, idempotence, aucun texte perdu, démarrage réel du migrateur),
`scripts/e2e-composants.mjs`. La limite connue : le conteneur ne se recrée plus ; une grille remplace son usage
« composants rangés ensemble », un Titre lié + une Planche remplacent « un projet et son titre ».

**Regroupement des composants (v0.19)** : `src/blocks/groups.ts` (module pur) est la source UNIQUE du panneau « Ajouter »
et de la fenêtre « Ajouter une rubrique » : chaque type du registre porte `group` (`text`, `projects`, `media`,
`grids`, `other`) et `order` (rang dans le groupe), les raccourcis (`presets`) leur propre `order` ;
`pickerGroups(catalog, STARTER_LIST, requête)` en tire les groupes à en-tête (Texte : les trois raccourcis ; Projets ;
Images et vidéos ; Grilles ; Autres). `blockCatalog()` les publie. Recherche « Chercher un composant » : nom +
description, sans accents ni casse, tous les mots (`matchesSearch`). Pistes non faites : ordre personnalisé par glisser.

**Compteurs « N œuvres · M projets »** de l'en-tête de collection :
calculés depuis la page (`pageCounts` + `boardWorkCount`), brouillon sur la
toile, version publiée en ligne ; info-bulle sur la toile, masquables.

**En-tête, pied de page, réseaux : brouillon du site**
(`src/lib/edit/site.ts`, `src/lib/site-schema.ts`). Données COMMUNES à
toutes les pages : identité (nom, métier, e-mail, mention), menu (réglage
`nav` : pages du site ou liens libres, source unique ; `pages.nav_order` tenu
en phase par `writeNav`), réseaux (`socials`, réseau reconnu d'après
l'adresse, icônes simple-icons CC0 embarquées : `social-icons.ts`).
Modifiés sur la toile (nom, liens et mention en double-clic, ×, glisser,
« + Ajouter un lien », « + Réseau ») ou dans le panneau : réglage
`siteDraft = { pageId, snap }` porté par le brouillon d'UNE page (version
`draft_rev` contrôlée et incrémentée, comme les planches) ; une autre page
ne peut pas y toucher (la page qui le tient est nommée), l'écran Réglages
refuse d'enregistrer pendant ce temps. Publier la page l'applique dans la
même transaction (`applySiteDraft`) et revalide les réglages ; Abandonner ou
supprimer la page l'efface. Bandeau dans l'éditeur : « s'appliquera à toutes
les pages ». Les gestes faits AILLEURS sur le menu pendant ce temps (page
mise au menu ou retirée depuis la liste, ordre, page supprimée, case « dans
le menu » d'une page — appliquée seulement si elle a changé) sont reportés
dans le brouillon (`nav.ts`) : la publication ne les défait pas ; une page
disparue est retirée du menu en silence (jamais d'éditeur bloqué) ; le
brouillon d'une page dont l'appartenance au menu change suit. Liens : http(s) ou chemin du site (jamais `/admin`, `/api`, `/media`) pour
le menu, http(s) ou `mailto:adresse` SANS paramètre pour les réseaux ; ni
`javascript:`/`data:`, ni espace ou caractère de contrôle (même encodé) ;
12 au plus, champs stricts ; revalidés à la lecture (`getSocials`). Lien
« à compléter » (`#`, vide : données d'avant) gardé, signalé dans le
panneau, jamais publié ; en public `target=_blank rel="noopener noreferrer me"`.
L'ouverture et le profil montrent le nom et le métier du site (même
brouillon) ; l'ouverture a son étiquette en place et un fond remplaçable.

**Toile sans éléments collants** : `html[data-edit-canvas]` (mode édition
seulement) remet l'en-tête et tout `sticky`/`fixed` du contenu dans le flux
(`edit-layer.css`) ; l'« Aperçu exact » et le site public gardent le thème.
Glisser : aucune sélection de texte native (`data-edit-dragging`,
`data-ve-dragging`, `user-select`, sélection effacée au départ), sauf dans un
champ en cours d'édition (vérifié dans Chromium ET Firefox).

**Formulaire de contact** (option `form: true` du bloc `contact` depuis la v0.20 ; ancien bloc `contact-form` fusionné par la migration 0023 ; `src/lib/contact-form.ts`,
`POST /api/contact`, table `messages` — migration 0015). Champs définis dans
le bloc (texte court, e-mail, texte long, choix ; 12 au plus ; un champ
e-mail « sert à répondre », protégé), textes en place sur la toile, champs
ajoutés / retirés / déplacés au survol, messages de confirmation et d'erreur
montrés depuis le panneau. Aucun serveur d'envoi d'e-mail : les messages
arrivent dans Admin → Messages (l'éditeur l'affiche ; aucune adresse dans
la page ni dans les données du client). Le formulaire est
désigné par un identifiant STABLE (`formId`, donné à la création ou à la
copie du bloc) : un onglet ouvert reste valable après une republication.
L'envoi est validé contre la définition PUBLIÉE du bloc (aucun champ inconnu,
types, longueurs, choix stricts) ; corps refusé sur Content-Length > 32 Ko
puis lu en flux et coupé au dépassement ; champ piège ; 5 envois / 10 min par
client — IP calculée comme l'auth (`clientIpFromForwarded`,
AUTH_TRUSTED_PROXY_HOPS : la partie gauche de X-Forwarded-For est ignorée,
empreinte seulement) —, 60 / heure tous clients confondus, 2 000 messages
gardés au plus (au-delà 503 et avertissement dans l'admin), purge des messages
de plus d'un an, « Supprimer » / « Tout supprimer » dans Admin → Messages.
Le contrôle d'origine (Sec-Fetch-Site / Origin) n'arrête qu'un formulaire
d'un autre site, pas un script qui forge ses en-têtes : la protection, ce
sont ces limites.

### Corrections v0.13.1

- **Menus de la toile** (`Panel` de `SiteLayer`) : ancrés sur le bouton qui les
  ouvre, ouverts au-dessus s'ils ne tiennent pas dessous, amenés dans la vue,
  focus dedans. « + Ajouter un champ » s'ouvrait sous le DERNIER champ, décalé
  de sa hauteur : hors de la fenêtre avec un texte long, le menu semblait ne
  pas s'ouvrir (le clic e2e de Playwright, qui fait défiler, le masquait).
- **Quitter l'aperçu** (bouton du bandeau, Échap hors saisie et hors
  dialogue) : retour à l'écran de l'admin d'où l'aperçu a été ouvert (champ
  `retour` des formulaires, sinon Referer, retenu dans le cookie `preview-from`,
  chemins `/admin/…` seulement), sinon Admin → Thèmes ; plus jamais l'accueil.
- **Cadre pleine hauteur** : `.site-frame` (flex colonne, `min-height: 100dvh`,
  `main` étiré) dans `[[...slug]]/layout.tsx` : le pied reste en bas d'une
  page courte ; en-tête collant inchangé.
- **Grille** : `padding-bottom` de son propre pas sous la grille
  (`.block-grid-section`), le bloc suivant ne colle plus.
- **E-mail** (`EmailText`) : « nom@ » et « domaine » insécables séparés par
  `<wbr>` (coupure seulement après l'@), taille fluide en `cqi` de la colonne
  (`.email-link`, `container-type`), police du texte du thème.
- **Réseaux** : un seul composant de choix (`SocialPicker` : classiques +
  « Autre lien », adresse reconnue, `mailto:`) pour la toile ET l'admin
  (`SocialsEditor` : Réglages, panneau En-tête / Pied). Les Réglages gardent
  désormais le `kind` des réseaux (il était perdu à l'enregistrement).
- **Icônes des réseaux dans l'en-tête** : `site.headerSocials` (réglage et
  brouillon du site, case dans Réglages et dans le panneau En-tête) ; icônes
  seules (`aria-label`) avant FR/EN, dans le menu sur téléphone.
- **« Entrées des collections »** : nouveau libellé du bloc `collection-tiles`
  (type inchangé en base).
- Tests : `scripts/e2e-lot1.mjs` (sections A–I, clics réels), captures
  `scripts/shots-lot1.mjs`.

### Mise en page sur la toile (lot 2)

Réglages faits directement sur la page, tous en **crans bornés** (jamais de px
libres ni de valeur arbitraire) : `src/lib/look.ts` (module pur, testé par
`scripts/test-look.mjs`).

- **Réglages d'un bloc** : `props.look` de tout bloc ou composant de conteneur
  (le registre étend chaque schéma : `look` illisible = ignoré, jamais le bloc
  masqué). Espace haut / bas (`none · s · m · l · xl`, tokens `--t-space-*` ;
  absent = « Auto », la valeur du bloc dans le thème), arrondi des images
  (`none · soft · medium · strong`), position du titre (`titleH`, `titleV`),
  styles de texte par chemin (`text["title"]`, `text["paragraphs.0"]`,
  `text["site.role"]`…), cadrage par champ média (`crop.mediaId` = point focal
  + zoom), ancien fond du métier de l'ouverture (`roleBackdrop`, lu tel quel ; remplacé au lot 21 par le fond de tout texte).
- **Typographie d'un texte** (lot 7) : tailles en échelle absolue de 11 crans
  (`xs` 12 px … `7xl` jusqu'à 208 px, libellés avec leur valeur), gagnantes sur
  les variantes du thème (préfixe de spécificité des règles de rôle) ; couleur
  = clé de la palette ou couleur libre normalisée `#rrggbb[aa]` (sélecteur
  `ColorPicker`, avertissement de contraste non bloquant via `ratio`) ; listes
  maison `MenuSelect` (taille, graisse : graisses absentes grisées).
- **Rendu** : `BlockList` enveloppe un bloc RÉGLÉ d'un `.blk`
  (`display: contents`, attributs `data-pt/pb/radius/th/tv/crop/role-bd`,
  variables `--crop-pos/--crop-zoom`) ; `src/app/look.css` (hors `@layer`)
  s'y accroche. Sans réglage : aucune enveloppe, DOM inchangé. Un conteneur
  sans boîte (Projet mis en avant) passe ses espaces à son premier / dernier
  composant. Styles de texte locaux : `inline(ctx, chemin)` pose le style en
  ligne (il passe devant le global) ; textes du site posés dans un bloc :
  `textStyle(ctx, "site.name")`.
- **Styles du site** (globaux) : `styles` du brouillon du site (`SiteSnap`,
  publié avec la page comme l'en-tête ; réglage `styles`) : un style par rôle
  (Titre 1, Titre 2, Étiquette, Texte, Légende, Menu, Nom du site, sélecteurs
  `ROLE_SELECTORS`) + arrondi du site. Feuille générée (`siteStylesCss`) dans
  `<style id="site-styles">` du cadre des pages. Ordre : thème < site < texte.
- **Thème** : bloc facultatif `tokens.layout` (délimité dans `schema.ts`) :
  crans S–XL, haut de page (`pageTop`), espace des planches (`stripPad`),
  arrondi des images (`mediaRadius`), fond du métier (`heroRoleBackdrop`).
  Sans ce bloc : rendu d'avant (`DEFAULT_LAYOUT`). Galerie lumineuse :
  resserrée, images sans arrondi, métier en « ombre douce » (sans fond, le
  contraste mesuré au pixel ne tient pas sur le décor). Les presets en base
  suivent le code au démarrage (`syncPresets` de `src/lib/db/seed.ts`, lot 5 :
  ils ne se modifient pas dans l'admin ; les copies et thèmes personnels ne
  sont jamais touchés).
- **Polices Google** : catalogue STATIQUE embarqué (`google-fonts.json`,
  ~1200 familles latines, `scripts/gen-google-fonts.mjs`). Quand l'artiste en
  choisit une, l'éditeur demande au SERVEUR (`installFontAction`) le style
  utilisé (graisse × italique) ; `src/lib/fonts/library.ts` télécharge la
  feuille css2 (hôte fixe), puis les woff2 latin + latin-ext de
  fonts.gstatic.com (hôte contrôlé, redirections refusées, signature `wOF2`,
  tailles bornées : 12 familles, 8 styles, 600 Ko / fichier, 24 Mo en tout),
  les range dans `<DATA_DIR>/fonts/<empreinte>.woff2` (réglage `fontLibrary`)
  et les sert par `GET /fonts/<empreinte>.woff2` (cache immuable). Le
  `@font-face` est émis par le site : aucune requête vers Google depuis le
  navigateur (visiteurs comme admin : les aperçus du menu passent par
  `/admin/api/fonts/preview`, sous-ensemble minuscule téléchargé par le
  serveur). Échec réseau : message clair, le style n'est pas appliqué.
  Ramasse-miettes : seules les polices utilisées comptent ; une police tout
  juste installée ou re-choisie est « louée » 30 min (réglage `fontLeases`,
  `FONT_GRACE_MS`) car aucun brouillon ne la cite avant l'autosave ; passé le
  délai, une police inutilisée redevient récupérable. Écran Réglages →
  Polices téléchargées couvert par `e2e-admin` (D), course au GC par
  `test-integ-units`.
- **Toile** (`src/components/edit/LookLayer.tsx`, dans le calque d'EditLayer) :
  poignées d'espacement du bloc choisi (glisser aimanté aux crans, flèches),
  « Aa » au survol de tout texte éditable → barre typographique (ce texte /
  tous les textes de son rôle), pictogrammes de position du titre, « Cadrer »
  sur une image affichée hors de son format (vue zone claire / reste grisé,
  souris, molette, clavier). Messages `look` et `site-style` (protocole) ;
  l'éditeur valide, télécharge les polices manquantes, enregistre.
- **Intégration lots 2 + 3** : arrondi d'UNE image d'une planche (barre de
  l'image sur la toile, à côté de Remplacer / Supprimer) : `look.slotRadius`
  du bloc planche, par slug d'emplacement (`--media-radius` posé sur le cadre
  de l'image par `ProjectStrip`) ; « Auto » = arrondi du bloc, du site, du
  thème. Barre typographique sur le formulaire de contact (titre, libellés,
  bouton, messages : `ContactForm` reçoit `styles`) et sur la légende du
  lecteur vidéo (`VideoCard`, `LOCAL_ONLY` de `LookLayer`). Bloc CV : accepté
  dans les Grilles et Projet mis en avant (`SIMPLE` de `tree.ts`), pages
  arrondies selon `--media-radius`. Fond de la visionneuse (`--t-color-viewer`)
  dérivé du voile de la palette (lot 4). Kit : la carte 4 devient « Cadre des
  entrées de collection » (ancien nom reconnu à l'import).
- **Migration 0016** (contenu seul, `renameVideoLook` dans `upgrade.ts`) : la
  présentation du bloc Vidéo (`feature · card · plain`) s'appelait `look`,
  nom que le lot 2 donne aux réglages de mise en page de TOUS les blocs
  (registre) : écrasée, elle retombait à rien (carte du lecteur absente). Elle
  devient `variant` (publié, composants des conteneurs, brouillons ; rappelée
  par le seed). Un champ de bloc ne s'appelle jamais `look`.
- **Cadrage** : uniquement `object-position` + `transform: scale` (aucun
  recalcul d'image). Emplacements : image seule à format imposé (`ratio`),
  image d'une cellule de grille à ratio, fond de l'ouverture, portrait du
  profil (`portraitRatio`).

### État local de la toile et menus flottants (lot 6)

- **L'état local fait foi jusqu'à l'acquittement du serveur** (`src/components/edit/optimistic.ts`).
  Cause du « mini retour en arrière » : le texte en place, l'espacement validé
  (le style en ligne du glisser était retiré dès le relâchement), le style d'un
  texte et la base de `lookOf` n'étaient posés que sur le DOM ; une réponse du
  serveur rendue AVANT la modification suivante (ou avant l'enregistrement de
  celle-ci) remontait le bloc (clé = empreinte des props) et remettait
  l'ancienne valeur, jusqu'au rafraîchissement suivant. Désormais :
  - chaque message d'intention de la toile porte un numéro croissant (`seq`,
    hors schéma zod, extrait par `acceptFromCanvas`) ;
  - chaque aperçu est inscrit sous une clé (`pad:`, `tstyle:`, `role:`, `text:`,
    `site-text:`, `order:`, `layout:`, `look:` pour la base des gestes suivants)
    avec le numéro de son message, et RÉAPPLIQUÉ par un MutationObserver après
    chaque rendu de la page (donc avant l'affichage : aucune image
    intermédiaire) ;
  - la page rendue en vue brouillon porte `<span hidden data-edit-rev>` (révision
    `pages.draft_rev` lue au rendu) ; l'éditeur annonce `refresh` / `settle`
    avec `rev` (révision écrite) et `upTo` (dernier numéro dont plus rien n'est
    attendu : rien à enregistrer, aucune écriture en vol ni en préparation —
    `quiet()` de `VisualEditor`, `-1` sinon). Quand la page atteint `rev`, les
    aperçus de numéro ≤ `upTo` sont retirés ; les plus récents restent par-dessus
    une page en retard. Un enregistrement refusé ou en échec ne lâche rien
    (l'état local reste affiché ; conflit `draft_rev` : l'éditeur s'arrête et
    la toile garde ce qu'on a tapé).
  - Réordonnancement : `op` monter / descendre et `move` dans le MÊME parent
    réordonnent les enveloppes existantes (déplacements minimaux). Entre deux
    parents, ou quand les enveloppes ne partagent pas le même nœud parent
    (cellules d'une grille), rien n'est déplacé à la main : React ne doit
    jamais retrouver un nœud sous un autre parent ; le changement s'affiche
    alors à l'acquittement, sans jamais montrer d'ancien état.
  - **Refus et échec** (planche tenue par une autre page, titre vide, connexion
    perdue) : l'éditeur envoie à la toile `revert` (`seq` de l'intention,
    validé par le protocole) ; l'aperçu de ce numéro est retiré ET le texte
    d'origine rétabli. Un aperçu de texte s'écrit dans le nœud que React gère
    sans que React le sache : si le serveur rend la même valeur qu'avant (refus,
    Annuler), React ne réécrit rien et l'aperçu resterait affiché. Un nœud
    commentaire accompagne donc l'aperçu ; React, en réécrivant le texte
    (`textContent`), l'efface. Marqueur encore présent au retrait = rien n'a été
    réécrit : la valeur d'origine revient (`optimistic.ts`, `writeText`).
  - `resetOverlays()` vide tout lors d'une navigation interne de la toile
    (`EditLayer`, changement de chemin) : les uid de blocs (`b0…`) sont réutilisés
    d'une page à l'autre. Annuler / Rétablir passent, eux, par l'acquittement
    habituel (`settle`) après la fin des écritures en cours.
- **Poignées d'espacement** : la poignée se tient sur le bord de la zone qui suit
  le curseur. Haut : le bord côté contenu (tirer vers le bas agrandit). Bas :
  le bord extérieur (tirer vers le bas agrandit, vers le contenu réduit), mêmes
  crans et mêmes bornes (Aucun … XL) des deux côtés.
- **Fermeture des menus flottants** : un seul mécanisme, `useDismiss`
  (`src/components/edit/useDismiss.ts`), pour la toile ET le panneau : clic à
  l'extérieur (pointerdown en capture), Échap (le plus récent seulement),
  passage du focus à l'autre cadre. Il ignore les clics dans le menu et dans
  les menus ouverts plus tard (sous-menus), sur le bouton qui l'a ouvert
  (`aria-expanded="true"` : c'est lui qui bascule), les barres de défilement
  et ce qui n'est pas un clic (défilement, `<select>` natifs). Fermer ne perd
  rien : chaque réglage est appliqué au moment du choix ; la croix reste.
  Branché sur : barre de style du texte (✕ conservée), menu des polices,
  fenêtres de la couche site (ajout de lien, réseaux, champs de formulaire),
  choix de projet d'un conteneur et sa liste, agencement d'une grille, liste
  de projets du panneau, file d'envoi, menu mobile de l'admin, fond de la
  fenêtre de choix d'image. Tout nouveau menu flottant l'utilise
  (`useDismiss(ref, onClose)`) ; un clic « sur le texte visé » se déclare par
  `ignore`.

## Cartes de rubrique et ajout de texte (lot 17c)

**Demande.** L'illustratrice garde son papier de kit en fond mais veut, « par-dessus, pour chaque petite rubrique, un
rectangle d'une couleur », choisie au moment de l'édition, aux bords droits ou arrondis, pleine largeur ou en retrait
pour que le papier se voie. Et elle ne trouvait pas comment ajouter du texte.

**Carte.** `props.surface` d'un bloc de premier niveau : `{ color, width: full|inset, corners: square|round }`, tout
facultatif (zod strict, `SurfaceSchema` dans `src/themes/schema.ts`). `color` : un jeton de la palette (fond, fond
profond, surface, action, accent secondaire, texte) ou une couleur libre `#rrggbb[aa]` (celle du sélecteur de texte).
Clé absente = pas de carte, DOM public inchangé (8 presets au pixel : `parity-shots` avant / après identiques).
`{}` = carte avec les réglages du thème (`tokens.layout.card`, éditeur de thème), sinon `FALLBACK_CARD`
(surface, en retrait, arrondie). Rayon : `max(--t-radius-lg, 12px)`, gouttière : `--gutter` du thème.

**Palette du site.** Les jetons et le texte d'une carte se calculent sur la palette EFFECTIVE (thème + surcharges
`styles.palette` du site, lot 17f) : `BlockList` (serveur, `effectiveSitePalette` via `pagePalette`, toujours appliquée comme dans le layout : lot 29) et `canvasPalette` / `refreshCards` (toile, pendant l'aperçu de la palette). Test : `e2e-integ17.mjs`.

**Lisibilité.** `cardStyle` (src/themes/surface.ts, module pur) choisit le texte du thème s'il passe AA sur la carte,
sinon le texte inverse (fond du thème, texte des boutons), sinon le meilleur ; texte secondaire, liens, étiquettes,
accent et boutons suivent (ils gardent la teinte du thème tant qu'elle se lit). Le résultat est posé en `--card-*` sur
l'enveloppe ; `look.css` les relaie vers `--color-*` / `--btn-*` à l'intérieur de la carte seulement (les variables
dérivées de `:root` comme `--btn-bg` sont recalculées à la main : elles sont résolues sur `:root`). Si même ainsi le
texte reste sous 4,5:1, `ok` est faux : pastille d'alerte et message dans le popover, rien n'est bloqué.

**Toile.** Bouton « Fond » dans la barre du bloc (`SurfaceMenu.tsx`) : interrupteur, pastilles de la palette, « Autre
couleur… » (`ColorPicker`), largeur, coins. Intention `surface` (protocole), aperçu immédiat (`previewSurface`) gardé
jusqu'à l'acquittement, rétabli par `revert` si l'écriture est refusée (composant de conteneur) ; Annuler / Rétablir
par l'historique (`setBlocks` avec la clé `surface:<uid>`). L'enveloppe `.surface-card` est toujours rendue en vue
brouillon (sans carte : `display: contents`) pour ne jamais ajouter ni déplacer de nœud de React.

**Ajout de texte (U5).** Cause : la rubrique « Texte » existait, mais seulement dans l'onglet « Ajouter » du panneau
(douzième carte d'une longue liste, un glisser-déposer), sans aucun point d'entrée sur la page ; « Titre » (le premier
type de texte de la liste) était le seul qu'on voyait. Désormais : « + Ajouter une rubrique » en bas de page, « + » entre
deux rubriques au survol, « Texte » dans une case vide de grille et deux boutons en tête du panneau ; le choix illustré
(`AddSectionDialog`) met « Texte » et « Titre + texte » en premier. Le bloc inséré (`rich-text` + texte d'aide,
`help-text.ts`) s'ouvre en édition en place, texte d'aide sélectionné (message `edit-text`) ; la publication refuse un
texte d'aide non remplacé.

**Texte, Titre, Titre + texte (lot 19a).** Cause du retour de la v0.17 : le bloc `rich-text` neuf portait `title: {fr:"",en:""}`
et la toile rend le titre dès que la clé existe (gros « Titre » gris), et le paragraphe gardait `mt-6` même sans titre : un
« Texte » seul réservait une place de titre et ouvrait 24 px de trop au-dessus (avant : 183 px de haut sur la toile, 122 en
public ; après : 86 et 98, soit l'espace de section puis le paragraphe). Modélisation retenue : **un champ n'existe que si sa
clé existe** (pas de second type de bloc : « Texte » et « Titre + texte » sont le même `rich-text`, « Titre » est le
`section-title` existant). `TEXT_STARTERS` pose le bloc et ses seuls champs ; « + Ajouter un titre » / « Retirer le titre »
(intention `field-op`) créent ou retirent la clé sur la toile. Les anciens blocs au titre vide sont migrés (0020, rendu public
inchangé : un titre vide n'y était déjà pas rendu), ceux qui ont un titre se rendent à l'identique (HTML comparé au caractère près).

## Authentification (phase 3)

- **Better Auth 1.7**, adaptateur Drizzle, tables `user`, `session`, `account`,
  `verification`, `rate_limit` (migration `0001_auth`). Tout utilisateur est
  administrateur : il n'y a ni inscription publique ni rôles.
- **Authentik** par le plugin generic OAuth (découverte, PKCE S256, nonce). Callback :
  `${PUBLIC_BASE_URL}/api/auth/callback/authentik` (callback standard de Better Auth 1.7).
- **Liste blanche** dans `user.validateUserInfo` : appelé à la création, à la liaison
  ET à chaque connexion OAuth, avec le profil brut. Ordre de solidité : `sub` explicite
  (`AUTH_ADMIN_SUBS`), groupe (`AUTH_ADMIN_GROUP`), e-mail (`ADMIN_EMAILS`) seulement si
  `email_verified === true`. Refus → `?error=admin_not_allowed`, rien de créé.
- **Aucune liaison implicite** (`accountLinking.disableImplicitLinking`) : une identité
  Authentik qui porte l'e-mail d'un compte existant est refusée (`account_not_linked`).
- **Revérification à chaque requête** : les claims autorisés sont mémorisés
  (`oidc_identity`) ; `getAdminSession()` revérifie l'accès contre la configuration
  courante et révoque la session si l'accès a été retiré.
- **Premier admin** : `ADMIN_EMAIL` + `ADMIN_PASSWORD` si la table `user` est vide
  (insertion directe, mot de passe haché par Better Auth).
- **Démarrage** : `BETTER_AUTH_SECRET` absent ou < 32 caractères en production → arrêt.
- **Garde en profondeur** : `src/proxy.ts` (cookie de session présent, sinon
  redirection), layout de l'espace admin (`requireAdmin()`, session vérifiée en base),
  `assertAdmin()` en tête de chaque server action (→ `forbidden()`, 403 ; convention
  vérifiée par `scripts/test-admin-guard.mjs`).
- **Limitation de débit** (avant Better Auth) : 5 tentatives par minute et par IP,
  toutes comptées (IP calculée par `AUTH_TRUSTED_PROXY_HOPS` depuis la droite de
  `X-Forwarded-For`), puis délai progressif par couple (e-mail, IP) (`auth_throttle`) :
  un attaquant ne peut ralentir que ses propres tentatives.
- **En-têtes** : `next.config.ts` (XFO, Referrer, nosniff, Permissions,
  `frame-ancestors`) ; CSP complète à nonce sur `/admin` posée par le proxy. Pas de
  CSP à nonce sur le public : incompatible avec le cache ISR (même HTML pour tous).
- **Aperçu de thème** : routes POST `/admin/apercu` (formulaire natif, nouvel onglet,
  session + même origine), cookie appliqué seulement avec une session admin valide,
  bandeau d'aperçu rendu uniquement en draft mode ; GET réservé au développement.
- **Admin** : UI propre (`src/app/admin/admin.css`, tokens `--admin-*`, jamais les
  `--t-*` du thème public), racine HTML séparée, toujours dynamique, `noindex`.

## Textes d'un projet depuis un bloc (v0.15)

Un projet a UNE source de vérité pour ses textes : la ligne `projects` (nom,
contexte, présentation, année). Planche, titre lié d'un « Projet mis en avant »,
écran Projets et page projet lisent la même ligne. Depuis la v0.15 on les modifie
EN PLACE sur la toile depuis tout bloc qui les montre (en-tête de la planche,
titre lié, présentation), et depuis l'écran Projets, sans copie du texte dans les
blocs.

- **Stockage = le motif des emplacements** : surcouche par page sur `projects`
  (`draft_text` JSON `{ title, context, description, year }` + `draft_text_page_id`,
  migration 0017, `ON DELETE SET NULL`). Le site public ne lit jamais ces colonnes ;
  la vue brouillon de CETTE page les applique (`readProjects(ids, pageId)` dans
  `gallery.ts`). Choix écarté : mettre les textes dans `pages.draft` (une copie par
  page, deux pages divergent, la dernière publication écrase en silence) ; ou écrire
  la ligne en direct (ne respecte pas « rien n'est public avant Publier »).
- **Écriture** (`boards.ts`) : même instantané que la planche (`BoardSnap.project`,
  maintenant renseigné pour tout projet, `description` comprise), mêmes opérations
  (`op: "project"`), même historique Annuler / Rétablir, même version optimiste
  `pages.draft_rev` (deux onglets : « modifié ailleurs », rien d'écrasé). Une
  modification de texte seule ne touche pas aux emplacements (pas de
  `draft_page_id` posé) ; revenir aux textes publiés efface la surcouche. Garde
  `textAccess` : la page doit CITER le projet (planche, projet d'un conteneur, titre
  lié : `referencedProjects`, pas seulement `displayedProjects`) et aucune AUTRE page
  ne tient déjà ses textes (refus qui la nomme). Un projet créé dans ce brouillon
  garde ses textes sur sa ligne (invisible ailleurs) comme avant.
- **Publication / abandon** (`drafts.ts`) : `applyProjectTextDrafts` à côté de
  `applySlotDrafts` (publication de la page et ancien formulaire), seulement pour les
  projets que la page publiée cite encore (sinon surcouche effacée, jamais appliquée) ;
  les projets touchés sont revalidés. `discardProjectTextDrafts` à l'abandon et à la
  suppression de la page. L'écran Projets refuse d'enregistrer les textes d'un projet
  tenu par une page (message qui la nomme, avis en tête de l'écran).
- **Sur la toile** : `data-project-inline` (`title`, `context`, `year`, `description`) ;
  même projet montré deux fois (titre lié + planche) : le rafraîchissement suivant
  l'écriture met à jour toutes les occurrences. Le CONTENU est au projet, la MISE EN
  FORME reste au bloc : `data-look-key` → `look.text.title|intro` du Titre lié
  (barre « Aa »). Indicateur discret au survol (`.pe-project-hint`, couche
  `BoardLayer`) : « Texte du projet « X » — modifié aussi sur sa planche et sa page »
  + « Voir le projet » (écran du projet) ; « lecture seule » si une autre page tient
  les textes (`data-edit-board-text-held`). Il remplace l'ancien bandeau « Images en
  cours de modification… » (désormais `data-edit-board-held` + même indicateur).
- **Règles d'écriture des textes** : mêmes que l'écran Projets (`ProjectMetaSchema`) :
  espaces retirés, titre français et année jamais vides. Contrôlées à chaque
  écriture (`op: "project"` et Annuler / Rétablir) ET à la publication
  (`invalidProjectTexts` refuse, `applyProjectTextDrafts` n'applique jamais un
  texte invalide). Sur la toile, un titre vidé est refusé (message) et le texte
  d'origine revient. Une opération qui ne change rien ne passe par aucune garde.
  Annuler / Rétablir ne réécrit que les champs que le pas change vraiment (l'éditeur
  envoie la planche qu'il croit courante) : une modification faite entre-temps dans
  l'écran Projets n'est pas écrasée. Quand une page tient les textes, l'écran Projets
  n'enregistre que « Mis en avant » et l'explique.
- **Ouverture** : l'indicateur de défilement (`scroll`, `showScroll`) et le bouton
  demoreel (`reel`) sont des textes éditoriaux du bloc (`inline`, fr/en, style local
  `look.text.scroll|reel`). Absent ou vide pour la langue = message d'interface
  (`home.hero.scroll|reel`) : aucune migration, rendu identique pour l'existant. La
  phrase d'accroche (balisage `<mark>`) se modifie aussi sur la toile depuis la v0.16
  (voir plus bas) ; la note en marge du hero « type-only » est un décor du thème
  (`assets.heroNote`).

## Suite de l'éditeur (v0.16, lot 10)

- **Accroche de l'ouverture en place** (`hero.statement`, thèmes à ouverture
  « type-only » : c'est le seul rendu qui l'affiche ; sinon le panneau seul). Stockage
  inchangé : une chaîne par langue où SEUL `<mark>…</mark>` est reconnu. Module pur
  `src/lib/marked.ts` (lecture, validation `markedProblem`, bascule d'un surlignage sur
  un intervalle). **Aucun HTML n'entre** : la toile lit le champ en nœuds texte
  (`textContent`), retire `<` et `>` à la saisie ET au collage ; l'éditeur refuse tout
  balisage autre que `<mark>` bien formé (non imbriqué, non vide) et prévient (le
  message est refusé, l'aperçu retiré) ; la publication le revérifie
  (`publishCheck` du hero) ; le rendu ne fait que poser des nœuds texte.
  Rendu en vue brouillon : le contenu est dans UNE enveloppe `[data-marked-body]` que
  React gère et que la toile ne touche jamais ; le champ de saisie
  (`[data-marked-edit]`) et l'aperçu (`[data-marked-over]`) sont des éléments à NOUS posés
  à côté, l'enveloppe étant seulement cachée (`src/components/edit/marked-edit.ts`).
  Double-clic → champ + petite barre « Surligner » (mot sélectionné, ou mot sous le
  curseur ; « Retirer le surlignage » si déjà surligné ; Ctrl/Cmd+Maj+H), Entrée valide,
  Échap valide (comme un clic ailleurs). Langue = celle de la toile (fr / en).
- **Rétablissement des textes à plusieurs nœuds** : l'aperçu de l'accroche
  (`previewMarked`) se retire avec le mécanisme `revert` (refus, éditeur arrêté, Annuler) :
  retirer l'élément à nous rend exactement l'enveloppe de React, sans rien reconstruire.
  Repli générique (`writeText`) : un autre texte à plusieurs nœuds garde ses nœuds
  d'origine et les remet au retrait. Correction liée : le texte tapé en place
  (`EditLayer`) n'avait pas gardé son texte d'origine (l'élément montre déjà le texte
  tapé) : un refus ne rétablissait rien ; `previewText` reçoit maintenant `original`. Un
  éditeur arrêté (« modifiée ailleurs ») refuse aussi les textes en place suivants
  (`editText` renvoie false → `revert`).
- **Aperçu instantané des listes** (`optimistic.ts`, `previewList`, `listKeys`) : ajouter,
  retirer, déplacer un lien du menu, un réseau, un champ de formulaire de contact. Sans
  jamais déplacer ni retirer un nœud de React : ordre par la propriété CSS `order` (un
  conteneur de bloc passe en colonne flex le temps de l'aperçu, `data-pv-list`), retrait
  par `display: none`, ajout par un élément « fantôme » à nous (copie d'un voisin, opacité
  réduite, inerte, « … » après le libellé), lien de réseau modifié = élément `data-pending`.
  Chaque élément porte une CLÉ STABLE en vue brouillon (`data-nav-key` : page ou adresse ;
  `data-social-key` : nom|adresse ; `data-form-field-id` : identifiant du champ ;
  doublons `#2`, `src/lib/site-schema.ts`). L'aperçu est une suite d'opérations rejouée sur
  les clés du DOM : il se superpose à n'importe quel rendu du serveur, en retard ou déjà à
  jour, sans doublon (un champ ajouté porte l'identifiant choisi par la toile, protocole
  `form-field.id`). Les gestes de l'en-tête et du pied portent maintenant un numéro
  d'intention (`site-op`, `form-field` dans `CANVAS_INTENTS`) : refus (en-tête tenu par une
  autre page, valeur invalide, dernier champ, champ de réponse), échec réseau → `revert`.
  Les index envoyés à l'éditeur sont ceux de la liste telle qu'il la tient, aperçus en
  attente compris (`rankOf`). Le nom d'un lien du menu s'aperçoit sur sa clé.
- **Annuler / Rétablir** : le résultat n'est pas calculable par la toile ; état « en cours »
  (message `pending` éditeur → toile) : pastille « Annulation en cours… » et voile léger
  (`html[data-edit-pending]`, apparaît après 300 ms pour ne pas clignoter), levé à
  l'acquittement (`refresh`/`settle` avec `upTo ≥ 0`), à l'échec, ou au bout de 10 s.
- **Correction** : la poignée de glisser du menu, des réseaux et des champs de formulaire
  disparaissait dès le premier mouvement (la barre d'outils était démontée pendant le
  glisser : la capture du pointeur était perdue, le relâchement jamais vu, le repère restait
  affiché). Elle est maintenant cachée (`visibility`), pas démontée.
- **Nom du site fr / en** : `site.name` devient `{ fr, en }` (réglage `site` et brouillon du
  site). `en` vide = le nom français (`siteNameFor`, `asSiteName`, `SiteNameSchema` dans
  `src/lib/site-schema.ts`). La chaîne d'avant est lue comme `{ fr: chaîne, en: "" }`
  (onglet ouvert, brouillon ou test d'avant) : le rendu des données existantes ne change pas.
  Migration de contenu **0018** (`siteNameI18n`, `DATA_MIGRATIONS` ; SQL vide `SELECT 1;`),
  idempotente, réglage ET brouillon du site. Modifiable en place dans la langue affichée
  (en-tête, ouverture, profil ; l'anglais vide reprend le français, le français vide est
  refusé), dans le panneau de l'en-tête (« Nom du site (FR) » / « (EN) ») et dans
  Réglages. Texte localisé partout : en-tête, pied de page, ouverture, profil, titre de la
  page 404 ; le kit de thème (signature) et l'écran d'administration gardent le français.
- **Sélecteur de couleur** : la pastille des curseurs (18 px, centrée sur la valeur) dépassait
  de 9 px de sa piste à 100 % ; la fenêtre défilait en largeur. La piste a une marge de 9 px et la
  fenêtre `overflow-x: hidden`.

## Notes de version v0.19 : composants regroupés, plus de « Projet mis en avant »

**Retour arrière vers la v0.18.** Les migrations 0021 (déballage des conteneurs) et 0022 (colonne `pages.collection`, En-tête de collection → Titre) réécrivent les blocs (publiés et brouillons) : les conteneurs
« Projet mis en avant » n'existent plus, la v0.18 lit les nouveaux blocs mais ignore le champ `project` d'un Titre
(`section-title` : un Titre lié sans conteneur ne rend rien) et ne connaît pas « Lien vers une page » (`page-link`,
bloc ignoré). Avant de redescendre, restaurer la base de la v0.18 (sauvegarde du volume `data`).

**Changements visibles sur les pages existantes** : les conteneurs sont remplacés par leurs composants posés les uns
sous les autres (rendu public identique, sauf une carte de couleur qui enveloppait le conteneur : une carte par
composant désormais) ; l'ajout de composants est rangé en groupes.

## Notes de version v0.18 : retour à la v0.17 et changements visibles

**Retour arrière vers la v0.17.** Un thème dont la carte par défaut (`tokens.layout.card.color`) est une teinte neuve
(`primary12`, etc., ajoutées au lot 19b) est **rejeté en entier** par la v0.17, qui retombe alors sur le thème
`galerie-lumineuse`. Avant de redescendre, remettre un jeton connu de la v0.17 dans la carte par défaut du thème
(`bg`, `surface`, `primary`…). Rien n'est effacé : le thème reste en base, il redevient lisible une fois le jeton
remplacé ou la v0.18 remise en ligne. À partir de la v0.18, `layout.card` est lu avec tolérance (un champ `color`,
`width` ou `corners` inconnu est ignoré et retombe sur la valeur par défaut au lieu de faire rejeter le thème) : les
versions suivantes ne rejetteront plus un thème pour un jeton qu'elles ne connaissent pas encore. Les clés inconnues
de la carte restent refusées.

**Changements visibles sur les pages existantes** (voulus, aucun réglage à reprendre) :

- Les Textes **sans titre** perdent la marge de 24 px qui les séparait de la rubrique précédente : un paragraphe seul
  prend le rythme des autres rubriques (espace de section du thème).
- **Espacement des cartes** : l'espace de section du thème se place avant la carte (le padding de la carte reste
  symétrique) et un espace choisi à la main sur la toile (`data-pt`) est désormais appliqué aussi dans une carte.

**Enregistrer le thème en ligne** exige une confirmation vérifiée côté serveur (`saveThemeAction(id, thème, confirmLive)`) ;
l'interface l'envoie après sa boîte de confirmation.

## Notes de version v0.17 : retour à la v0.16

Aucune colonne n'est ajoutée par la v0.17 (la migration **0019** est une migration de contenu : `fit: "cover"` sur
les images pleine largeur à format imposé) : la v0.16 démarre sur une base de v0.17 sans erreur, mais **ne connaît
pas** ce que la v0.17 a écrit et le perd ou l'ignore :

- **Palette et logo du site** (`styles.palette`, `styles.logo`) : ignorés ; **toute modification faite en v0.16 (une
  simple publication) efface la palette et le logo** du réglage `site` et du brouillon du site.
- **Cartes de rubrique** (`props.surface`) : ignorées (les rubriques s'affichent sans carte) ; effacées si la page est
  réenregistrée.
- **Recadrages libres** (`look.crop.*.rect`, `look.tileCrop.*.rect`) : ignorés (point focal et zoom seulement) ;
  effacés si la page est réenregistrée.
- **Thèmes à `plansOnly`** et kits multi-PSD : la v0.16 rejette ou ignore ces thèmes.
- Jobs `crop-warm` en file : marqués « type de job non pris en charge » (sans conséquence).

**Ne pas éditer après un retour arrière** (ni publier, ni enregistrer un thème, ni toucher aux réglages) tant que
la v0.17 peut revenir : **sauvegarder `/data`** (base SQLite, `media/`, `fonts/`) AVANT la mise en ligne de la
v0.17 et restaurer cette sauvegarde (pas seulement l'image Docker) pour revenir à la v0.16 sans perte.

## Notes de version v0.16 : retour à la v0.15 destructif pour le nom du site

La migration de contenu **0018** (`siteNameI18n`) transforme le nom du site, dans le réglage `site`
ET dans le brouillon du site, de la chaîne d'avant en `{ fr, en }`. Une v0.15 relancée sur une base
de v0.16 ne sait pas lire cette forme : le nom du site (en-tête, ouverture, profil, titre des
pages) s'affiche vide ou cassé, et l'enregistrer depuis la v0.15 perd le nom anglais. **Un retour
en arrière n'est pas sans perte : sauvegarder `/data` (base SQLite, `media/`, `fonts/`) AVANT la
mise en ligne de la v0.16**, et restaurer cette sauvegarde (pas seulement l'image Docker) pour
revenir à la v0.15. Dans l'autre sens, la v0.16 lit sans migration manuelle une base de v0.15.

## Notes de version v0.15 : changements de rendu pour les données déjà stylées

Des réglages de texte enregistrés avant la v0.15 ne s'affichent plus tout à fait
pareil (aucune migration, la donnée n'a pas changé) :

- **Crans 2xl à 5xl** : l'échelle de tailles est désormais absolue, à 11 crans
  strictement croissants (6xl et 7xl ajoutés). Les valeurs de 2xl, 3xl, 4xl et 5xl
  ont changé (ex. 5xl : `clamp(3rem, 10vw, 7.5rem)` devient `clamp(3.75rem, 11vw, 7rem)`) ;
  un texte déjà réglé sur l'un d'eux change légèrement de taille.
- **`scale` sans `size`** : l'ajustement fin ne s'applique que sur un cran. Un style
  qui n'avait que `scale` n'a plus d'effet (avant, `1em` visait la taille du
  parent et pouvait écraser celle du thème).
- **Rôles réglés** (styles du site) : leurs règles gagnent maintenant sur les
  variantes du thème (préfixe de spécificité) ; un rôle réglé qui était masqué par
  une variante du thème devient visible.
- **Couleur** : `color` accepte aussi une couleur libre `#rrggbb[aa]` (sans effet sur
  l'existant).

## Palette et logo du site depuis l'éditeur visuel (lot 17f)

**Où vit la palette ?** Trois emplacements existaient : le thème (`themes.data`, éditeur de thème, contrôle AA
bloquant), la couche « look » (`styles` du brouillon du site : textes par rôle, arrondi) et les réglages d'un
bloc. Une palette éditée depuis la toile doit se publier avec « Publier », ne jamais toucher un thème livré et
rester lisible des deux côtés : elle est donc une **surcharge explicite** de `styles` (`styles.palette`, six bases
en `#rrggbb`), au même endroit et sous la même règle que les styles de rôle (brouillon du site porté par une page,
appliqué à sa publication, abandon = effacé). Écrire dans le thème aurait modifié un thème partagé (livré ou
dupliqué) à l'insu de l'éditeur de thème ; ajouter une table aurait créé une troisième source. Côté éditeur de
thème, un avis (`site-palette-notice`) dit quelles couleurs le site remplace par-dessus le thème en ligne, et son
aperçu en direct met la surcharge de côté. Côté éditeur visuel, chaque rôle est marqué « thème » ou « modifiée »
et « Revenir aux couleurs du thème » retire tout.

**Nuances.** Jamais surchargées : `applySitePalette` passe en « auto » les nuances enregistrées qui lisent la base
changée (fond profond, filets, texte secondaire, survol, texte des boutons) et laisse celles qu'un thème a forcées
sans dépendre d'elle (ombres, voile). Conséquence assumée : teinter le fond de page peut faire passer le fond
profond sous 4,5:1 pour les étiquettes ; l'avertissement le dit et « Ajuster automatiquement » (`autoAdjustBase`)
cherche la teinte la plus proche dont les nuances recalculées passent aussi.

**Contraste (lot 29).** Avertissement seulement : saisie libre, publication et enregistrement acceptés, rendu public qui
applique toujours la palette du site. Nuances (lot 29) : `styles.palette` accepte aussi les neuf nuances (`#rrggbb` ou « auto » =
le calcul même si le thème l'avait forcée), posées après les bases par `applySitePalette` (`setNuance`) ; un voile choisi devient
tel quel le fond de la visionneuse (`--t-color-viewer`), calculé il reste un gris neutre. Panneau « Couleurs » : nuances rangées
sous leur rôle, groupe « Image agrandie ». `color-scheme` suit le
fond effectif, mais les variantes `data-scheme` du thème (posées sur `<html>` par le layout racine, mis en cache)
restent celles du thème : passer d'un fond clair à un fond sombre n'active pas les règles propres aux thèmes sombres.

**Logo.** `styles.logo` = `{ size 24–160, mode fixed | shrink | overhang }`, feuille `#site-logo`
(`logoCss`). Hauteur proportionnelle ×0,75 plafonnée à 64 px sous 48 rem. « Réduit » : l'en-tête reçoit
`data-scrolled` (déjà calculé par `SiteHeader`), la barre et le logo transitent ensemble et la marge basse de
l'en-tête compense exactement la hauteur perdue (pas de décalage ; transitions seulement si
`prefers-reduced-motion: no-preference`). « Déborde » : barre à hauteur fixe, logo aligné en haut. `--header-h`
(ouverture de la page) suit la hauteur réglée. S'applique à `.site-signature` (kit) et, sans logo, au nom du site.
Sur la toile d'édition l'en-tête n'est pas collant : le logo y garde sa taille (la réduction se voit en
« Aperçu exact »).

## Couleurs de la DA du thème et teintes de cartes (lot 19b)

Retour sur la v0.17 : « modifier les couleurs de DA directement dans le web, voir en direct ce qui change quoi, et les ajouter aux
couleurs par défaut des fonds de cartes ».

- **Section « Couleurs de la DA »** (en tête de la page d'un thème) : les six rôles de la 17f (Fond de page, Cartes et encadrés,
  Texte, Boutons et liens, Accent, Ornements), chacun avec sa phrase, survol / focus = éléments surlignés dans l'aperçu, clic =
  ColorPicker (carré saturation × luminosité, bande de teinte, code couleur), lisibilité en direct (avertissement), « Ajuster automatiquement ». C'est le MÊME composant que le panneau du site
  (`ColorsPanel`), en mode `theme` : pas de copie. Le surlignage a été extrait en `components/edit/highlight.tsx`, partagé par la
  toile et le cadre d'aperçu (`PreviewBridge`). Aperçu : accueil ou une page au choix (le thème en essai est conservé).
- **Enregistrement** : thème livré = lecture seule, avec invitation à créer une copie à la première modification (la copie reprend
  les essais sans les enregistrer) ; copie = enregistrement direct ; thème en ligne = confirmation avant de publier. La surcharge
  `styles.palette` du site (17f) reste un mécanisme séparé : l'avis le dit et renvoie à l'éditeur de page.
- **Fonds de cartes** : les six couleurs de la DA nommées, puis huit teintes douces (12 % et 25 % de la couleur dans le fond de
  page) stockées comme jetons (`primary12`…), recalculées à chaque rendu : elles suivent la palette (thème et site).
  Au passage : la légende « utilisé par » d'un rôle survolé ne décale plus la liste (un clic pouvait se perdre).
- Schéma : `SURFACE_TOKENS` passe de 6 à 15 valeurs (zod borné). Les thèmes et pages enregistrés avant restent valides.

## Corbeille et usages (lot 23)

Décision : **supprimer ne détruit plus tout de suite**. `pages`, `projects` et `media` portent `deleted_at` (migration 0024) ; la
ligne et ses fichiers restent 30 jours (`TRASH_DAYS`, `src/lib/trash.ts`), restaurables (toast « Annuler » 10 s, vue Corbeille), puis
`purgeTrash` (`src/lib/edit/trash.ts`, worker : au démarrage puis toutes les 15 min) supprime pour de bon : pages (blocs, surcouches),
projets (emplacements en cascade, médias conservés), médias (ligne, original, variantes, recadrages). Ordre de purge : pages, projets,
médias (ce que les premiers libèrent). Une purge ne casse jamais de lien : un élément encore cité reste à la corbeille.

Intégrité : un élément à la corbeille disparaît de toute lecture publique et des sélecteurs (voir docs/ARCHITECTURE.md pour la liste des filtres) ;
une page à la corbeille est traitée comme une page non publiée, hors menu (`trashed_in_menu` mémorise la place) et sans adresse retenue.
Supprimer reste interdit tant qu'un bloc montre l'élément, que le média est utilisé (bloc, planche, brouillon, élément à la corbeille) :
l'interface le sait d'avance. « Usage » d'un média = `mediaUsageIndex` (une place par emplacement ; par page, type de bloc et média, le plus
grand des deux nombres publié / brouillon) : compteur, détail et blocage lisent le même calcul.

Limite connue : pas de « supprimer définitivement » ni de « vider la corbeille » ; un média de la planche d'un projet à la corbeille
reste « utilisé » jusqu'à la purge du projet.

## Phases

Chaque phase suit le même cycle : build → vérification
indépendante (GO / NO-GO mesuré) → validation visuelle → commit squashé sur `main` + tag
`v0.N` → CI → déploiement Komodo.

0. **Infra** (v0.1.0) : Dockerfile standalone, workflow GHCR, compose hote-prod.
1. **Moteur de thèmes** : tokens → variables à l'exécution, variantes `data-*`, catalogue de
   polices, presets Galerie lumineuse + Pro + direction sombre (test d'acceptation). Choix du
   thème par variable d'env en attendant l'admin.
2. **Données** : SQLite + Drizzle + migrations au démarrage, seed depuis les JSON, pages et
   blocs dynamiques (route `[[...slug]]`), `MediaStorage` + route `/media` avec Range.
   Le site public doit être visuellement identique à avant (captures de comparaison).
3. **Auth + coquille admin** : Better Auth (Authentik + secours mot de passe), protection
   de `/admin` et des server actions, amorçage du premier admin par variables d'env.
4. **Éditeurs** : 4a thèmes, réglages, pages/blocs ; 4b projets/slots avec upload d'images, médiathèque.
5. **Vidéo** : upload, file de jobs ffmpeg, lecteur, bloc `video`.
6. **Création de thèmes** (plus tard) : éditeur complet, import de polices, assets de hero.

## Hors périmètre pour l'instant

Multi-utilisateurs avec rôles, historique des versions de contenu (au-delà du
brouillon unique par page de la phase 7a), HLS adaptatif, CDN.

## Fond de tout texte (lot 21)

**Cause.** Avant le lot 21, la ligne « Fond » n'existait pas dans `TypoControls` : `LookLayer.TextBar` l'ajoutait à part
pour un seul texte, le métier de l'ouverture (`target.isRole`, `data-hero-text="role"`), et le réglage n'était pas un style de
texte mais `look.roleBackdrop` du bloc, rendu par des règles CSS propres à ce métier (`look.css`, `data-role-bd`). Aucune
liste blanche de rôles : les autres textes n'avaient simplement aucun fond dans le modèle (`TextStyleSchema`), et « Tous les X »
n'en avait pas non plus. D'où deux barres qui divergeaient (la capture du « Légende » ouverture, celle de l'étiquette).

**Une définition.** `TextStyleSchema` porte `backdrop` (`none · shadow · band · highlight`) et `backdropColor` (jeton de carte,
teinte douce du lot 19b, ou `#rrggbb[aa]`, même schéma que `SurfaceSchema.color`). Le style local (`look.text[chemin]`) et le style
d'un rôle (`styles.roles[rôle]`) sont le même objet : `textStyleDecls` (pur) en tire les déclarations, inline pour un texte,
feuille `siteStylesCss` pour un rôle (menu : fond sur le lien seul). `src/themes/text-backdrop.ts` (pur) fait le calcul ;
`src/components/edit/BackdropRow.tsx` est la ligne, rendue par `TypoControls` — donc la barre de la toile ET « Styles du site »
du panneau, pour tous les rôles et les deux portées. `BACKDROP_BLOCKED` (look.ts) dirait pourquoi un rôle ne peut pas recevoir
de fond (ligne désactivée + infobulle) ; il est vide aujourd'hui.

**Couleur.** « Auto » (rien d'écrit) = le rendu d'avant, via `--color-*` (suit donc aussi une carte de rubrique). Une couleur
est traduite en variables CSS (`--t-color-*`, teinte = `color-mix(in oklab, …)`), jamais recopiée : le fond suit la palette, la toile
la suit en direct. « Ombre douce » a une couleur dans le code (le halo `--role-shadow` est de la couleur du fond de page) : la
pastille s'y applique, et le halo prend la couleur choisie.

**Lisibilité.** Fond coloré et pas de couleur de texte choisie : le texte prend la couleur que `cardStyle` (lot 17c) choisit,
écrite `color: var(--user-ink, …)` ; le style d'un rôle à couleur choisie publie `--user-ink` dans une règle à part, donc un
fond posé sur un texte précis ne l'écrase pas. Couleur choisie sur le texte lui-même : déclaration `color` après le fond, jamais
remplacée, et `backdropContrast` fait afficher une pastille « ! » (jamais bloquant). La palette (`ctx.palette`, `siteStylesCss(…,
palette)`) n'est lue que si un `backdropColor` existe.

**Réglage d'avant le lot.** `roleBackdrop` reste lu et rendu par les mêmes règles CSS (rendu inchangé). La barre l'affiche comme
le fond de `site.role` et le migre dans `look.text["site.role"]` à la première modification (le champ est retiré). « Surlignage » est un
gros trait de soulignement (`text-decoration-thickness: 1.15em`, `text-underline-offset: -0.88em`, couleur du fond) posé derrière
le texte, ligne par ligne : l'élément garde sa boîte (display, marges, retours à la ligne), sur un titre comme sur un `li`
(`scripts/test-highlight-layout.mjs`, mesuré dans chromium). Limite : pas de marge horizontale autour du texte (le trait suit les
lettres) ; `text-decoration` du texte (lien souligné) est remplacé. Le fond du métier d'avant le lot (`roleBackdrop`, look.css)
garde son rendu en ligne d'avant.

**Fond sur un RÔLE** (feuille globale `siteStylesCss`, qui vise tous les éléments du rôle) : le « Bandeau » n'y passe pas les
éléments en `inline-block` (des paragraphes iraient côte à côte) ; il pose la couleur, `width: fit-content` et un contour
de même couleur (`outline`), sans toucher ni à `display` ni au padding : aucun voisin ne bouge. Le rôle « Corps » pose le fond
(et la couleur de texte lisible) sur `#contenu p` seulement, jamais sur les `li` de structure (réseaux du Profil, cartes
vidéo, pages du CV). Menu et nom du site, éléments en ligne, gardent le bandeau `inline-block`. Mesuré dans
`scripts/test-highlight-layout.mjs`.

## Planche composée (v0.23, lot 31)

Le contenu d'un projet est une SUITE de composants rendue sous l'en-tête de la planche (nom, contexte, présentation) :
« Images qui défilent » (`strip`, la bande d'images du projet, facultative, une seule), Grille (images / vidéos), Image
(pleine largeur comprise), Vidéo, Texte. Module pur : `src/blocks/board-layout.ts` (types, bornes : 12 composants, 24
éléments par grille, `layoutProblem`, `readLayout`).

- **Stockage = le motif des textes du projet** : `projects.layout` (JSON publié ; `null` = jamais réglée = la bande seule,
  rendu d'avant) + surcouche `projects.draft_layout` / `draft_layout_page_id` portée par le brouillon de la page qui AFFICHE
  la planche (migration 0025). Le composant appartient au projet : toute page qui montre sa planche montre la version
  PUBLIÉE ; seule la page qui tient la surcouche voit et modifie le brouillon (l'autre est refusée, la page est nommée).
  Publier la page applique la surcouche (`applyProjectLayoutDrafts`, seulement si la planche est encore affichée), « Abandonner »
  l'efface (`discardProjectLayoutDrafts`), supprimer la page aussi. Un projet créé dans CE brouillon garde sa suite sur sa ligne.
  Choix écarté : mettre la suite dans `pages.draft` (une copie par page, deux pages divergent).
- **Migration 0025** (`src/lib/db/project-layout.ts`) : idempotente, chaque projet sans suite reçoit [Images qui défilent] ;
  rappelée après le seed. Rendu strictement identique (HTML public comparé à v0.22.0 sur six pages).
- **Écriture** (`boards.ts`) : `BoardSnap.layout`, ops `item-add` / `item-move` / `item-remove` / `item-set`, Annuler /
  Rétablir par l'instantané. `src/lib/edit/board-layout.ts` : `checkLayout` (schémas du registre, médias existants / du bon
  genre / hors corbeille ; à la publication, mêmes exigences qu'une rubrique : image choisie, texte d'exemple remplacé).
- **Rendu** : `ProjectBoardBlock` rend les composants (`renderBoardItem` de `BlockList`, `ctx.edit` faux) et les passe à
  `ProjectStrip` (`parts`). Vue brouillon : enveloppes `data-edit-bitem*`, « + Ajouter » (`data-edit-bitem-add`) et barre de
  chaque composant, gérés par `BoardLayer` ; messages `bitem-add` / `bitem-op` / `bitem-select` (champ `item`, `type` est
  l'enveloppe) ; réglages dans le panneau (`BoardItemPanel`, mêmes formulaires que les rubriques).
- **Références** : `layoutMediaIds`, `mediaUsageIndex` (usage `layout`, montré comme une place de la planche) : un média d'une
  grille / image de planche est « utilisé » (publié ou brouillon).
- Limites : pas de glisser-déposer de média sur un composant de la toile (panneau seulement), pas de texte modifiable en place.

### Planche composée, suite (v0.23.1, lot 31b)

- **Plusieurs exemplaires de tout composant.** « Images qui défilent » (`strip`) a deux sources : `props` vides ou
  `source` absent = la bande des images du PROJET (la bande d'origine, légendes, recadrage, emplacements ; au plus une par
  planche, `isProjectStrip`) ; `props: { source: "own", media: [id…] }` = un carrousel à liste propre (images et vidéos de la
  médiathèque, 60 au plus, sans légende), autant qu'on veut. Aucune migration : les planches existantes (`props` vides) restent
  la bande du projet. Rendu : `StripRail.tsx` (code unique des deux, extrait de `ProjectStrip`), `ProjectBoardBlock` lit les médias
  du carrousel (`getMedia` : un média à la corbeille ou supprimé disparaît de l'affichage, sans trou). Références :
  `layoutMediaIds` compte les médias des carrousels ; un média à la corbeille d'un carrousel publié reste bloqué par « utilisé ».
- **Largeur et alignement communs** : `BoardItem.box = { width?: 20–100, align?: left|center|right }`, hors des props du bloc
  (les schémas retirent les clés inconnues) ; UN seul bloc d'interface (`BoxField`, préréglages Petite 33 / Moyenne 50 / Grande 67 /
  Pleine largeur, curseur fin, boutons à icônes). Absent ou 100 % : aucune enveloppe, rendu d'avant au pixel. Réduit : `BoardBox`
  (colonne de `--bw` % du cadre du site, `.board-box` dans `globals.css`, marges de page du composant neutralisées dedans). Sous 640 px
  la colonne reprend toute la largeur (un tiers d'écran ne montre plus rien). Image : la largeur de la planche remplace le choix
  « colonne de texte / cadre / pleine largeur » de l'Image de page (qui reste pour les pages) ; une image « pleine largeur » reste
  pleine largeur du site tant que `box` n'est pas réduit. Carrousel : la bande et ses flèches suivent la colonne.
- **Glisser-déposer** (toile, `BoardLayer`) : la palette « Ajouter » (Grille, Image, Vidéo, Texte, « Images qui défilent ») se dépose
  entre les composants d'une planche (même repère « Déposer ici » que la page ; message `bitem-drop`, `data-board-drop` masque le
  repère de la page) ; un média de l'onglet Médias glissé sur un composant (cible `bitem`, op `item-media`) remplace l'Image / la
  Vidéo, s'ajoute à la Grille / au carrousel — de même au clic sur une vignette quand un composant est choisi ; la poignée de la
  barre réordonne (`bitem-to`, op `item-to`). Tout passe par `boardOp` : Annuler / Rétablir, version de page, refus nommés.

## Marge et coins d un fond (lot 43)

`Background` porte deux champs facultatifs, `inset` et `round` (s / m / l, sur couleur ET papier peint) ; absents = bord à bord, coins droits (aucune migration). Avec `inset`, l enveloppe `.fond-bloc` prend une marge (`data-fond-inset`, 12 / 24 / 48 px, 8 / 14 / 24 sur téléphone), ne fusionne jamais (`fondKey` null) et `round` n a d effet qu avec elle (`data-fond-round`, 10 / 20 / 36 px). Ce qui entoure : `fondAround` / `fondJoins(keys, bgs)` donnent la couleur du voisin bord à bord (avant, sinon après) dans `FondJoin.around`, peinte dans la marge par une ombre pleine (`--fond-around`, `data-fond-around`) ; sans voisin coloré on voit la carte ou la page. La toile recalcule tout dans `refreshFondJoins` (optimistic.ts). Réutilisation (fond d image, planche libre) : lire `fondInset` / `fondRound`, poser `fondAttributes` et passer `join.around` à `fondStyle`.

**Le fond ne rétrécit jamais le contenu (lot 47).** Une marge retire de la largeur à l enveloppe `.fond-bloc` (`margin-inline`) : avant, le contenu (`.shell`, `width: 100%` borné par `--page-max`) rétrécissait dès que le cadre était plus étroit que `--page-max` + 2 marges (toile de l éditeur, portable, tablette). `FondWrap` (et l enveloppe vide de la vue brouillon, `BlockList`) pose donc une couche intérieure `.fond-in` : `display: contents` sans marge, et avec `data-fond-inset` elle reprend la largeur retirée (`margin-inline: calc(-1 * var(--fond-gap))`). Le contenu garde la largeur et la place qu il a sans fond (à 1 px près, mesuré par `scripts/e2e-fond-contenu47.mjs` en page et en planche, à 1440, 1024 et 390 px) ; seule la zone colorée est rognée. Choix : la couche intérieure plutôt qu un `padding` compensé ou un pseudo-élément, parce que la couleur, le papier du kit et le papier peint (`background-color`, `::before`, `::after` de l enveloppe) gardent leur géométrie et leur arrondi sans rien changer. Limites : un contenu qui touche les bords de la page (image pleine page, bande) dépasse de la zone colorée (rognée aux coins arrondis) ; verticalement la marge écarte toujours les voisins. La fenêtre « Fond » est unique (`FondPanel`, `FondMenu.tsx`) pour la page (`FondMenu`) et la planche (`BoardFondMenu`), le rendu aussi (`fondStyle`, `FondWrap`). Ne pas confondre avec la **Carte** de rubrique (`props.surface`, « Pleine largeur / En retrait », « Coins droits / arrondis », bordure, papier ; `SurfaceMenu`), un autre modèle réservé aux blocs de premier niveau.

## Fond de couleur des composants et bordure de carte (lot 32)

Demande de l'illustratrice : « tous les grands composants peuvent avoir une pleine hauteur de couleur dans la carte, deux composants qui
se suivent liés par une seule couleur ». Décision : bord à bord de la carte, sans espace entre deux composants de même couleur.

**Modèle.** Une carte (lot 17c) enveloppe UNE rubrique de premier niveau et n'a aucune marge latérale à l'intérieur : une enveloppe
`.fond-bloc` posée autour du composant (sous la carte) est donc bord à bord ; elle reprend le rembourrage haut / bas de la carte
(marges négatives) pour couvrir toute sa hauteur, et la carte (`overflow: clip` si coins arrondis, bordure) la rogne. Hors carte, la même
enveloppe est une bande pleine largeur de la page (choix simple : pas d'option « masquée », la bande est le comportement attendu d'un fond).
`props.background` est `{ kind: "color", color }` ou, depuis le lot 35, `{ kind: "wallpaper", … }` : l’union discriminée par `kind` accueille le papier peint importé (lot 35) ; l'éditeur
(`FondMenu`, liste `KINDS`), le rendu (`withFond`) et le protocole (`background`) n'ont qu'un cas à ajouter.

**Fusion.** `fondKey(bg, onCard)` identifie un fond ; `fondJoins` rend, pour une suite de frères, `data-join-prev` / `data-join-next` (serveur
dans `BlockList`, y compris pour les enfants d'un conteneur ; toile : `refreshFondJoins`). Le bas de l'enveloppe d'avant est supprimé : l'espace
du haut du composant suivant (déjà dans sa couleur) fait l'écart. Deux cartes de même fond se collent (marge, coins et bordure de jonction
supprimés). Une carte et la page ne fusionnent jamais.

**Lisibilité.** Mêmes règles que les cartes (`cardStyle` : texte du thème ou inverse, filets, liens, boutons, variables `--card-*` posées sur
l'enveloppe et remappées par look.css) ; contraste sous AA : pastille « ! » dans le menu, jamais bloquant.

**Papier du site (lot 28).** Sur une carte à papier « dessus » (carte ou site), le papier est redessiné sur le fond (`.fond-bloc::before`) ; carte
« dessous » : caché. Fond posé sur la page : suit le réglage du site « papier visible sur les cartes ». Limite : la tuile repart du coin de chaque
enveloppe (raccord possible entre deux fonds fusionnés).

**Bordure de carte.** `surface.border` : `false | { width?: thin|medium|thick, color? }`, aussi dans `tokens.layout.card`. Vraie bordure CSS
(2 / 6 / 12 px, 1,5 / 4 / 8 px sous 768 px) : suit les coins, rien ne la décale de façon gênante (la carte n'a pas de marge latérale interne),
le fond s'arrête à son bord intérieur. Couleur par défaut = l'encre lisible de la carte (visible sur tout thème).

**Bordure et fusion (v0.24).** Deux cartes de même fond ne fusionnent que si leur BORDURE est la même : `fondKey(bg, onCard, border)`, signature
`cardBorderSignature` (largeur + couleur calculée, vide sans bordure), lue sur le serveur (`BlockList`) et sur la toile (`refreshFondJoins`, attributs
`data-border` / `--card-bc`). Choix écarté : « la bordure de la première carte entoure tout le groupe » (réglage de la seconde ignoré en silence, copie de
bordure à tenir à jour sur la toile). Avec la règle retenue, ce qu'on voit est ce qu'on a réglé : une seule carte bordée reste une carte à part, un trait ne
s'arrête jamais au raccord.

**Planche composée (v0.24).** `props.background` d'un composant de planche (`BoardItem.props`, bande des images du projet comprise : `source` reste
absent, elle reste la bande du projet) est posé par `ProjectBoardBlock` / `ProjectStrip` avec la même enveloppe que les pages (`FondWrap`, composant sans
état partagé avec `withFond`), AUTOUR de la colonne réglée par `box` (le fond reste bord à bord de la planche), et la même fusion des voisins
(`fondJoins`, `onCard` faux). `renderBoardItem` n'en pose pas lui-même. Palette : `effectivePalette(ctx)` (le JSON de la page ne contient pas les fonds
de la planche). Écriture : op de planche `item-fond` (Annuler / Rétablir, version de page, brouillon du projet) ; bouton « Fond » dans la barre du composant
(`BoardLayer`, message `bitem-fond`, `BoardFondMenu` = la fenêtre `FondMenu` sans aperçu local). Test : `e2e-fond-planche.mjs` (suite `fondplanche24`).

Tests : `test-fond.mjs`, `test-surface.mjs`, `e2e-fond.mjs` (suite `fond32`). Pas de migration (props facultatives).

### Planche composée, finitions (v0.23.2, lot 31c)

- **Texte en place** : un Texte de planche se modifie sur la toile (double-clic, `data-inline` posé par `ctx.inlineEdit` seulement pour ce type, sans les
  autres commandes de page) ; `BoardLayer` poste `bitem-text`, op `item-text` (`setLocalizedAt` sur les réglages du composant), aperçu
  gardé par `previewItemText`. La barre « Aa » (`LookLayer`) reconnaît les composants de planche (`data-edit-bitem`, `data-edit-look`) :
  « Ce texte uniquement » et les styles globaux, écrits par `bitem-look` / op `item-look` dans `props.look` du composant.
- **Fichiers de l'ordinateur** déposés sur une Image, une Grille, un carrousel ou une Vidéo : même envoi que sur un bloc de page
  (`sendAndWait` : envoi, conversion, messages d'erreur), puis `item-media` (Image / Vidéo : remplace ; Grille, carrousel : ajoutent).
- **Au doigt** : la poignée d'un composant (`touch-action: none`) le glisse ; la carte de la palette se glisse par un appui long de 350 ms
  (le panneau défile tant qu'on bouge avant) ; les flèches restent. Le menu « + Ajouter » se replace (au-dessus, ou calé dans la fenêtre).
- **Carte « Images qui défilent »** : un clic l'ajoute SOUS le composant de planche choisi (`item-add` avec `after`), ou à la fin de la planche
  de la rubrique choisie (`board-add` : la toile connaît l'identifiant du projet) ; sinon un message dit où la poser.
- **« N œuvres » : une règle partout** (`workCount`, `gallery.ts`) = les images et vidéos DISTINCTES que la planche montre : les œuvres de la
  bande du projet (si elle y est, filtrées par métier, places vides exclues) + celles des autres composants (grille, image, vidéo, carrousel ;
  prêtes et hors corbeille, chacune une fois). En-tête de la planche, compteurs de page (`boardWorkCount`) et tuiles de collection
  (`countCollection` : les planches des projets qui ont du travail dans ce métier) l'appliquent ; une planche à la bande seule compte comme avant.

## Papiers peints (lot 35)

Demande de l'illustratrice : « importer autant de papiers peints dessinés qu'on veut, sur des fonds transparents ; choisir le papier peint au niveau
de la page, ou pour chaque grand composant (une surcharge) ; au niveau de la carte, comme c'est déjà le cas ». Une entrée « Papiers peints » sous « Thèmes ».

**Stockage.** Table `wallpapers` (migration 0025) + un média ordinaire pour le fichier. Réutiliser la médiathèque garde l'envoi sûr (signature, bornes de pixels, variantes
WebP/AVIF avec transparence, quota, déduplication SHA-256) sans le réécrire ; la ligne ajoute ce qui est propre au motif (nom, taille de tuile et opacité par défaut, corbeille).
Le fichier est caché de la médiathèque (liste, compteurs, sélecteurs) et protégé de la purge tant que la ligne existe. Fermé : JPEG (pas de transparence), GIF, SVG.

**Références.** Toujours par identifiant : fond d'un composant (`props.background`), papier d'une page (`theme_overrides.wallpaper`, brouillon `wallpaper`), papier d'une carte
(`surface.paperWallpaper`), cartes du site (`settings.cardWallpaper`). `wallpaperUsages()` les recense (publié ET brouillons) pour l'avertissement de suppression. Supprimer = corbeille
30 jours ; pendant ce temps (et après la purge) les identifiants restent mais ne résolvent plus : `wallpaperVars(undefined)` est vide, le calque n'a pas d'image, la couleur
dessous (fond) ou l'aplat de la carte reste. Restauré, tout revient.

**Rendu.** Un motif est une image répétée (`background-size: <tuile> auto`), opacité par `opacity` du calque, jamais une couleur. Papier de page : calque `.page-wallpaper`
dans `.site-frame` (z-index -1, isolé) ; il masque le papier du kit (corps, bandes profondes, voile de l'ouverture) pour cette page seulement. Fond de composant : `::after` de
`.fond-bloc[data-wallpaper]` au-dessus de la couleur, même enveloppe bord à bord et même fusion que la couleur (`fondKey` = motif + réglages) ; **raccord de la trame** entre
deux voisins fusionnés par `--wp-y` (côté navigateur, `WallpaperAlign` ; `background-attachment: fixed` a été écarté : la trame ne suivrait plus le défilement). Carte : `::before`
de la carte (motif propre ou celui du site), il passe devant le papier du kit ; un fond de couleur dans la carte le redessine comme le papier du kit (lot 28). Téléphone : tuile ×0,6.

**Lisibilité.** Fond avec couleur dessous : `cardStyle` comme le fond de couleur (lot 32). Sans couleur : encre du thème. Le motif lui-même n'est pas mesuré (avertissement seulement, jamais
bloquant) ; l'opacité d'un papier de carte est plafonnée à 0,6 comme le papier du kit.

Tests : `test-papiers.mjs`, `e2e-papiers.mjs` (suite `papiers35`). Migration SQL 0025 (à renuméroter à l'intégration si besoin).

## Grille unifiée (v0.24, lot 31d)

La grille d'une page et la grille d'une planche de projet sont UN seul modèle, UN seul rendu et UN seul outil sur la toile.
Avant : la grille de planche n'était qu'une liste d'images dans le panneau (rendue sans repère, `ctx.edit` faux) ; on glissait
une image sans voir à quelle place elle irait, et la grille de page savait des choses (changer une image sur la toile, places
vides, barre d'agencement) que la planche ne savait pas.

- **Modèle** (`src/blocks/grid-layouts.ts`, module pur) : agencements prédéfinis `1`, `1+2`, `2`, `3`, `2x2`, `4`, `2+1` (inchangés),
  `portrait-left` et `portrait-right` (la case 1 est le portrait, sur 2 rangées ; le second est le miroir : `direction: rtl` sur la
  grille, `ltr` dans les cases), et `custom` (« Sur mesure », `cols` 2 à 4, `spans[i] = {w: 1..cols, h: 1..2}` dans l'ordre des
  images, `mirror`). Champs facultatifs du schéma de la grille (`gridSchema`) : **aucune migration**, une ancienne grille (page ou
  planche, `projects.layout` / `draft_layout`) se lit et se rend comme avant, au caractère près (aucun attribut ni style ajouté
  pour les anciens agencements). `placeCells` reproduit le placement CSS (vignettes, tests) ; `toCustom` fait passer un agencement
  prédéfini en « Sur mesure » SANS changer la disposition ; `applyGridOp` (fonction pure : réglages, échanger, déplacer, retirer,
  poser une image, taille d'une case, « Adapter aux images ») est LA seule logique d'édition, appelée par la toile, le panneau de
  la page et celui de la planche.
- **Rendu** (`GridBlock` + `globals.css`) : CSS grid. Prédéfinis : règles d'avant (+ portraits : case 1 sur 2 rangées). Sur mesure :
  `--cols`, `--w`, `--h` par case, `grid-column` / `grid-row: span`, `grid-auto-flow: row dense`. Choix « dense » : l'artiste règle
  lui-même les tailles, un trou serait laid ; l'ordre de lecture est celui des numéros affichés sur la toile (pas forcément celui de
  l'écran). Les prédéfinis gardent l'ordre (pas de `dense` : le motif se répète tel quel). Une case sur 2 rangées : l'image la remplit
  (`object-fit: cover`) sans donner sa hauteur à la ligne, ce sont les cases d'une rangée qui la fixent (rien ne se déforme).
  Téléphone (< 48 rem) : 2 colonnes, une case large ou haute prend toute la largeur, plus de rangées doubles. Espace : `none` s'ajoute
  à `tight` / `normal` / `wide` (Aucun, S, M, L).
- **Toile, mêmes repères pour les deux** : `GridBlock` pose `data-edit-grid`, `data-edit-cell` (uid de la case) / `data-cell-index` /
  `data-cell-type`, et les places libres `data-edit-cell-free`, quand `ctx.edit` (page) OU `ctx.gridCanvas` (grille de planche : posé
  par `renderBoardItem`, sans les autres commandes de page). Les composants d'une case (`ImageBlock`, `VideoSingleBlock`) y posent
  leurs repères de média comme sur une page. Tout est absent du HTML public (testé).
- **Calque `GridLayer`** (`src/components/edit/`, monté par `EditLayer`) : barre de la grille (agencement en vignettes, espace, format,
  « + Case », « Adapter aux images », colonnes et inversion en Sur mesure, Fond) quand la grille est choisie (rubrique de page ou
  composant de planche, ou une de ses cases) ; barre d'une case au survol (poignée, numéro, Remplacer, Retirer, Cadrer, Cadre, plus /
  moins large, plus / moins haute) ; numéros des cases ; glisser la poignée sur une autre case les ÉCHANGE (case cible surlignée et
  nommée). Places libres : cadre en pointillé au format des cases, numéro, « + Image » / « + Vidéo » (choix dans la médiathèque, ou
  fichier de l'ordinateur). Dépôt d'un média ou d'un fichier : cible `gcell` (`BoardLayer.dropTargetAt`) = la case visée, ou, sur une
  place libre, la prochaine case libre (une grille se remplit dans l'ordre) ; la case est surlignée avec son numéro.
- **Un seul message** : `grid-op` (`uid`, `board?`, `op`) ; `layout` (ancien) passe par lui. `VisualEditor.gridOp` lit les réglages de la
  grille (brouillon de page, ou dernier instantané de la planche, repli : ce que la toile a lu), applique `applyGridOp`, écrit : page =
  `setBlocks` (historique de la page) ; planche = `boardDo({op: "item-set"})` (instantané, Annuler / Rétablir comme tout le reste).
  `cell-look` : cadre et recadrage d'une case de PLANCHE (la case n'est pas un bloc de la page) ; `sendLook` / `wrapperOf` /
  `cropTargetAt` (LookLayer) reconnaissent `data-edit-cell` dans une planche. « Adapter aux images » lit la forme de chaque image
  dans la médiathèque de l'éditeur (largeur / hauteur), jamais dans le DOM.
- **Panneau** (`GridEditor`, partagé page et planche) : en haut, condensé : agencement (vignettes nommées), espace, format des cases,
  nombre d'images, colonnes / inversion / « Adapter aux images » ; dessous, « Réglages avancés » (alignement, espace au-dessus,
  étiquette, titre). Planche : la liste des cases (`GridContent`) avec Remplacer, ordre, retirer et « Dans la case ».
- Tests : `scripts/test-grille31d.mjs` (modèle, opérations, schéma, anciennes données, messages) et `scripts/e2e-grille31d.mjs`
  (suite `grille31d`).

### Retouches de la grille (lot 31e)

Retours de l'illustratrice sur la v0.24 : la barre de grille noire s'ouvrait toute seule en plus de la barre du bloc, la barre d'une
case tombait en bas d'une case bien plus haute que l'image, et un décor très large restait dans une colonne.

- **Fenêtre « Réglages » blanche** (`GridSettings`, dans `GridLayer.tsx`) : remplace la barre de grille. Rien ne s'ouvre tout seul ;
  le bouton « Réglages » de la barre du bloc grille (`.pe-tools` d'une rubrique de page, `.pe-bitem-bar` d'un composant de planche)
  envoie l'événement `pe:grid-settings` (`{uid, board?}`, bascule) et `GridLayer` pose la fenêtre sous cette barre, à son bord droit,
  dans l'écran. Style de la fenêtre « Aa » : classes `sm tc`, tokens `--lk-*` (aucune couleur propre), bouton ✕, choix actif en bleu
  clair. Contenu : vignettes d'agencement, espace Aucun / S / M / L, format des cases, Colonnes (+ Inverser en Sur mesure), « + Case »,
  « Adapter aux images » (absent en Automatique : c'est ce que l'automatique fait déjà), « Plus de réglages… » (événement
  `pe:open-panel` : `EditLayer` / `BoardLayer` choisissent la grille comme un clic, le panneau de gauche s'ouvre). Fermeture : ✕,
  Échap, clic ailleurs (`useDismiss`, le bouton `data-grid-settings-button` bascule). Une seule fenêtre à la fois : ouvrir Réglages
  envoie `pe:popups-close` (Carte, Fond, Cadre, barre « Aa » se ferment) ; les autres se ferment déjà d'un clic ailleurs.
- **Barre de case** : blanche (même famille que « Aa »), accrochée à l'image ou à la vidéo elle-même (`cellBarTop`) : 36 px sous le
  bord haut de l'image (sous le fil d'Ariane), dans la partie visible de l'écran ; une image trop basse pour la porter : juste
  dessous. Le menu « Taille » est un frère de la barre (et non son enfant) : la barre a un `transform`, qui devient le repère des
  coordonnées d'un enfant absolu, d'où un menu hors écran (bug de la v0.24 : le bouton « Taille » semblait ne rien faire).
- **« Automatique » (`auto`)** : nouvel agencement, par défaut des nouvelles grilles (registre : `defaults`, `newBoardItem`) ; les
  grilles existantes gardent le leur (pas de migration). La taille de chaque case suit le format réel de son média, CALCULÉ AU RENDU :
  panorama (≥ 1,9) sur toute la largeur, portrait (≤ 0,8) sur 2 rangées, sinon 1 case ; 2 colonnes par défaut (2 à 4) ; une place vide
  compte comme une case normale. `GridBlock` (devenu asynchrone) lit la largeur et la hauteur de chaque média (`getMedia`, même repli
  qu'à l'édition : vidéo sans dimensions = 16:9) et passe `ratios` à `gridCells` (jamais stocké : un ajout, un remplacement, un retrait
  recalculent). Rendu CSS = celui du Sur mesure (`:is([data-layout="custom"], [data-layout="auto"])`). Changer la taille d'une case ou
  inverser passe en Sur mesure à partir de la disposition calculée (`toCustom` / `applyGridOp` reçoivent les formats de la médiathèque
  de l'éditeur : aucun saut). Les images d'une case de panorama n'utilisent qu'une colonne pour le choix de la variante
  (`ctx.cellAuto`).
- **Format Libre** : une place vide ne force plus une hauteur 4:3 à côté d'un panorama (`min-height: 11rem`, étirée à la hauteur de
  la rangée).
- Tests : `grille31d` (sections H, I, K ; le menu « Taille » se clique à la souris sur les coordonnées réelles, bouton et choix
  visibles à l'écran) et `scripts/test-grille31d.mjs` (1h à 1j, 2z).

## Lecteur vidéo : Boucle ou Lecteur (lot 36)

Avant ce lot une vidéo hébergée jouait dans la page (lecteur en ligne), et seule une animation courte et muette d'une bande tournait en boucle.
Désormais chaque vidéo a une lecture choisie par l'illustratrice :

- **Boucle** : la vidéo tourne en boucle, muette, dans la page ; un clic ou un toucher la met en pause, un autre la relance ; Espace et Entrée au
  clavier (le cadre est un bouton nommé) ; petit repère pause / lecture ; avec `prefers-reduced-motion` elle démarre en pause.
- **Lecteur** : la page montre l'image d'attente avec un bouton lecture ; un clic ouvre la vidéo en grand (`VideoViewer`, dialogue modal
  posé dans `<body>`, fond `--color-viewer`) avec le lecteur maison (`VideoPlayer` : lecture / pause, ± 10 s, barre cliquable et glissable,
  temps écoulé et durée, son et volume, plein écran). Fermeture par ×, Échap ou clic hors de la vidéo ; clavier Espace, ← / →, M, F ;
  focus piégé puis rendu au déclencheur. Sur téléphone la barre passe sur deux rangées et le volume est masqué (celui de l'appareil).

Données : `mode` (`loop` | `player`) sur le composant Vidéo ; `videoMode` facultatif sur une bande (absent : chaque vidéo suit sa nature).
Le choix se fait dans le panneau et dans la barre de la vidéo, de la case de grille, du composant ou de la bande de planche (message
`video-mode`, opération de grille `video-mode`). Parité : le rendu serveur est le même sur la toile et en ligne (`data-video-mode`), la
toile n'ouvre jamais la visionneuse. Migration de contenu 0027 : voir `src/lib/db/video-mode.ts` (mode explicite sur chaque vidéo existante,
publié et brouillons, planches et leurs brouillons).

## Un seul carrousel (lot 31f)

Pour l'artiste, il n'y a qu'UN composant « Images qui défilent » : même nom partout (palette, barre, panneau, menu « + Ajouter »),
même rendu, mêmes outils par image sur la toile. Le nom « Images du projet » a disparu de l'interface.

- **Pourquoi la bande du projet avait des outils et pas le carrousel (31b).** Les outils par image (Remplacer, Supprimer, Retirer la
  place, Arrondi, Cadre, glisser, places vides) de `BoardLayer` sont pilotés par les repères `data-edit-rail` / `data-edit-slot`, posés
  seulement sur la bande des images du projet, et leurs messages (`slot-op`, `slot-move`, `files`) visent un EMPLACEMENT du projet (clé
  `s12` / `k…`, opérations `move|remove|retire|fill|add` de `boards.ts`). Le carrousel à liste propre n'avait ni repère ni message.
- **Choix des données : (a), pas de migration.** La source reste distinguée en interne (`isProjectStrip` : images du PROJET, dont les
  emplacements servent aussi aux tuiles de collection, à la couverture, au compteur, à la visionneuse et au filtrage par métier ; ou
  `source: "own"` + `media`). Une migration (b) aurait copié les emplacements du projet dans une liste de la planche : les deux copies
  divergeraient, et tuiles, couverture et compteur lisent les emplacements. Seuls l'outillage et le rendu convergent.
- **Une seule bande côté rendu et côté toile.** `StripRail` pose `data-edit-rail` (vide = images du projet, sinon l'uid du carrousel) et
  `data-edit-slot` sur toute image ; `BoardItemFrame` pose `data-edit-bitem-rail` sur toute bande (`-project` : la bande d'origine seule).
  `BoardLayer` n'a qu'un code : barre de l'image (même composant `SlotRadius`, `SlotFrame`), glisser, clavier, fantômes d'envoi, dépôt.
- **Places d'un carrousel.** `media: (number | null)[]` : `null` = place gardée vide (comme un emplacement vide du projet ; masquée en
  public, ignorée du compteur, des références et de `itemEmpty`). Clé d'une place sur la toile : `<uid>.<rang>` (`railKey`,
  `parseRailKey`). Le schéma `SlotKey` des messages l'accepte ; l'éditeur traduit le geste (`slotBoardOp`) en opération `rail-clear`,
  `rail-retire`, `rail-fill`, `rail-move`, `rail-add` (`boards.ts`, surcouche de suite : mêmes gardes que `item-*`). Cible de dépôt `rail`
  (`board`, `uid`, `index`) ; fantôme d'envoi avec `rail`.
- **Arrondi et cadre** : `look.slotRadius` / `slotFrame` du bloc, par slug de place ; pour un carrousel le slug est `<uid>-<média>`, donc
  deux carrousels qui montrent le même média se règlent chacun.
- **Pas de légendes** sur un carrousel (un média n'a ni titre ni année) ; les images du projet gardent les leurs. Pas de « Cadrer » sur
  une place de bande : le recadrage libre concerne les tuiles et les images seules, pas les bandes (aucun changement).
- Tests : `scripts/test-carrousel31f.mjs` (unité, base réelle) et `scripts/e2e-carrousel31f.mjs` (suite `carrousel31f`, souris réelle).

Lot 38 : une bande n'a plus de réglage de lecture commun (ni sur sa barre ni dans le panneau). Chaque vidéo d'un carrousel se règle sur sa propre
barre (Boucle / Lecteur), écrit dans `look.slotVideo` du bloc planche, par emplacement (slug), à côté de `slotRadius` et `slotFrame`. Ordre de
lecture au rendu (`StripRail`) : le choix de la vidéo, puis l'ancien `videoMode` de la bande (toujours lu, jamais migré, donc les pages existantes ne
changent pas), puis la nature de la vidéo. Sur la toile, « Réglages » ne reste que sur la grille (il ouvre une fenêtre) ; ailleurs le nom du
composant, sur sa barre, le choisit et ouvre son panneau. Le seed place une vidéo de test dans la médiathèque (`seed/media/video-de-test.mp4`).
