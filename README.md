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

- Choix : `PORTFOLIO_THEME=<id>`. En production les pages sont prérendues :
  la variable est lue **au moment du build** (phase 2 : thème en base).
- Aperçu (dev, ou `THEME_PREVIEW=1` au build) : ouvrir
  `/api/theme-preview?id=<id>` ; `?id=` rétablit le thème configuré.
- Contrôles : `npm run check:tokens` (aucune couleur en dur hors `src/themes/`),
  `npm run check:contrast` (AA ≥ 4,5:1 des tokens pour chaque preset), bloquants
  en CI ; `PORT=3001 npm run check:contrast:render` (contraste mesuré au pixel sur
  le rendu, serveur dev requis), obligatoire en local avant de valider un thème.

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
- `/data` : volume inscriptible (SQLite, médias à venir), possédé par uid 1000 ;
- `.next/cache` : inutilisé aujourd'hui (pages statiques). Si l'ISR/le cache
  fetch arrive, monter un tmpfs : `/app/.next/cache:size=64m,uid=1000,gid=1000` ;
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
