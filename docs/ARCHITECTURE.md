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
  tmpfs), SHA-256 au fil de l'eau, plafond `MAX_IMAGE_MB` (40) appliqué pendant le flux.
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
  - côté de plus de 16 384 px refusé dès l'en-tête ; décodage borné à une boîte de
    2400 × 2400 (`fit: inside`, réduction au décodage JPEG/WebP), sortie 8 bits sRGB ;
    variantes en boîtes carrées (`img/<hash>/<boîte>.<format>`). Pics mesurés (VmHWM du
    serveur, `test:auth` section F) : JPEG 6000×4000 +146 Mo, PNG 2400×16000 +15 Mo,
    PNG 16 bits 8000×8000 +237 Mo, 16384×16384 refusé (> 100 MP) sans décodage ;
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
  par glisser) selon `data-at-start` / `data-at-end` / `data-overflows`
  écrits sur le DOM dans un rAF, sans rendu React. Jetons `--strip-nav-*`.
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
plus (Projet mis en avant › Grille › Vidéo), 24 composants par conteneur,
uid obligatoires et uniques dans toute la page. Conteneurs livrés :
« Projet mis en avant » (`featured-project` : projet transmis aux
composants, lien « voir plus ») et « Grille » (`grid` : agencement par
motif répété `1`, `1+2`, `2`, `3`, `2x2`, `4`, `2+1` ; espacement, alignement,
ratio des images ; classes `.block-grid` de `globals.css`, tokens du thème).
Composants simples : Titre (`section-title`, peut reprendre le nom et la
présentation du projet du conteneur), Planche d'un projet, Image, Texte,
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
  conteneur voisin) au clavier ; fil d'Ariane « Projet mis en avant › Titre »
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

**Formulaire de contact** (bloc `contact-form`, `src/lib/contact-form.ts`,
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
  + zoom), fond du métier de l'ouverture (`roleBackdrop`).
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
  Échap annule. Langue = celle de la toile (fr / en).
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
