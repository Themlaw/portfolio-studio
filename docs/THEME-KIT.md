# Kit de thème PSD — spécification, preuve de concept (6b) et produit (6c–6d)

Parcours visé : l'artiste ajuste un thème dans l'app, télécharge un **kit PSD
pré-rempli** (assets actuels, sinon aplats aux couleurs du thème), peint les
calques qui l'intéressent, redépose le PSD ; chaque calque est validé, converti
dans le format le plus léger, et devient un asset du thème.

Prototype de la phase 6b (devenu le produit en 6d, section 7) : `src/lib/kit/`, scripts `scripts/kit-poc/`,
captures `screenshots/kit-poc/`. Outils : ag-psd (MIT), @neplex/vectorizer
(vtracer, MIT), SVGO (MIT), sharp, thumbhash (MIT), node-vibrant (paquets
`@vibrant/*` sans le chargeur jimp ; pixels fournis par sharp). Pas de potrace (GPL).

## 1. Document et emplacements (kit v1, phase 6b ; kit v2 : section 7)

Un seul document **2880 × 2560 px, RVB 8 bits/couche** :

- en haut (y 0–1600), le **hero** : 5 plans pleine largeur ;
- en dessous, une planche d'emplacements, chacun dans son **cadre** (repéré dans
  `_guides`) : ce qui dépasse du cadre est coupé à l'import.

Noms : comparés **sans casse, sans accents ; espaces, tirets et soulignés
équivalents** (« Héro / Plan 3 » = `hero/plan-3`, « Icônes / Flèche gauche » =
`icones/fleche-gauche`). Un calque inconnu est ignoré et signalé. Le groupe
`_guides` (verrouillé) et le calque `LISEZ-MOI` sont ignorés à l'import.

| Emplacement | Calque attendu | Cadre (x, y, l × h) | Transparence | Rendu | Règles |
|---|---|---|---|---|---|
| Plan 1 (ciel) | `hero/plan-1` | 0, 0, 2880 × 1600 | permise | bitmap si texture, sinon SVG | rogné à sa boîte non transparente |
| Plans 2 à 5 | `hero/plan-2` … `plan-5` | 0, 0, 2880 × 1600 | **exigée** | SVG ou AVIF | hauteur utile depuis le bas : 900, 760, 560, 380 px ; un plan opaque à 98 % est refusé ; un décor qui monte au-delà de la hauteur utile (+40 px) est signalé (titre) |
| Signature | `signature` | 80, 1720, 1200 × 300 | exigée | masque SVG | une couleur (sinon : forme seule, teinte du thème) |
| Papier | `papier` | 1400, 1720, 512 × 512 | **opaque** | bitmap (AVIF + WebP) | raccord mesuré (bords opposés contre intérieur) ; répétition visible : autocorrélation à 1/2, 1/3, 1/4 de la période sur la luminance réduite à 128 px, avertissement « la tuile se répète de façon visible » si > 0,5 et contraste > 1,5 niveau (grain : ~0,1 ; vichy du fixture A : 0,96) |
| Cadre | `cadre` | 2000, 1720, 300 × 300 | permise | SVG ou AVIF, `border-image` | 9 parties (lot 58) : marges 48 px (guides Photoshop), coins fixes, côtés répétés (round) ; option B : coin + côté tournés ; pas rogné |
| Trait | `trait` | 80, 2100, 1200 × 80 | exigée | masque SVG | soulignement étirable, une couleur |
| Icônes | `icones/fleche-gauche`, `fleche-droite`, `fermer`, `lecture` | 128 × 128 chacune (2400–2688, 1720–2008) | exigée | masque SVG | une couleur |
| Scotch | `accessoires/scotch` | 2000, 2100, 400 × 160 | permise | SVG ou AVIF | transparence partielle → bitmap |

Zone du titre du hero : x 240, y 420, 1260 × 560 (le décor y reste calme).
`LISEZ-MOI` (5 lignes, dans le PSD) : peindre dans les calques existants sans les
renommer ni les déplacer ; pixelliser effets, objets dynamiques et textes ; rester
en RVB 8 bits sans redimensionner ; laisser transparents les plans 2 à 5 au-dessus
de leur hauteur utile ; `_guides` ignoré.

## 2. Import : règles

1. **Avant tout décodage** (`psd-header.ts`, quelques Ko lus par position) :
   taille ≤ 300 Mo, PSD (pas PSB), RVB, 8 bits, 2880 × 2560, ≤ 60 calques,
   **surface déclarée des calques ≤ 4 documents (29,5 Mpx)**. Refus en français
   avec le geste à faire.
2. Lecture ag-psd en `useRawData` (pixels encore compressés), puis **phase 1** :
   chaque emplacement est décodé seul (`getLayerImageData`), placé dans son cadre,
   rogné, mis de côté (RVBA brut sur disque) ; avertissements : calque absent
   (l'asset actuel reste), masqué, **effets de calque** / **objet dynamique** /
   texte (« pixellise ce calque »), opacité < 100 %, pixels hors cadre, calque
   vide (✗), plan opaque (✗), transparence attendue ou non.
3. **Libération du PSD** (toutes les `rawData`, puis GC), puis **phase 2** :
   encodage emplacement par emplacement :
   - aplat d'une couleur (≥ 97 % des pixels) : forme tracée sur l'alpha (vtracer
     binaire) remplie de la couleur dominante ;
   - plusieurs couleurs nettes : vtracer couleur sur alpha binarisé, puis SVGO
     (`removeScripts`) ;
   - texture, grain, dégradé (8 couleurs dominantes < 90 % des pixels), tuile,
     transparence partielle : bitmap AVIF (q50, effort 4) + repli WebP ;
   - formes d'une couleur (signature, trait, icônes) : **masque SVG** ;
   - SVG retenu s'il pèse ≤ 1,5 × l'AVIF et compte ≤ 500 chemins ;
   - ThumbHash par plan ; palette suggérée (rôles de tokens, contraste encre/fond).
4. Sortie : `rapport.json` (✓ / ⚠ / ✗ et raisons par emplacement) + fichiers.

## 3. Mesures (VM de dev, Node 24, 2026-10-01)

### Jeux de test (générés, légitimes)

| PSD | Contenu | Taille | Génération |
|---|---|---|---|
| Kit exporté (galerie-lumineuse) | 5 plans rastérisés depuis les SVG du thème, 9 formes, guides, LISEZ-MOI, composite | **5,1 Mo** | 1,1 s, pic 354 Mo |
| A « réaliste » | 4 plans en aplats aux bords tremblés, ciel peint (grain + dégradé), papier raccordable, cadre, icônes, trait épais irrégulier, ombre portée déclarée, noms libres, calque inconnu | 15,9 Mo | 0,7 s, 291 Mo |
| B « lourd » | A + 7 brouillons pleine toile (bruit) | **165,6 Mo** | 4,5 s, 964 Mo |

### Mémoire de l'import (VmHWM du processus)

| Cas | Pic |
|---|---|
| ag-psd, tous les calques décodés d'un coup — A | 222 Mo |
| ag-psd, tous les calques décodés d'un coup — B | 575 Mo |
| Import naïf (un processus, malloc par défaut) — A | 706–782 Mo, 23 s |
| Import final — A | **521–528 Mo**, 10,5 s |
| Import final — B, limites levées pour mesurer | **491–503 Mo**, 10,8 s |
| B avec les limites par défaut | refusé avant décodage (76 Mpx > 29,5), 0,9 s, 121 Mo |

- **ag-psd charge tout le fichier en mémoire** (`readPsd` prend un tampon) : après
  lecture, le pic vaut ~120 Mo (Node + modules) + la taille du PSD (B : 283 Mo).
  Décoder un calque à la fois (`useRawData`) évite d'empiler les calques décodés.
- **Piège mesuré** : une variable de boucle restée dans le cadre suspendu de la
  fonction async retenait un calque ignoré, donc tout le PSD (heap snapshot) ;
  corrigé en effaçant les `rawData` de tous les calques avant la phase 2.
- `MALLOC_ARENA_MAX=2` et `MALLOC_MMAP_THRESHOLD_=131072` : −180 à −260 Mo et
  temps divisé par 2 (les gros tampons libérés reviennent au système).
- **Le pic restant (~+380 Mo) est l'AVIF effort 4 d'un plan texturé
  2880 × 1600** ; il est borné par la spec (aucun calque plus grand), donc
  indépendant de la taille du PSD.

### Temps par emplacement (A)

Plan texturé (AVIF effort 4) 4,6 s ; plans en aplat 0,8–1,5 s ; signature 0,3 s ;
papier 0,2 s ; cadre 0,15 s ; trait 0,2 s ; icônes ~50 ms ; scotch 90 ms.
Lecture ag-psd : 20–30 ms (A), ~200 ms (B). Total ~10,5 s.

### Poids de sortie (A)

| Emplacement | SVG | AVIF | WebP | Retenu |
|---|---|---|---|---|
| Plan 1 (ciel peint) | — | 55,8 Ko | 623 Ko | AVIF |
| Plans 2–5 (aplats) | 3,4–3,7 Ko (1 chemin) | 7,4–9,3 Ko | 8,0–11,4 Ko | SVG |
| Signature | 3,9 Ko | 8,2 Ko | 9,7 Ko | masque SVG |
| Papier 512² | — | 1,5 Ko | 3,7 Ko | AVIF (raccord : écart aux bords / intérieur = 0,93) |
| Cadre | 2,3 Ko | 2,9 Ko | 3,9 Ko | SVG |
| Trait | 2,8 Ko | 3,6 Ko | 4,6 Ko | masque SVG |
| Icônes | 0,3–0,6 Ko | ~1 Ko | ~0,8 Ko | masque SVG |
| Scotch (translucide) | — | 1,8 Ko | 2,1 Ko | AVIF |

**Premier affichage (hero + signature + papier) : 75 Ko**, pour un budget de
150–250 Ko ; kit complet : 84 Ko.

**Grain** : à q50/effort 4, l'AVIF du ciel ne fait que 56 Ko parce que l'encodeur
**efface le grain** (captures `plan-texture*`) ; le garder coûte 452 Ko (q60) à
792 Ko (q70). Un grain fin peint dans un plan pleine largeur ne tient pas le
budget : le grain doit venir d'une **tuile superposée** (le papier, ~2 Ko).

### Qualité (captures `screenshots/kit-poc/`, avant à gauche, après à droite)

- `plan-aplats*` : aplat tracé net, sans liseré (la première version, en tracé
  couleur sur l'alpha antialiasé, laissait des éclats pâles le long du bord) ;
  le tremblement le plus fin (± 2 px) est un peu lissé.
- `trait*`, `signature`, `icone-*` : formes fidèles, servies en masque (teinte
  du thème). `icone-fermer-effet` : l'ombre portée déclarée n'est pas rendue
  (ag-psd lit les pixels du calque, pas les effets) → avertissement.
- `plan-texture*` : dégradé fidèle, grain lissé (voir plus haut).
- `scotch-transparence` : transparence partielle conservée (bitmap).

### Aller-retour et compatibilité

- Le kit exporté se relit avec ag-psd : 2880 × 2560, RVB 8 bits, les 14
  emplacements trouvés, 5 guides Photoshop, `_guides` verrouillé, image
  composite présente. **Non testable ici : l'ouverture dans Photoshop.**
- **Image distroless** : `@neplex/vectorizer` (binaire napi-rs glibc 14,6 Mo, ne
  dépend que de libc, libm, libgcc_s, libpthread, libdl, librt, toutes présentes),
  thumbhash, ag-psd, SVGO, `@vibrant/*` et l'AVIF de sharp fonctionnent dans
  `gcr.io/distroless/nodejs24-debian13`, en 1000:1000, `--read-only`, sans shell
  (505 ms). Paquets sans script d'installation (`npm ci --ignore-scripts` OK).
- **Polices** : le LISEZ-MOI et les libellés des guides sont rastérisés par sharp
  (SVG `<text>`), ce qui exige une police système : la VM en a, l'image distroless
  non. En production : embarquer une police (fichier) ou dessiner ces textes en
  chemins.

## 4. Limites à imposer

- Fichier ≤ 300 Mo ; PSD seulement ; RVB 8 bits ; 2880 × 2560 ; ≤ 60 calques ;
  surface déclarée ≤ 29,5 Mpx (4 documents) : vérifiés **avant décodage**.
- Import dans un **processus enfant** (comme ffmpeg) lancé avec
  `node --expose-gc`, `MALLOC_ARENA_MAX=2`, `MALLOC_MMAP_THRESHOLD_=131072` : pic
  mesuré ≤ 530 Mo, à ajouter au serveur (~250 Mo) → ~780 Mo dans le conteneur
  de 1 Go. **Jamais en même temps qu'une conversion vidéo** (ffmpeg jusqu'à
  413 Mo) : file de jobs commune, exclusive.
- Pour un pic sous 600 Mo même au plafond de 300 Mo : la phase 1 vaut ~120 Mo +
  taille du PSD (≤ 420 Mo), la phase 2 ≤ 530 Mo.

## 5. Recommandations pour la construction

1. **Export** (admin, page du thème) : bouton « Télécharger le kit » (PSD généré à
   la demande, ~5 Mo, ~1 s, mis en cache par version du thème) ; ajouter un
   fichier de police au LISEZ-MOI. Faire **valider l'ouverture dans Photoshop par
   l'artiste** (calques nommés, guides, `_guides` verrouillé, composite).
2. **Import** : envoi par morceaux existant → job `kit` (processus enfant,
   exclusif avec la vidéo) → écran de revue : par emplacement ✓/⚠/✗, avant/après,
   format retenu et poids, puis « Appliquer au thème » (brouillon, aperçu en
   direct) — rien n'est remplacé sans validation.
3. **Moteur de thèmes** : étendre `assets` du thème (chemins validés) :
   `heroLayers` (SVG ou AVIF + WebP + ThumbHash en fond pendant le chargement),
   `signature`, `trait`, icônes en **`mask-image`** teintés par les tokens,
   `cadre` en **`border-image`** (marges 48 px dans la spec), `papier` en
   `background-image` répété (et superposé au hero pour le grain), `scotch` en
   image positionnée.
4. **Palette** : la proposition (rôles + contraste) est utile comme point de
   départ, mais le fond suggéré vient des plans (ici #acb4cc, trop soutenu pour un
   fond de page) : la présenter comme suggestion à ajuster dans l'éditeur de
   thème, contraste AA vérifié par `contrast.ts`.
5. Garder le contrôle « avant décodage », les avertissements « pixellise ce
   calque », et documenter le grain (tuile plutôt que plan).

## 6. Phase 6c — le moteur de thèmes utilise les éléments dessinés

### Données et rendu

`Theme.assets.kit` (zod, tout facultatif) : `plans` (5, `null` = calque SVG actuel
du thème), `signature`, `paper` (+ `overHero`, opacité sur le hero), `frame`
(+ `slice`), `stroke`, `icons` (`arrowLeft`, `arrowRight`, `close`, `play`), `tape`.
Chaque asset : `svg`, ou `avif` + `webp`, sous `/media/kit/<hash16>.<ext>`
(contenu adressé, servi par la route `/media` avec les en-têtes des médias),
taille, ThumbHash ; un plan a en plus sa position dans la toile 2880 × 1600.

Aucune logique de thème dans les composants : `css.ts` émet des variables
`--t-kit-*` et des attributs `data-kit-*` **seulement pour les assets présents** ;
`variants.css` s'y accroche. Sans kit : aucune variable ni aucun attribut de plus
(parité au pixel avec v0.8.0 : 32/32, et `scripts/test-theme-kit.mjs`).

| Emplacement | Rendu | Repli |
|---|---|---|
| Plans du hero | `<img>` SVG ou `<picture>` AVIF/WebP, rognés et replacés dans la toile tenue en « cover » (unités `cq*`), ThumbHash en fond jusqu'au chargement, plans opaques seulement (sur un plan détouré, l'alpha flouté déborde et dessine la boîte : bande claire, phase 6c) ; `complete` lu au montage (image chargée avant l'hydratation) ; test `npm run test:kit-hero` ; plan 1 `fetchpriority="high"`, les autres `low` ; parallaxe et `prefers-reduced-motion` inchangés | plan par plan : le calque SVG du thème |
| Signature | `mask-image` teinté `--color-ink` (`--color-primary` au survol), ratio de l'asset ; le nom reste lu (texte masqué visuellement) | le nom en texte |
| Papier | tuile `image-set()` AVIF/WebP en fond (affichée à 50 % : tuile 2×) ; superposée au hero (`mix-blend-mode: multiply`, opacité `overHero`, jeton `--t-kit-paper-hero`, défaut discret 0,35, plafond 0,6) ; **pas sous le bandeau du haut** (lot 17a) : `.site-header` reste un aplat `--color-bg` sauf option de thème `paper.underHeader` (`data-kit-paper-header`, case « Papier sous le bandeau du haut » de l'éditeur) | `texture` du thème |
| Cadre | `border-image` (9-slice, marges du kit) sur les entrées de collection (`.tile-media`, tuiles de l'accueil) ; plus sur la visionneuse depuis le lot médias (image agrandie posée à nu, fond gris neutre) | passe-partout actuel |
| Trait | `mask-image` étiré (SVG du trait en `preserveAspectRatio="none"` à l'import : sinon il garde ses proportions au centre de la boîte) : soulignement actif de la nav (`--color-primary`), filets `hr.rule` (`--color-line`), barre du rail : poignée 16 px de longueur proportionnelle (≥ 3 px d'encre au plus mince, mesuré par `kit-contrast.mjs`), piste dessinée en `::before` (un masque sur la piste rognerait la poignée) teinte encre 28 % sur filet | traits CSS |
| Icônes | `mask-image` + `currentColor` sur les `[data-icon]` (flèches sur les bords des planches (lot médias) et de la visionneuse, fermer, lecture) | glyphes et SVG actuels |
| Scotch | image à la place du scotch CSS de la variante `taped` | scotch CSS |

### Fidélité du contour

Mesure : masques alpha (> 50 %) de l'original et du SVG rendu à la résolution
réelle ; **écart moyen du bord** = pixels différents / longueur du contour d'origine
(px), IoU indicatif. Plans en aplat de kit-A :

| Réglage | Écart | SVG |
|---|---|---|
| PoC (tracé réduit à 1920 px) | 0,70–1,03 px | 3,4–3,7 Ko |
| réglages vtracer plus fins, même réduction | 0,71–1,00 px | 2,8–3,9 Ko |
| **pleine résolution, polygone (retenu pour les aplats)** | **0,53–0,56 px** | **1,4–1,5 Ko** |
| pleine résolution, spline fine (retenue pour masques et couleurs) | 0,52–0,54 px | 3,6–4,0 Ko |
| AVIF (référence) | 0,02 px | 7,2–9,3 Ko |

Ce sont la réduction avant tracé, plus que les réglages, qui lissaient le tremblé.
**Seuil retenu : écart ≤ 0,6 px**, sinon l'AVIF (ou un masque bitmap) est gardé
même si le SVG est plus léger. L'IoU n'est pas un critère : sur une forme fine
(trait, icône), 0,5 px d'écart la fait tomber à 0,93 sans défaut visible.
Résultat kit-A : tous les emplacements tracés passent (0,44–0,59 px) ; premier
affichage 67 Ko (contre 75), kit complet 74 Ko, pic d'import 530 Mo. Captures :
`screenshots/kit-poc2/`.

### Export du kit (admin)

- Bouton « Télécharger le kit Photoshop » dans l'éditeur de thème et la liste des
  thèmes. `POST /admin/api/theme-kit/<id>` (assertAdmin, même origine) : prêt, ou
  mis en file ; `GET` : le PSD en pièce jointe. Le kit part de l'**état
  enregistré** ; version = empreinte du thème ; cache
  `${DATA_DIR}/cache/kits/<id>-<version>-v<format>.psd`, purgé à l'enregistrement et à la
  suppression du thème.
- **File lourde** (`jobs.kind` « video » ou « kit », un seul à la fois ; les images
  gardent leur file) : un export demandé pendant une conversion attend sa fin
  (test:auth TK7). Migration 0009 (`jobs.media_id` facultatif, `jobs.payload`).
- **Processus enfant** : bundle esbuild `kit-child.cjs` à la racine du
  standalone (généré par `npm run build`), sous `nice`, avec `MALLOC_ARENA_MAX=2`,
  `MALLOC_MMAP_THRESHOLD_` et un environnement minimal (aucun secret) ; en dev,
  la source via tsx. Mesuré en production : 0,8–0,9 s, **pic 296 Mo**, 5,1 Mo.
- **Police embarquée** : `public/kit/Figtree.ttf` (OFL, `OFL-Figtree.txt`),
  rendue par sharp (Pango) depuis le fichier, avec `public/kit/fonts.conf`
  (cache dans `/tmp`) : vérifié dans l'image distroless sans aucune police système.
- Le LISEZ-MOI reprend les leçons de la PoC (pixelliser, RVB 8 bits, ne pas
  renommer, **grain dans « papier » et non dans les plans**, aplats).

### Mesures (thème de test « kit-a », production, premier affichage de /fr)

| Thème | Total | dont images | HTML | LCP 1440 / 390 | CLS |
|---|---|---|---|---|---|
| galerie-lumineuse | 390 Ko | 25 Ko | 11 Ko | 268 ms (titre) / 136 ms | 0 |
| kit-a | 468 Ko | 93 Ko (dont ciel AVIF 55 Ko, 4 plans SVG 8 Ko, papier, signature, trait, scotch) | 21 Ko | 352 ms (ciel) / 160 ms | 0 |

Le HTML grossit de ~10 Ko (placeholders ThumbHash en data URL, variables du
kit). Contraste au pixel des éléments teintés (seuil 3:1, éléments graphiques) :
signature 13,1:1, soulignement 6,7:1, flèche du rail 4,5:1, barre du rail 7,0:1,
fermer 11,4:1, flèche de la visionneuse 7,5:1, lecture 6,5:1
(`scripts/kit-poc/kit-contrast.mjs`). Captures : `screenshots/phase6c/`.

Script de dev en attendant l'écran d'import : `scripts/kit-poc/apply-kit.mts`
(sortie de `run-import` → fichiers sous `/media/kit/`, thème de test).

## 7. Phase 6d — kit v2 lisible par une artiste, import complet

Retour réel de l'artiste sur le kit v1 (Photoshop, Windows) : « Non je comprends
pas ». Calques isolés hors des groupes, LISEZ-MOI rangé n'importe où, « pourquoi
seulement le scotch dans les accessoires », tout tassé sur une toile 2880 × 2560
sous le paysage, libellés illisibles à 25 %, rien ne dit où chaque élément
apparaît sur le site. Son fichier réenregistré par Photoshop (flèche droite
redessinée) est le jeu de test réel : `tests/fixtures/kit-synthetique.psd`
(5,8 Mo ; 1,5 Mo une fois compressé par git : gardé dans le dépôt).

### Groupes plutôt que plans de travail

ag-psd lit et écrit les plans de travail (`artboard` sur un groupe, `artd` sur le
document). Retenu pourtant : **un groupe de premier niveau par élément, chacun
sur une zone de toile dédiée et espacée** (une « carte »). Raisons : la relecture
d'un document à plans de travail réenregistré par Photoshop n'est pas vérifiable
sur la VM, et Photoshop agrandit et décale la toile d'un tel document
(coordonnées déplacées) ; l'aller-retour des groupes est, lui, **prouvé sur le
fichier de l'artiste** : chaque emplacement relu identique au bit près (une fois
replacé dans sa case). L'import tolère malgré tout un plan de travail : ses cases
sont alors relatives au rectangle du plan.

### Document v2 (4000 × 4000, RVB 8 bits)

Panneau Calques, de haut en bas : `LISEZ-MOI` (calque seul, verrouillé, 5 lignes
en 40 px), `_guides` (verrouillé : contour des cases, hauteurs utiles, zone du
titre, marges du cadre, identifiant du kit), puis :

| Groupe | Calques | Case(s) dans la toile | Taille |
|---|---|---|---|
| 1 · Paysage d'accueil | Plan 1 — le plus lointain (ciel), Plan 2 … Plan 5 — premier plan | 30, 440 | 2880 × 1600 |
| 2 · Signature | Signature | 30, 2170 | 1200 × 300 |
| 3 · Papier | Papier (tuile) | 2390, 2170 | 512 × 512 |
| 4 · Cadre des entrées de collection | Cadre | 30, 2812 | 300 × 300 |
| 5 · Trait | Trait | 1490, 2812 | 1200 × 80 |
| 6 · Icônes | Flèche gauche, Flèche droite, Fermer, Lecture | 30 + n × 280, 3442 | 128 × 128 |
| 7 · Scotch | Scotch | 2158, 3442 | 400 × 160 |

**Pré-remplissage = ce que le site affiche aujourd'hui** (l'artiste voit ce
qu'elle remplace) : asset du kit s'il existe, calques SVG du hero, sinon le nom
du site rendu dans la **police de titre du thème à sa graisse de titre**
(polices du catalogue embarquées, OFL : `public/kit/fonts/`, instances
statiques, rendues par sharp sans police système), flèches « ← » / « → » et
croix « ✕ » des boutons, triangle de lecture, scotch CSS translucide (surface à
58 %, bords pointillés, -3°), passe-partout `.mat` (rien en « full-bleed »),
trait droit, fond uni ou pointillé. Le nom du site entre dans la version du kit
en cache. Une case vidée par l'artiste n'est pas une erreur : l'élément
actuel est gardé.

Le scotch est un emplacement comme les autres (« 7 · Scotch ») : le mot
« accessoires » disparaît, il n'y a jamais eu qu'un accessoire. Chaque groupe
contient tout en bas un calque verrouillé **« Aperçu — ne pas modifier »** : la
carte blanche (percée à l'endroit des cases), le titre au-dessus, la phrase « où
ça apparaît » (« Ce que tu dessines ici devient les flèches sur les bords des
planches, la croix de l'image agrandie et le bouton lecture. »), une **vignette
schématique du site** aux couleurs du thème avec la zone surlignée en rose (une
capture réelle demanderait un navigateur à l'export, absent de l'image
distroless), et les consignes en **36 px** : dimensions et transparence, ce qui
est ignoré, astuce « Pas envie ? Laisse tel quel : c'est gardé ». La mise en page
est vérifiée à l'export (texte qui déborde d'une carte : erreur). Arborescence
et vue d'ensemble : `screenshots/phase6d/kit-v2-*.png`.

### Import (le prototype devient le produit)

- **Noms** : `looseName` (casse, accents, espaces, tirets, numérotation « 1 · »,
  précision après « — », parenthèses) ; anciens noms v1 (`hero/plan-1`,
  `icones/fleche-droite`, `accessoires/scotch`…). Kit v1 (2880 × 2560) toujours
  importé, cases v1.
- **Contenu d'un élément** : groupe à un emplacement (« 2 · Signature ») : tout
  son contenu est aplati (calques et sous-groupes ajoutés par l'artiste) ;
  paysage et icônes : chaque calque ou sous-groupe reconnu est un emplacement, un
  sous-groupe non reconnu est traversé, un calque non reconnu est ignoré et
  signalé. Aperçus, `_guides` et LISEZ-MOI ne sont jamais lus.
- **Aplatissement** : normal, produit, superposition, obscurcir, éclaircir,
  opacité et fond des calques, opacité des groupes ; autre mode : appliqué en
  normal avec un avertissement ; masque de fusion, masque d'écrêtage : signalés.
  Calque **replacé et normalisé dans sa case** (Photoshop recadre un calque à son
  contenu : flèche 97 × 85 à 2576, 1745 au lieu de 128 × 128 à 2560, 1720) ; ce
  qui dépasse est coupé et signalé. Icônes, tuile, cadre : la case entière.
- **Effets nommés** : « Ombre portée détectée sur Signature : non pris en compte,
  pixellise le calque dans Photoshop (Calque > Pixelliser > Style de calque). »
- **Inchangé reconnu** : l'export écrit un manifeste (empreinte des pixels de
  chaque case, aperçus « avant ») dans `cache/kits/manifests/` ; l'identifiant
  d'export est dans un nom de calque de `_guides` (Photoshop garde les noms et
  réécrit le XMP). Sans identifiant (kit v1, calque supprimé), le manifeste est
  retrouvé par le contenu (au moins la moitié des cases identiques). Un
  emplacement inchangé n'est **pas reconverti** : l'asset actuel du thème reste.
  Kits v1 déjà envoyés : `scripts/kit-poc/legacy-manifest.mts` (manifeste
  depuis le PSD d'origine).
- **Chemin** : envoi par morceaux existant (`purpose: kit` : `.psd`, 300 Mo au
  plus, thème existant, refusés avant l'envoi) ; à la fin, signature `8BPS` et
  en-tête contrôlés **sans décodage** (PSB, RVB, 8 bits, dimensions, calques) ;
  puis job « kit-import » de la **file lourde exclusive**, dans le processus
  enfant ; dossier `${DATA_DIR}/kit-imports/<id>/` (PSD supprimé après import,
  dossier purgé au bout de 7 jours). Migration 0010 (`uploads.target`).

### Défenses (revue indépendante 6b–6d)

- **Limites recomptées sur l'arbre réellement lu** (`treeStats`, après
  `readPsd` en `useRawData`, sans pixels) : calques et groupes (120), surface
  cumulée (5 documents v2), profondeur (12), plus grand calque ; l'en-tête ne
  lit que la section principale alors qu'ag-psd relit aussi les blocs
  `Lr16` / `Lr32`. L'en-tête reste le premier filtre (avant l'envoi même).
- **Décodage borné** : un calque dont le rectangle dépasse sa case de plus de
  256 px est refusé AVANT d'allouer ses pixels (« Le calque X dépasse sa case :
  recadre-le ») ; imbrication bornée à 8 niveaux sous un emplacement ;
  composition en 8 bits, pixel par pixel depuis le calque, un tampon seulement
  pour un groupe à opacité ou à mode (plus de trame Float32 par niveau).
- **Processus enfant plafonné** : pas de `prlimit` dans l'image distroless ;
  tas JS borné (`--max-old-space-size=256`) et mémoire résidente relue dans
  `/proc/<pid>/status` toutes les 200 ms par le parent : tué au-delà de
  `KIT_CHILD_MAX_RSS_MB` (650 Mo) ou de la durée (`KIT_EXPORT_MAX_DURATION_S`,
  `KIT_IMPORT_MAX_DURATION_S`) → job en échec lisible, PSD supprimé, sortie
  tronquée à 64 Ko ; un enfant précédent encore vivant est tué avant d'en
  lancer un autre. Mesuré en production sous ce plafond : export 346 Mo,
  import du fichier réel 181 Mo. `mem_limit: 1g` commenté dans le compose.
- **Lecture ag-psd bornée** : `totalMemoryLimit` de 64 Mo (`PSD_READ_OPTIONS`) : ce
  qu'ag-psd décode lui-même pendant la lecture (motifs `Patt`/`Pat2`/`Pat3`,
  composite) ne dépasse pas 64 Mo (2 Go par défaut). **Canaux ZIP refusés**
  avant décodage (`pako.inflate` sans taille de sortie maximale) : Photoshop
  écrit du RLE en 8 bits ; message « Compression ZIP non prise en charge :
  réenregistre depuis Photoshop ».
- **Priorité OOM** : `oom_score_adj` à 1000 pour l'enfant (écrit par le
  parent après le lancement et par l'enfant lui-même, permis sans
  privilège) : en cas de manque de mémoire du conteneur, le noyau tue
  l'enfant, jamais le serveur (relu : 1000 à l'export et à l'import).
- **Pas de nouvel essai** : un export ou un import resté « running » au
  redémarrage (le serveur a pu tomber à cause du fichier) passe en échec.
- **Cloisonnement par thème** : écran, routes (`/admin/api/theme-kit/<thème>/import/<id>`)
  et action « Appliquer » vérifient que l'import appartient au thème ;
  seuls les kits exportés de CE thème servent de référence ; un kit d'un autre
  thème est signalé (« Ce kit vient du thème … ») et rien n'est marqué inchangé.
- **Aller-retour sans fin** : l'export d'un thème qui a déjà des éléments
  dessinés (`theme.assets.kit`) les pré-remplit ; réimporté tel quel, tout est
  « inchangé » (test:auth TI9).
- **Disque** : purge au motif exact `<id>-<hex12>-v<n>.psd`, cache borné à 20
  PSD, manifestes, aperçus et imports purgés à la suppression d'un thème, 5
  imports gardés par thème (et 7 jours au plus ; jamais un import en file ou en cours).

### Revue et application (`/admin/themes/<id>/kit`)

Une carte par emplacement : ✓ / ⚠ / ✗ et la raison en clair (« Flèche droite :
redessinée », « Plan 3 : inchangé »), avant / après sur damier, format retenu,
poids, écart du contour ; total au premier affichage (après / aujourd'hui) ;
palette suggérée (seulement si le paysage a changé), à appliquer ou ignorer,
refusée si elle ne passe pas le contraste AA ; **paire de flèches** : une seule
redessinée → « Utiliser le miroir de ta flèche droite pour la flèche gauche »
(cochée par défaut, aperçu retourné), appliqué par retournement horizontal de
l'asset converti (SVG : `matrix(-1 0 0 1 l 0)` ; bitmap : `flop`), sans
re-tracer (`mirror.ts`). **« Appliquer au thème »** crée une
copie brouillon « … (kit) » (jamais le thème en ligne), avec les nouveaux assets
(scotch REDESSINÉ — pas simplement importé faute de kit d'origine : variante « scotch » activée sur la copie ; sinon les variantes du thème de base restent). **Thème de base** (lot 17a) : le kit d'origine est reconnu quel que soit l'écran où le PSD est envoyé ; la copie part du thème dont le kit a été exporté (`reference.themeId`), sinon de celui de l'écran, sinon du thème choisi dans le sélecteur « Kit appliqué sur le thème » (`?base=`, listé avec « en ligne » et « thème d'origine du kit » ; la revue — contrastes, poids — est recalculée sur lui), puis ouvre son
éditeur et son aperçu en direct. Thèmes livrés compris.

### Mesures (VM, 2026-10-01)

| Opération | Durée | Pic mémoire | Sortie |
|---|---|---|---|
| Export v2 de galerie-lumineuse (enfant esbuild) | 3,1 s | **345 Mo** (sans rognage ni composite en flux : 445 Mo) | PSD 9,6 Mo, 30 calques |
| Import du fichier réel de l’artiste (enfant, production) | 0,9 s | 150 Mo | 1 masque SVG de 463 o |
| Import d'un kit v2 non modifié | 0,7 s | 226 Mo | rien à convertir |

Export sous 400 Mo : calques rognés à leur contenu (comme Photoshop), cache
libvips coupé, composite composé en flux vers un PNG sur disque puis réencodé
(RLE, PackBits dans un tampon réutilisé, calques déjà rendus) à la place du
composite vide d'ag-psd, qui alloue de toute façon sa propre copie de
4000 × 4000 : jamais deux copies en mémoire. Composite relu identique au pixel
près. Module natif du tracé copié dans le standalone par
`scripts/copy-kit-native.mjs` (un `outputFileTracingIncludes` « * » recopiait
tout le projet : refusé par check-standalone).

Tests : `npm test` (`test-kit-import` : fichier réel — seule la flèche droite
redessinée, masque SVG 128 × 128, écart 0,49 px —, noms, sous-groupes, fusion,
préalable), `test:auth` TI1–TI7 (gardes, refus avant décodage, import et
application en production), `test:e2e-kit` (aller-retour et fichier réel, un
chromium).

## 8. Palette du thème et curseurs (kit v3, lot 4)

Retours de l'artiste (Photoshop, Windows) : « pouvoir choisir la couleur “plus
foncée” dans le kit Photoshop, globalement un choix plus poussé de la palette » ;
« dans le kit, pouvoir changer la souris (normal et clic) ».

### Modèle de palette (`src/themes/palette.ts`)

Six **couleurs de base**, toujours choisies, et leurs **nuances**, chacune
**auto** (dérivée de sa base en OKLCH : elle suit la base quand celle-ci change)
ou **choisie** (forcée). Groupes, dans l'ordre de l'éditeur et du kit :

| Groupe (base) | Nuance | Jeton | Règle « auto » |
|---|---|---|---|
| Fond (`bg`) | profond | `bgDeep` | luminosité OKLCH −0,025 (+0,025 sur un thème sombre), chroma × 1,5 |
| | filets | `line` | 12 % du texte mélangé au fond (OKLab) ; transparence acceptée si choisie |
| Surface (`surface`) | — | | |
| Texte (`ink`) | secondaire | `inkSoft` | texte éclairci vers le fond (35 % en OKLab), réduit jusqu'à l'AA sur `bg`, `bgDeep`, `surface` |
| | ombres | `shadow` | le texte (#000000 sur un thème sombre) — règle d'avant |
| Action (`primary`) | survol | `primaryHover` | luminosité OKLCH −0,06 (+0,06 sur un thème sombre) |
| | texte dessus | `onPrimary` | blanc, ou la couleur la plus sombre du thème si elle se lit mieux |
| Accent secondaire (`secondary`) | étiquettes | `eyebrow` | l'accent secondaire — règle d'avant |
| Détails (`tertiary`) | — | | |
| Visionneuse (sans base) | voile | `scrim` | le texte (le fond sur un thème sombre) — règle d'avant |
| | texte | `onScrim` | le fond (le texte sur un thème sombre) — règle d'avant |

Clair / sombre : luminance relative du fond < 0,2 (même seuil que `css.ts`).
Réglages : `DERIVE` dans `palette.ts`.

**Stockage** (schéma : blocs délimités « Palette (lot 4) » dans `schema.ts`) :

- nuances **enregistrées** (`bgDeep`, `line`, `inkSoft`, `primaryHover`,
  `onPrimary`) : toujours présentes dans `tokens.color` avec leur valeur
  effective (tout le code qui les lit est inchangé) ; « auto » = listées dans
  `tokens.palette.auto`, recalculées à chaque changement d'une base
  (`normalizePalette`, aussi côté serveur à l'enregistrement : jamais la valeur
  du client) et au rendu (`resolvePalette`) ;
- nuances **facultatives** (`eyebrow`, `shadow`, `scrim`, `onScrim`) : absentes
  = auto, présentes = choisies.

API : `resolvePalette(color, palette)` (toutes les couleurs, pour le rendu,
l'aperçu, le kit), `isAuto`, `setNuance(color, palette, clé, valeur | null)`
(`null` = revenir à auto), `setBase` (les nuances auto suivent),
`PALETTE_GROUPS` (libellés, règles en clair), `paletteLabel` (« Action ·
survol »). Contraste : toujours `contrast.ts` ; en plus, le texte sur le voile
(`onScrim` / `scrim`) doit tenir 4,5:1 (éditeur, serveur, application du kit).

**Migration : aucune.** Un thème d'avant n'a pas de `tokens.palette` : ses
nuances enregistrées sont « choisies » à leur valeur actuelle, ses nuances
facultatives absentes sont dérivées par la règle d'avant. Rendu identique,
vérifié variable par variable sur chaque preset (`scripts/test-palette.mjs`).
« Revenir à auto » dans l'éditeur fait passer une nuance à la dérivation OKLCH
(la valeur proposée est affichée sur le bouton).

**Pour un nouveau thème (lot 5)** : donner les 6 bases ; pour chaque nuance
enregistrée, soit une valeur, soit l'inscrire dans `palette.auto` (la valeur
écrite est alors recalculée : mettre la valeur de `resolvePalette` pour que le
fichier dise vrai) ; omettre les facultatives pour la règle par défaut.
`npm run check:contrast` et `node --import tsx scripts/test-palette.mjs`.

### Éditeur (Admin → Thèmes → un thème, panneau « Palette »)

Un cadre par groupe : la base, puis ses nuances avec leur état (« auto » /
« choisie »), la règle auto en clair, « Revenir à auto » (avec la valeur
proposée), contraste en direct et « Ajuster » comme avant. Au-dessus, un
**échantillon de composants** (étiquette, titre, texte secondaire, lien, bouton
et son survol, filet, carte et son ombre, fond profond, voile avec sa légende)
aux couleurs de la palette éditée, en plus de l'aperçu du site. Le panneau
« Styles du site » de l'éditeur visuel n'existe pas en v0.13.0 : pas d'accès
depuis la toile (à brancher s'il apparaît).

### Curseurs

- `Theme.assets.kit.cursors` : `default` et `pointer` (PNG 32 × 32 et 64 × 64
  sous `/media/kit/<hash16>.png`, point chaud `x`, `y` en px CSS 0–31), `off`
  (désactivés depuis l'éditeur de thème : curseurs du système, dessins gardés).
- `css.ts` émet, seulement si un curseur est présent et non désactivé,
  `--t-cursor-default` (`url(png) x y, auto`), `--t-cursor-pointer`
  (`url(png) x y, pointer`), leurs versions `-hd` (`image-set(… 1x, … 2x) x y,
  repli`) et `data-kit-cursor` / `data-kit-cursor-pointer` sur `<html>`.
- `variants.css` : `body` prend le curseur normal ; liens, boutons,
  `[role=button]`, `summary`, `label[for]`, `select`, cases à cocher, barre du
  rail prennent le « clic » ; HiDPI sous `@supports (cursor: image-set(…))` (une
  déclaration avec une variable invalide au calcul ne retomberait pas sur la
  précédente) ; désactivés : curseur normal ; **champs de texte : `cursor:
  text`** (le curseur est hérité, sans cette règle ils perdraient la barre de
  saisie). Site public seulement : l'admin a sa propre feuille ; la toile de
  l'éditeur visuel et l'aperçu du thème montrent le site, donc les curseurs.
  Une image cliquable peut poser `cursor: var(--t-cursor-pointer, pointer)`.
- Rendu ≤ 32 px CSS par construction (PNG 1x de 32 px, 2x déclaré `2x`).
- Visibilité (`src/themes/cursor.ts`) : part des pixels opaques à ≥ 3:1 contre
  `bg`, `bgDeep`, `surface` ; sous 15 % : « presque invisible » (revue de
  l'import et éditeur de thème). La flèche du système (noire au contour blanc)
  passe sur fond clair comme sombre.

### Kit v3 : groupes « 8 · Palette » et « 9 · Curseur »

Document **4000 × 4880** (une rangée de plus sous « 6 · Icônes » / « 7 ·
Scotch » ; les cases 1 à 7 ne bougent pas). Les kits v2 (4000 × 4000) et v1
restent importés ; sans ces groupes, ni palette ni curseur ne sont rapportés.

| Groupe | Calques | Case(s) | Taille |
|---|---|---|---|
| 8 · Palette | une pastille par couleur et par nuance, nommée « Fond », « Fond · profond », « Action · survol », « Visionneuse · voile »… (15) | colonne par groupe, à 0 + 30 + n × 250, 4042 + 30 + rang × 250 | 150 × 150 |
| 9 · Curseur | groupes « Normal » et « Clic » : calque « Dessin » + repère « point chaud » | 2770 et 3000, 4092 | 64 × 64 (= 32 px CSS) |

- **Pastilles** : aplats aux coins arrondis écrits pixel par pixel (couleur
  exacte, transparence des filets comprise), pré-remplis avec la valeur
  actuelle ; sous chaque pastille, son nom et « (auto) » si la nuance suit sa
  base. Consigne de la carte : « Repeins une pastille pour changer cette
  couleur ; laisse-la telle quelle pour la garder (une nuance « auto » suit
  alors sa couleur de base) », Alt+Maj+Retour arrière pour remplir.
- **Lecture** (lot 17a : gestes naturels de Photoshop) : couleur de
  remplissage si Photoshop en a fait un calque de forme (`vectorFill`) ;
  sinon, avec la couleur exportée connue, la couleur la plus présente parmi
  les pixels REPEINTS (écart ≥ 3 niveaux à la couleur exportée, au moins 3 %
  de la pastille : un coup de pinceau sur un tiers compte, avertissement sous
  50 %), sans elle la couleur la plus présente des pixels visibles. Avant la
  lecture, la pastille est aplatie avec : les calques AJOUTÉS dans le groupe
  qui recoupent sa case (nouveau calque de peinture, calque de forme — rangés
  par leur place dans la pile ; un calque sous la pastille est couvert par
  elle ; un calque hors de toute case ou de réglage est signalé dans la
  revue), et le style de calque « Incrustation couleur » actif (mode normal ;
  les autres styles sont signalés). Opacité ignorée sauf filets et détails. Comparée
  à la couleur exportée (manifeste : `colors`) — empreinte identique ou même
  couleur : **inchangée** (une nuance auto reste auto) ; sinon **changée**
  (forcée à l'application). Sans kit d'origine reconnu : comparée à la palette
  actuelle du thème (passée à l'enfant par `import-job`).
- **Curseurs** : pré-remplis avec une flèche et une main noires au contour
  blanc (représentation des curseurs du système) ou les curseurs déjà
  dessinés ; repère « point chaud » = anneau rose de 11 px centré sur le point
  (pointe de la flèche : 4, 4 ; bout de l'index : 26, 4). À l'import : le repère
  est retiré de l'aplatissement, son centre donne le point chaud (absent :
  défaut et message ; hors case : ramené au bord) ; empreinte du dessin ET point
  chaud comparés au manifeste (`hotspots`) ; changé → PNG 64 × 64 et 32 × 32
  (lanczos), palette ≤ 256 couleurs si plus léger ; case vide ou inchangée :
  curseur actuel gardé (le système si aucun).
- **Revue** : section « Couleurs de la palette » (avant → après, contraste
  après application, « était auto : devient choisie ») ; les curseurs ont leur
  carte comme les autres éléments (avant / après, poids, point chaud). Case
  « Appliquer les couleurs repeintes » (cochée sauf contraste en échec, refusé
  aussi côté serveur : la revue le dit alors en toutes lettres, « Tes couleurs
  ne seront PAS appliquées », avec le décompte lues / repeintes / illisibles) ; « Appliquer au thème » : bases d'abord (les nuances auto
  suivent), puis nuances forcées ; de nouveaux curseurs réactivent les curseurs
  sur la copie.

### Mesures (VM, 2026-10-02)

Export v3 de galerie-lumineuse (`scripts/kit-poc/export-kit.mts`, en
processus, `MALLOC_ARENA_MAX=2`, deux essais) : **PSD 11,7 Mo, 53 calques,
3,6–3,8 s, pic 363–378 Mo** (v2 mesuré de la même façon : 9,6 Mo, 30
calques, 340–362 Mo). `KIT_MEM_DEBUG=1` donne le pic par étape : le paysage
reste le gros morceau (+150 Mo), palette et curseurs ≈ +40 Mo de rasters.
Deux économies compensent le document plus haut :
- écriture ag-psd d'un document déclaré « 1 × 1 » (en-tête réécrit ensuite) :
  ag-psd allouait sinon un tampon de 8 × l × h et un composite vide (≈ 230 Mo
  pour 4000 × 4880), jetés aussitôt ;
- composite écrit au format natif de libvips (`.v`, non compressé) et relu
  ligne à ligne sur le disque pour le RLE, au lieu d'un PNG décodé en flux
  (+120 Mo mesurés à cette étape avec le PNG). Composite relu identique.
  Ce fichier (~75 Mo) va dans `${DATA_DIR}/cache/kits/`, **jamais dans `/tmp`**
  (un tmpfs le compterait en mémoire du conteneur) ; supprimé en fin d'export,
  et les restes d'un export tué (plafond mémoire, durée) au suivant.

Tests : `scripts/test-palette.mjs` (migration, auto / forcé, OKLCH, schéma,
CSS des curseurs, visibilité) et la section « Kit v3 » de
`scripts/test-kit-import.mjs` (aller-retour réel : export, pastilles et
curseur modifiés avec ag-psd, import, application).

## 9. Kit v4 (lot 17e) : trois PSD aérés dans une archive

Retours de l'illustratrice (Photoshop sur tablette graphique, Windows) sur le kit
v3 (un seul PSD de 4000 × 4880, groupes numérotés) : « c'est très dense, on a peu de
pixels pour dessiner » (icônes 128 × 128, curseur 64 × 64), « pour le décor, je n'ai
pas besoin d'utiliser les plans 1, 2, 3, 4 ? je peux séparer comme je veux sur
différents calques et c'est le site qui gère ? », et les couleurs de la palette « incompréhensibles »
dans le PSD. Décisions : on dessine EN GRAND et le site réduit ; le décor est à calques libres ;
la palette SORT du kit (elle se choisit dans l'éditeur visuel, lot 17f).

### Export : `kit-<thème>.zip`

| Fichier | Document | Contenu (case de dessin → taille d'usage) |
|---|---|---|
| `1-decor-accueil.psd` | 5760 × 3960 (bande de consignes 760 px + cadre du décor 5760 × 3200) | Calques LIBRES de premier niveau : chacun (ou groupe) est un plan, du fond (bas de la pile) vers l'avant, jusqu'à 8. Le décor actuel du thème (calques SVG du hero, ou plans déjà dessinés) y est découpé en ses plans, à 2 × leur taille d'usage. Repères : cadre du décor, zone du titre. |
| `2-logo-papier.psd` | 3000 × 4640 | Logo 2400 × 600 → 1200 × 300 ; papier : tuile 1024 × 1024 → 512 × 512 avec, à côté, l'aperçu 3 × 3 de la tuile actuelle (raccords repérés en pointillés roses) ; trait 2400 × 160 → 1200 × 80. |
| `3-icones-curseurs.psd` | 3400 × 7810 (lot 121 ; avant : 3400 × 5770, toujours importé) | 4 icônes 512 × 512 → 128 × 128 ; 2 curseurs 512 × 512 → 64 × 64 (affiché 32, point chaud : anneau rose de 88 px) ; cadre 900 × 900 → 300 × 300 (marges 144 px = 48) ; scotch 1200 × 480 → 400 × 160. |
| `LISEZ-MOI.txt` | | Court : trois fichiers, comment faire, envoyer seulement les fichiers modifiés. |

Où ranger quoi : le logo (identité), le papier (répété) et le trait (étiré) sont ce qui se
répète ou s'étire sur toutes les pages ; le cadre, le scotch, les icônes et les curseurs sont de
**petits objets posés**, qui se dessinent tous de la même façon (une grande case, réduite à
l'import) : ils vivent ensemble dans le fichier 3, le cadre et le scotch rejoignant les icônes
plutôt que le logo (un fichier de plus pour deux éléments n'aurait pas aidé).

Chaque fichier : calque « LISEZ-MOI » tout en haut (consigne et exemple illustré : trois calques
= trois plans, ou « tu dessines en grand, le site réduit »), groupe `_guides` verrouillé (cases
roses, **zone utile** en pointillés bleus, marges du cadre en vert) qui porte l'identifiant du kit
ET le rôle du fichier (`kit k2-… · role-logo — ne pas supprimer`), cartes verrouillées
« Aperçu — ne pas modifier » sous les cases (titre, **taille finale** de chaque case, « où ça
apparaît », vignette du site, consignes en ≥ 36 px). Le même identifiant d'export sert aux trois
fichiers ; manifeste unique (empreinte de chaque case en grand, plans du décor sous `hero/plan-n`).

Cache : `cache/kits/<thème>-<version>-v4.zip`. L'enfant écrit les PSD dans `…zip.parts/`, puis
l'archive (écriture en flux, entrées stockées : un PSD est déjà en RLE), puis supprime le dossier.

### Import

- **Envoi** : un `.zip`, un `.psd`, ou plusieurs `.psd` choisis ensemble (3 au plus). Un PSD :
  comme avant. Plusieurs : envoyés l'un après l'autre avec un identifiant de lot choisi par le client
  (`purpose.batch`, rangé dans `uploads.target` : pas de migration) ; seul le dernier lance l'import
  (`createKitImport`, `meta.collecting`). Archive : lue sur le disque (`zip-archive.ts`) — répertoire
  central, ≤ 200 entrées, seules les entrées `.psd` sont extraites (jamais par leur nom comme chemin),
  taille déclarée ET taille réellement écrite bornées, chiffrement et ZIP64 refusés ; ≤ 3 PSD.
- **Reconnaissance** : chaque PSD par la **taille de son document** (trois tailles distinctes) ;
  le rôle noté dans l'identifiant de `_guides` doit concorder (sinon : refus clair). Le nom du fichier
  n'est jamais lu. Un ancien kit (v1/v2/v3) s'envoie seul ; mélangé aux fichiers du v4 : refusé.
- **Éléments absents** : un fichier non envoyé n'est pas une erreur : la revue dit « pas envoyé :
  inchangé » et rien de ses éléments ne change. Un calque supprimé dans un fichier reçu : « introuvable :
  l'élément actuel est gardé » comme avant.
- **Réduction** (`formats.reduceTo`) : lanczos3, alpha prémultiplié par libvips (ni liseré sombre ni
  clair au bord d'une forme), alpha ≤ 8 remis à zéro. Les icônes, le logo et le trait restent des
  **masques** (la forme seule : la teinte vient du thème) ; l'empreinte comparée au manifeste est
  celle de la case en grand. Curseur : réduit à 64 × 64, point chaud = centre de l'anneau, ramené à la
  taille du curseur (÷ 8). Mesure : disque dur de 360 px dessiné dans la case 512 → 90 px, 284 pixels
  de bord lissés, écart moyen à un disque idéal 0,24 niveau (`test-kit-multi.mjs`).
- **Décor libre** (`resolveDecor`) : chaque calque ou groupe de premier niveau est un plan (guides,
  consignes, aperçus ignorés ; calque masqué ignoré ; calque vide ou hors du cadre ignoré), converti
  comme avant (SVG ou AVIF + WebP au plus léger, ThumbHash). Au plus 8 plans (sinon refus), le premier
  peut être opaque, les suivants non. Un plan dont l'empreinte est celle d'un plan exporté est
  « inchangé » **même déplacé** (`from` = rang d'origine) : retirer ou réordonner des plans est une
  composition changée (`report.decor.structure`) sans pixel reconverti. Application : `kit.plans` = les
  N plans (SVG, AVIF, ou le calque SVG du thème rangé dans `/media/kit`), `kit.plansOnly = true` (les
  calques du thème ne s'y ajoutent plus) ; un plan en erreur bloque tout le décor (l'actuel est gardé).
  Schéma : `plans` ≤ 8, `plansOnly`. Parallaxe : amplitude croissante jusqu'à 8 plans.
- **Revue** : groupée par fichier (titre, nom du fichier reçu, nombre d'éléments), fichiers manquants
  en « pas envoyé : inchangé », résumé du décor (« N plans lus, composition changée »), aperçu
  « avant » d'un plan = le plan exporté dont il est la copie.
- **Limites** (`limits.ts`) : fichier ≤ 300 Mo (décor : 256 Mo), surface cumulée des calques ≤ 5 documents
  v2 (décor : 10 × 5760 × 3200), 3 fichiers au plus ; empreintes et arbre contrôlés avant décodage, comme avant.

### Mémoire (VM, 2026-10-13, Node 24, enfant de production : `--expose-gc --max-old-space-size=256`, `MALLOC_ARENA_MAX=2`)

| Opération | Durée | Pic |
|---|---|---|
| Export des trois PSD + archive (galerie-lumineuse) | 10,5 s | **480 Mo** (le pic est le décor : 5 plans à 5760 × 3200 en RVBA, 74 Mo chacun) |
| Réimport des trois fichiers (non modifiés) | 3,8 s | **331 Mo** |
| Import d'un décor « lourd » : 5 plans pleine toile (5760 × 3200, grain), PSD de **265 Mo** | 13,8 s | **582 Mo** |

Le pic de l'import est (Node ≈ 120 Mo) + le fichier en mémoire + un calque décodé (74 Mo) + sa copie
dans la case (74 Mo) : il croît avec le poids du PSD ; d'où le plafond de 256 Mo pour le fichier du décor
(≈ 570 Mo, sous les 650 Mo de l'enfant, serveur ≈ 250 Mo au repos : 820 Mo dans le conteneur de 1 Gio).
Un décor d'illustratrice (aplats, quelques calques) pèse 10 à 100 Mo : pic de 330 à 450 Mo. Jamais en
même temps qu'une conversion vidéo (file lourde exclusive, inchangé). Les plafonds mémoire et durée de
l'enfant (§ « Défenses ») s'appliquent tels quels.

### Compatibilité et nettoyage

Les anciens kits restent lus : `layout` `v1` / `v2` (cases d'usage, groupe « 8 · Palette » avec la lecture
des gestes naturels du lot 17a, curseurs 64 × 64) ; `buildKit` (export v3) n'est plus appelé par
l'application, il sert aux tests de compatibilité (`test-kit-import.mjs`) et au script du tuto. Le
fichier réel `tests/fixtures/kit-synthetique.psd` est toujours lu à l'identique.

Tests : `scripts/test-kit-multi.mjs` (dans `npm test` : export → archive → réimport sans changement,
icône à 512, logo, curseur, décor libre, archive défensive, anciens kits), `test-kit-import.mjs`,
`test-theme-kit.mjs` ; e2e `kit` (archive, un PSD, deux PSD ensemble, décor libre appliqué, fichier de
l'artiste) et `kit17a` (logo et papier seuls, appliqués au thème d'origine).

### Palette suggérée retirée de la revue (lot 17e)

La revue ne propose plus de palette tirée du paysage (`kit/palette.ts` supprimé, option `palette` de « Appliquer » retirée) : les couleurs se choisissent dans l'éditeur visuel (lot 17f). La lecture du groupe « 8 · Palette » des anciens kits v1/v2/v3 est conservée (section « Couleurs de la palette » de la revue, `extras.ts`).

## 10. Icônes des vidéos (lot 121)

Le fichier « icônes » du kit v4 gagne un groupe **« 5 · Vidéo »** sous le scotch (document 3400 × 7810 ; l'ancien 3400 × 5770 reste importé : ses emplacements vidéo n'existent pas, `multiOnly`). Il contient un calque gabarit par icône, dans une case de 512 × 512 réduite à 128 × 128 (l'icône actuelle du site y est dessinée en exemple) : « Lecture vidéo », « Pause vidéo », « Boucle », « Son activé », « Muet », « Plein écran », « Quitter le plein écran », et « Fond du badge (option) » (masqué au départ, 512 × 512 réduit à 256 × 256, en couleurs).

- **Le logo seul, pas le carré** : l'artiste dessine l'icône ; le carré du badge reste réglé par le thème (couleur, transparence, coins). Le fond du badge dessiné, s'il existe, remplace le carré (`[data-kit-vicon-badge] .vid-badge`, étiré à la taille du badge).
- **Règle des icônes du kit** : forme d'une seule couleur, masque teinté par `currentColor` (SVG tracé, sinon masque bitmap). Case vide ou calque supprimé : l'icône actuelle est gardée ; case inchangée : « inchangé » (aucun asset).
- **Données** : `kit.vicons` = `{ play, pause, loop, sound, muted, fullscreen, exitFullscreen, badge }` (chacun facultatif, un `kitImage`). Variables `--t-kit-vicon-<nom>` et attributs `data-kit-vicon-<nom>` posés par `src/themes/css.ts` ; règles dans `variants.css`.
- **Composant** : `src/components/video-icons.tsx` (contrat commun avec le lot 127). Chaque icône porte `data-vicon="<clé>"` et `--vi` (taille) ; le CSS efface le SVG d'origine et pose le dessin. Sans dessin, le rendu est identique à celui d'avant.
- Emplacements dans le kit : `video/lecture`, `video/pause`, `video/boucle`, `video/son`, `video/muet`, `video/plein-ecran`, `video/quitter-plein-ecran`, `video/fond-badge` (`src/lib/kit/spec.ts`, `VIDEO_ICONS`).
