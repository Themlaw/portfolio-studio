# Sécurité

## Signaler une faille

Merci de **ne pas ouvrir de ticket public** pour une faille de sécurité. Utilisez le signalement privé de GitHub
(onglet *Security* → *Report a vulnerability*) ou écrivez au mainteneur du dépôt (adresse sur son profil GitHub).
Indiquez la version (étiquette `vX.Y.Z` ou SHA), les étapes pour reproduire et l'impact observé. Une réponse
est donnée sous une semaine ; une correction est publiée dès qu'elle est prête, avec mention (si souhaitée).

## Périmètre

- l'application (routes publiques, `/admin`, API d'envoi de médias, import de thèmes et de kits Photoshop) ;
- l'image Docker et son fichier `docker-compose.yml` ;
- les workflows GitHub Actions de ce dépôt.

Hors périmètre : une instance mal configurée par son exploitant (secret faible, `PUBLIC_BASE_URL` absente…).

## Ce que le dépôt ne contient pas

Aucun secret, aucune donnée de production, aucune œuvre réelle : les fixtures et le jeu de démonstration sont
synthétiques. Un contrôle automatique (`npm run audit:public`, job `hygiene` de la CI) vérifie tout l'historique ;
si vous trouvez malgré tout un secret ou une donnée privée, signalez-le comme une faille (ci-dessus).

## Bonnes pratiques de configuration

- `BETTER_AUTH_SECRET` : au moins 32 caractères aléatoires, propre à chaque instance (jamais celui d'un exemple).
- Définir `PUBLIC_BASE_URL` (https) en production, et limiter l'administration à des comptes ou groupes connus.
- Garder l'image à jour (`pull_policy: always` dans `docker-compose.yml`) et activer les alertes Dependabot.
