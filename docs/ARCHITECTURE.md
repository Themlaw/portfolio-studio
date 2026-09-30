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
| Auth admin | Better Auth : OAuth Authentik (generic OAuth/OIDC) + email/mot de passe en secours. `AUTH_PASSWORD_DISABLED=true` coupe le mot de passe **seulement si** l'OIDC est configuré (sinon ignoré + avertissement au démarrage : on ne s'enferme jamais dehors). Inscription publique désactivée. |
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
4. **Éditeurs** : thèmes, pages/blocs, projets/slots avec upload d'images, médiathèque.
5. **Vidéo** : upload, file de jobs ffmpeg, lecteur, bloc `video`.
6. **Création de thèmes** (plus tard) : éditeur complet, import de polices, assets de hero.

## Hors périmètre pour l'instant

Multi-utilisateurs avec rôles, historique des versions de contenu, brouillons par page,
HLS adaptatif, CDN.
