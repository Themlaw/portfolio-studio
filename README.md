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

Tests : `npm test` (statique, inclut la garde des server actions) ;
`npm run build:local && npm run test:auth` (intégration sur le build standalone, faux
fournisseur OIDC local, serveur dev arrêté).

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
