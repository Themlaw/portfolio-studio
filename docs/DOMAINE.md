# Changer de domaine sans casser les anciens liens

Le site change d'adresse. Le **nouveau** domaine devient l'adresse du site. L'**ancien** (par exemple `portfolio.example.org`) continue de marcher : toute visite y est renvoyée automatiquement vers **la même page** du nouveau domaine. Les liens déjà diffusés (réseaux, cartes de visite, Google, liens de partage et de recadrage) ne cassent donc jamais, et il n'y a qu'un seul site pour la connexion et pour Google.

Tout se règle avec deux variables du fichier `.env` (ou de l'onglet Environment de Komodo) :

| Variable | À mettre | Exemple |
|---|---|---|
| `PUBLIC_BASE_URL` | l'adresse du **nouveau** domaine, avec `https://`, sans `/` à la fin | `https://www.nouveau-site.fr` |
| `REDIRECT_FROM` | le ou les **anciens** domaines, noms seuls, séparés par des virgules | `portfolio.example.org` |

Sans `REDIRECT_FROM` (absente ou vide), rien ne change : le site se comporte exactement comme avant.

## Les étapes, dans cet ordre

Fais les étapes 1 à 3 **avant** de redémarrer le site (étape 4) : ainsi le nouveau domaine est prêt à répondre dès le redémarrage.

### 1. DNS du nouveau domaine

Chez le registrar du nouveau domaine, crée l'enregistrement qui pointe vers le VPS Pangolin, comme pour l'ancien domaine : un enregistrement `A` (et `AAAA` si l'ancien en a un) vers la même adresse IP que celle de l'ancien domaine. Attends que `nslookup nouveau-site.fr` réponde l'adresse du VPS (quelques minutes à quelques heures).

### 2. Pangolin

1. **Garde la ressource de l'ancien domaine.** Ne la supprime pas : c'est elle qui permet aux anciens liens d'arriver jusqu'au site pour être redirigés.
2. Ajoute le **nouveau domaine sur la même cible** : dans Pangolin, crée une ressource HTTP avec le nouveau domaine, sur le même site (Newt) et la même cible (même adresse et même port que la ressource de l'ancien domaine). Reprends les mêmes réglages que l'ancienne (en particulier : pas d'authentification Pangolin devant le site public, comme avant).
3. Pangolin obtient tout seul un certificat Let's Encrypt pour chacun des deux domaines. Il faut que le DNS (étape 1) soit en place, sinon le certificat du nouveau domaine échoue. Vérifie que `https://nouveau-site.fr` répond (le site s'affiche encore avec l'ancienne adresse dans ses balises : c'est normal tant que l'étape 4 n'est pas faite).

### 3. Authentik (si tu te connectes avec Authentik)

Authentik doit connaître l'adresse de retour du nouveau domaine, sinon la connexion échoue avec une erreur de « redirect URI ».

1. Authentik → *Applications* → *Providers* → le provider du portfolio → *Edit*.
2. Dans *Redirect URIs/Origins* (mode *strict*), **ajoute** cette ligne (sans retirer l'ancienne tant que tout n'est pas vérifié) :
   `https://nouveau-site.fr/api/auth/callback/authentik`
   C'est toujours `PUBLIC_BASE_URL` + `/api/auth/callback/authentik`.
3. Les autres variables ne bougent pas. `AUTH_OIDC_ISSUER`, `AUTH_OIDC_CLIENT_ID`, `AUTH_OIDC_CLIENT_SECRET`, `AUTH_ADMIN_GROUP` (ou `AUTH_ADMIN_SUBS`, `ADMIN_EMAILS`) et `BETTER_AUTH_SECRET` restent identiques : l'adresse d'Authentik (`auth.example.org`) n'est pas concernée par le changement. Ne change **pas** `BETTER_AUTH_SECRET` (les liens de recadrage déjà diffusés en dépendent).

Connexion par mot de passe seulement : il n'y a rien à faire dans Authentik.

### 4. Les deux variables, puis redémarrage

Dans le `.env` :

```
PUBLIC_BASE_URL=https://nouveau-site.fr
REDIRECT_FROM=portfolio.example.org
```

Puis redémarre le site (Komodo : *Redeploy* de la stack, ou `docker compose up -d`). Pour plusieurs anciens domaines : `REDIRECT_FROM=portfolio.example.org,www.ancien.fr`.

Tolérances : les majuscules, les espaces et les virgules en trop ne gênent pas. Si tu écris par erreur `https://portfolio.example.org/`, le site corrige tout seul (il retire le `https://`, la barre finale, un port ou un chemin), te prévient dans le journal du conteneur (ligne `[domaine]`) et dans Admin → Réglages → Diagnostic.

### 5. Vérifier

- Ouvre l'ancienne adresse avec un chemin : `https://portfolio.example.org/fr/personnages?x=1` doit arriver sur `https://nouveau-site.fr/fr/personnages?x=1`.
- En terminal : `curl -sI https://portfolio.example.org/fr/personnages` affiche `301` et une ligne `location: https://nouveau-site.fr/fr/personnages`.
- Admin → Réglages → Diagnostic : la ligne « Domaines redirigés vers l'adresse principale (REDIRECT_FROM) » liste l'ancien domaine, et « URL publique » affiche le nouveau.
- `https://nouveau-site.fr/sitemap.xml` et `https://nouveau-site.fr/robots.txt` ne citent que le nouveau domaine.

## Ce qui change pour toi

- **Il faut se reconnecter une fois** sur le nouveau domaine. La session est attachée au domaine (les cookies sont par domaine) : celle de l'ancien domaine ne suit pas. Après la reconnexion, rien d'autre à faire. Ouvre toujours l'admin par le nouveau domaine : un onglet resté ouvert sur l'ancien est renvoyé vers le nouveau.
- **Les liens déjà diffusés** passent par la redirection : pages (fr et en), liens de partage, images et recadrages (`/media/...`), `favicon`, plan du site. Le chemin et tout ce qui suit le `?` sont conservés. Les formulaires et envois (POST) sont renvoyés avec le code 308, qui conserve le contenu envoyé.
- **Google** : le code 301 dit « adresse changée pour toujours ». Pour accélérer : dans Google Search Console, ajoute le nouveau domaine comme propriété, envoie `https://nouveau-site.fr/sitemap.xml`, puis utilise l'outil « Changement d'adresse » sur l'ancienne propriété. Garde l'ancien domaine (et sa redirection) au moins un an.
- **Adresses dans les pages** : canonical, hreflang, partage (`og:url`), plan du site, `robots.txt` suivent `PUBLIC_BASE_URL`.

## Ce qui n'est pas redirigé

- Les fichiers internes de Next (`/_next/...`) et les envois de fichiers de l'admin (`/admin/api/...`) : ils ne servent qu'une fois la page ouverte, donc sur le nouveau domaine.
- Un hôte qui n'est pas dans `REDIRECT_FROM` (le nouveau domaine, `localhost`, une adresse IP, les contrôles de santé internes) est servi normalement. Si `REDIRECT_FROM` contient par erreur le nouveau domaine, cette entrée est ignorée (erreur dans le journal et le Diagnostic) : le site ne peut jamais tourner en boucle.
- Si `PUBLIC_BASE_URL` n'est pas défini, `REDIRECT_FROM` est ignoré (erreur dans le journal) : le site ne sait pas où renvoyer.

## Revenir en arrière

1. Retire la ligne `REDIRECT_FROM` (ou laisse-la vide).
2. Remets `PUBLIC_BASE_URL` à l'ancienne adresse.
3. Redémarre le site. L'ancien domaine répond de nouveau normalement. Si tu avais retiré l'ancienne adresse de retour dans Authentik, remets-la.

Les navigateurs gardent la redirection en mémoire au plus une heure ; l'ancien domaine peut donc encore les renvoyer vers le nouveau pendant ce temps. Google, lui, peut garder le nouveau domaine plus longtemps. Rien n'est perdu côté données : la base et les images ne dépendent pas du domaine. Tu peux garder la ressource Pangolin du nouveau domaine en attendant.

## En cas de problème

| Symptôme | Cause probable |
|---|---|
| L'ancien domaine ne redirige pas | `REDIRECT_FROM` mal écrit ou site non redémarré ; regarde Diagnostic et le journal (`[domaine]`) |
| Le nouveau domaine affiche une erreur de certificat | DNS pas encore propagé, ou ressource Pangolin du nouveau domaine absente |
| « redirect URI » invalide à la connexion Authentik | l'adresse de retour du nouveau domaine manque dans Authentik (étape 3) |
| Connexion refusée (403) | `PUBLIC_BASE_URL` ne correspond pas à l'adresse tapée dans le navigateur |
| Le journal dit « est le domaine principal… entrée ignorée » | tu as mis le nouveau domaine dans `REDIRECT_FROM` : retire-le |
| Le journal dit « PUBLIC_BASE_URL n'est pas défini » | ajoute `PUBLIC_BASE_URL=https://nouveau-site.fr` |
