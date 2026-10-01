# Architecture — Portfolio + CMS

Document de cadrage de la refonte « CMS ». Il fixe les décisions d'architecture ;
chaque phase s'y réfère. Toute déviation se discute et met ce fichier à jour.

## Décisions actées (2026-09-30)

| Sujet | Décision |
|---|---|
| Build & distribution | GitHub (repo privé `Themlaw/portfolio`) → Actions → `ghcr.io/themlaw/portfolio` (privé) |
| Prod | hote-prod, stack Komodo, `pull_policy: always`, réseau `traefik` partagé avec Newt, aucun port publié |
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

Polices : catalogue fini déclaré avec `next/font` (auto-hébergé, sans CLS). Un thème
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
  le rendu). Les tuiles de collection portent leurs propres textes (dupliqués depuis
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

Multi-utilisateurs avec rôles, historique des versions de contenu, brouillons par page,
HLS adaptatif, CDN.
