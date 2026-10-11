# Thèmes — ajouter un thème en 10 minutes

Un thème est **de la donnée** : des tokens (couleurs, polices, rayons,
espacements, mouvement), des variantes de composants et quelques assets,
validés par le schéma zod (`src/themes/schema.ts`). Aucun CSS propre à un
thème : tout ce qu'un thème change passe par le schéma. C'est ce qui permet
de le dupliquer, de l'exporter et de l'importer sans rien perdre.

Deux façons d'ajouter un thème :

| | Thème **livré** (dans le code) | Thème **importé** (Admin → Thèmes) |
|---|---|---|
| Pour qui | développeur | l'artiste, sans redéployer |
| Où | `src/themes/presets/<slug>/` | base de données |
| Assets | calques SVG du hero dans `public/themes/<slug>/` | éléments dessinés du kit (`/media/kit/…`) |
| Modifiable dans l'admin | non (dupliquer) | oui |

## 1. Thème livré : le dossier

```
src/themes/presets/<slug>/theme.ts     ← les données du thème (export par défaut)
public/themes/<slug>/hero/*.svg        ← calques du hero parallaxe (facultatif)
public/themes/<slug>/thumb.webp        ← vignette de la galerie (générée)
public/themes/<slug>/thumb.json        ← empreinte du thème au moment de la vignette
```

Le dossier **est** le thème : il est découvert automatiquement. Le registre
`src/themes/presets/registry.generated.ts` (imports statiques, nécessaires à
Next) est régénéré par les scripts ; `npm test` échoue s'il est périmé.
Aucune autre liste à tenir à jour (seed, scripts de captures, contraste…).

## 2. Les 10 minutes

```bash
npm run theme:new -- aquarelle --from planche-de-story --name "Aquarelle"
#   → src/themes/presets/aquarelle/theme.ts (copie, id et nom remplacés)
#   → public/themes/aquarelle/ (copie des calques, chemins réécrits)
#   → registre régénéré
```

1. **Écrire la direction** en une phrase dans l'en-tête de `theme.ts`.
2. **Couleurs** (`tokens.color`) : `bg`, `bgDeep`, `surface` sont les fonds ;
   `ink`, `inkSoft`, `eyebrow`/`secondary`, `primary` sont des textes posés sur
   ces trois fonds (4,5:1 exigé partout) ; `onPrimary` sur `primary`.
   `heroHalo` (souvent = `bg`) pour un hero à calques ; `accentGlow` pour le
   faisceau du hero `spotlight`.
3. **Polices** (`tokens.font`) : un id du catalogue (`FONT_IDS` du schéma).
4. **Variantes** : `header` (inline, centered), `hero` (parallax-layers,
   spotlight, type-only), `strip` (edge, taped), `caption` (mono-split,
   handwritten), `lightbox` (passe-partout, full-bleed), `button` (pill,
   square), `texture` (none, paper-dots).
5. **Compacité** : `space.sectionGap`, `space.pageMax`, `space.gutter`.
   Les thèmes v0.14 sont plus serrés que Pro (`sectionGap` 2,5–5,5 rem).
6. Vérifier :

```bash
npm run theme:check -- aquarelle     # schéma strict, contraste, polices, calques, vignette
# serveur dev REDÉMARRÉ (un thème livré entre en base au démarrage), puis :
PORT=3001 npm run theme:thumbs -- aquarelle      # vignette (échoue sur erreur console)
PORT=3001 npm run check:contrast:render -- aquarelle   # contraste mesuré au pixel
PORT=3001 node scripts/check-hero-overlap.mjs aquarelle  # titre et décor ne se recouvrent jamais (1280, 1440, 1920, 390)
THEMES=aquarelle SHOTS=/tmp/shots PORT=… node scripts/e2e-themes.mjs  # 4 vues, 2 tailles
```

`theme:check --render` enchaîne contrôles statiques et rendu des vignettes.

### Au démarrage du serveur

`syncPresets` (`src/lib/db/seed.ts`) ajoute en base les thèmes livrés
absents et met à jour ceux dont le code a changé (un thème livré n'est pas
modifiable dans l'admin : le code fait foi). Un thème personnel qui porterait
le même identifiant n'est jamais écrasé (avertissement dans le journal).

### Calques du hero (`parallax-layers`)

Cinq SVG 1600 × 900 (`preserveAspectRatio="xMidYMid slice"`), du fond vers
l'avant ; le texte du hero occupe le **bas gauche** : y garder un fond calme
(la mesure au pixel l'exige). Le titre (le nom, 9 rem) peut monter jusqu'à y ≈ 380 et
x ≈ 1190 de la toile à 1280 px ; seule la bande x 110–1490 est visible sur
ordinateur. `check-hero-overlap.mjs` le vérifie à quatre largeurs. Les calques de `planche-de-story` et
`fanzine-riso` sont produits par un générateur déterministe (motifs SVG plutôt
que des milliers de points : 1 à 9 Ko par calque).

### Ajouter une police

Le catalogue est partagé par tous les thèmes. Une police = **4 endroits** (next/font
exige des appels littéraux) : `FONT_IDS` (`schema.ts`), `font-stacks.ts`
(pile, graisse de titre), `fonts.ts` (appel next/font, `preload: false`) et
`src/lib/kit/fonts.ts` + le TTF statique OFL et sa licence dans
`public/kit/fonts/` (signature du kit Photoshop ; `npm test` le vérifie).
Polices OFL uniquement.

### Tokens des lots 2 et 4 (facultatifs)

Les intentions écrites en en-tête des thèmes v0.14 sont reportées dans ces
blocs (absents = rendu d'avant) :

- `tokens.palette.auto` (lot 4) : nuances enregistrées (`bgDeep`, `line`,
  `inkSoft`, `primaryHover`, `onPrimary`) dérivées de leur base ; leur valeur
  dans `tokens.color` doit être la valeur dérivée (`test-palette` le vérifie).
  Garder « choisie » une nuance qui fait le caractère du thème (filet
  translucide, encre teintée).
- `tokens.layout` (lot 2) : crans d'espace S–XL, `pageTop`, `stripPad`,
  `mediaRadius` (arrondi des images), `heroRoleBackdrop` (fond du métier).
- `tokens.type` (intégration) : styles par rôle (`h1`, `h2`, `eyebrow`,
  `body`, `caption`, `menu`, `brand`) avec les sélecteurs des styles du site
  du lot 2 : police du thème (`display|body|caption`), graisse, italique,
  casse, interlettrage. Émis dans `<style id="theme">` ; ordre : thème < styles
  du site < réglage du texte. Pas de police Google (un thème exporté doit
  rester autonome).

## 3. Export / import (Admin → Thèmes)

« Exporter » télécharge `theme-<id>.zip` :

```
theme.json                         { "format": "portfolio-theme", "version": 1, "theme": {…} }
assets/<sha256 16>.<svg|avif|webp|png>  éléments dessinés du kit référencés par le thème (png : curseurs)
```

« Importer un thème… » crée une **copie non livrée**, renommée si le nom
existe (« (importé) »), jamais mise en ligne d'office.

Protections (c'est une surface d'envoi ; `src/lib/themes/`) :

- route `POST /admin/api/themes/import` : `assertAdmin()`, même origine,
  réception en flux plafonnée à **12 Mo** (refus dès le `Content-Length`) ;
- archive lue défensivement (`zip.ts`) : **40 fichiers** au plus, **6 Mo** par
  fichier et **30 Mo** au total une fois décompressés, taux de compression
  ≤ 60, décompression plafonnée à la taille déclarée (bombe arrêtée à la
  borne), CRC vérifié ; refus des chemins absolus, `..`, `\`, doublons,
  zip64, chiffrement, méthodes autres que stockage/deflate ;
- seuls `theme.json` et `assets/<hash>.<svg|avif|webp|png>` sont acceptés ;
- `theme.json` : enveloppe stricte, schéma zod du thème **sans clé inconnue**
  (aucun CSS libre : chaque valeur est filtrée par le schéma), contraste AA ;
  palette (lot 4) normalisée (nuances « auto » recalculées, jamais la valeur
  de l'archive) et texte sur le voile de la visionneuse ≥ AA ; la mise en
  page (lot 2) et la typographie du thème voyagent avec lui (les styles du
  SITE et les polices Google téléchargées n'en font pas partie : ce sont des
  réglages du site) ;
- calques du hero : uniquement des fichiers déjà livrés avec le site ;
- éléments dessinés : AVIF/WebP vérifiés par signature (magic bytes) et
  en-tête (`sharp().metadata()`, sans décodage, ≤ 4096 × 4096 px) ; PNG
  uniquement pour les curseurs (lot 4), exactement 32 × 32 (1x) et 64 × 64
  (2x) ; SVG en
  liste blanche (aucun script, gestionnaire, DOCTYPE, `<style>`, image ni
  lien externe) ; chaque fichier ré-adressé par **son propre hash**, qui doit
  correspondre à son nom ; servis par `/media` avec la CSP `sandbox`.

Tests : `scripts/test-theme-zip.mjs` (npm test), section **TH** de
`npm run test:auth`, partie B de `scripts/e2e-themes.mjs` (16 archives
malveillantes, `scripts/lib/theme-packages.mjs`).

## Thèmes livrés

| Thème | Direction |
|---|---|
| Galerie lumineuse | défaut : papier chaud, paysage en calques |
| Pro | galerie neutre, étiquettes grises |
| Salle de projection | nuit bleue, faisceau ambre |
| Carnet d'atelier | carnet pointillé, planches scotchées, légendes manuscrites |
| **Planche de story** | feuille de storyboard sur kraft : cases au graphite, crayons bleu et rouge, titres au feutre, texte tapé |
| **Salle de montage** | table de montage vert-noir, pistes sarcelle, crayon gras jaune, capitales condensées de clap |
| **Studio** | planche-contact de studio : nom en très grand sur une grille au filet, photogrammes gris dont la prise retenue en cobalt ; le plus compact |
| **Fanzine riso** | couverture de zine en risographie : papier jaune, bleu et rose fluo décalés, trames, collage scotché |
