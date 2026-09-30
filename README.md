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
PORT=3001 node verify.mjs   # harnais de régression Playwright (serveur dev lancé)
```

Les scripts Playwright ponctuels (captures, contrôles) sont dans `scripts/`.

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

## Déploiement

Flux : **push GitHub → GitHub Actions → GHCR (privé) → Komodo sur hote-prod**.

1. `.github/workflows/docker.yml` se déclenche sur push `main`, sur les tags
   `v*` / `da/*` et à la main (`workflow_dispatch`) :
   - job `check` : `npm ci`, `tsc --noEmit`, `npm run lint`, `check:tokens`,
     `check:contrast` ;
   - job `image` : build buildx `linux/amd64` (cache `gha`), push sur
     `ghcr.io/themlaw/portfolio` avec les tags `latest` (main),
     `sha-<court>` et le nom du tag git nettoyé (`da/pro` → `da-pro`).
2. Sur hote-prod, la stack Komodo (`compose.yaml`, service `portfolio`,
   `pull_policy: always`) tire l'image ; un redeploy prend la dernière `latest`.
   Pour épingler une version : `PORTFOLIO_IMAGE=ghcr.io/themlaw/portfolio:da-pro`.
3. Newt (Pangolin) joint le conteneur sur le réseau `traefik` : `http://portfolio:3000`.
   Aucun port publié.

### Image

`Dockerfile` multi-stage (`node:24-slim`, glibc) : `deps` (npm ci) → `builder`
(`next build`, sortie `standalone`) → `runner` (standalone + `.next/static` + `public`).

- utilisateur `node` (uid 1000), code possédé par root, compatible `read_only` ;
- `/data` : volume inscriptible (`portfolio.db`, `media/`), possédé par uid 1000 ;
  migrations et seed au premier démarrage ;
- `.next/cache` : inutilisé (ISR en mémoire) ; tmpfs de 16 Mo par précaution ;
- `npm ci --ignore-scripts` : better-sqlite3 13 embarque ses binaires N-API
  (`prebuilds/`), aucun script d'installation n'est nécessaire (sans Python
  dans l'image, `node-gyp` échouerait) ;
- `HEALTHCHECK` : `GET /fr` ;
- build-arg `NODE_MAX_OLD_SPACE` (défaut 1024 Mo, 4096 en CI) : plafond du tas
  pendant `next build`.

### Build local (test ponctuel uniquement)

Les images se construisent sur GitHub Actions. **Ne pas builder l'image sur la
VM de dev sauf test ponctuel** (l'hôte Proxmox est en surallocation de RAM) :

```bash
docker build -t portfolio:test .
docker run -d --name portfolio-test -p 3002:3000 --memory 512m \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  -v portfolio-test-data:/data portfolio:test
docker inspect -f '{{.State.Health.Status}}' portfolio-test
docker rm -f portfolio-test && docker volume rm portfolio-test-data
sync; echo 3 > /proc/sys/vm/drop_caches
```
