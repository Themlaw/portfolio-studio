# Journal d'édition (lot 97)

Constat de départ : en production, le conteneur n'avait écrit que 41 lignes en 3 jours. Impossible de savoir qui a modifié quoi, quand, ni
pourquoi une valeur a changé. Le journal répond à ces trois questions, sans jamais enregistrer de secret.

## Ce qui est journalisé

Chaque écriture de l'admin ajoute **une entrée** : heure, utilisateur (identifiant interne, jamais l'e-mail), page, cible, type, version de
la page avant → après, résultat (`ok`, `refus`, `conflit`, `erreur`), durée, version de l'application, et un **résumé** : chemins des champs
modifiés et valeurs COURTES (80 caractères au plus). Jamais de contenu de média, de mot de passe, de jeton, d'e-mail ni de corps de message.

- Server actions d'écriture (74) et routes d'écriture (envoi de fichier, fin d'envoi par morceaux, annulation, import de thème, import de
  cadre) : une enveloppe commune, `audited()` / `auditedRoute()` (`src/lib/journal/audit.ts`). Pas une ligne par action : l'action
  s'écrit `export const nomAction = audited("nomAction", async function nomAction(…) { await assertAdmin(); … })`.
- **Les lectures ne sont pas enveloppées** : aucun bruit. Une action nouvelle qui écrit et qui n'est pas enveloppée fait échouer
  `scripts/test-journal97.mjs` (inventaire statique) ; une lecture se déclare dans sa liste `READS`.
- Chaque nom d'action a une entrée du **catalogue** (`catalog.ts` : libellé français, type, où lire la page et la version). Sans entrée, le
  test échoue aussi.
- Brouillon (`saveDraftAction`) : l'état d'AVANT est lu (une requête) et comparé à ce qui est envoyé ; en-tête / pied / réseaux : le résultat
  de l'action porte déjà avant et après. D'où des entrées lisibles : « Nom du site modifié depuis la page Décors : brouillon ».
- Navigateur : erreurs JS non rattrapées, rejets de promesses, échecs d'enregistrement (refus, conflit, connexion perdue) partent vers
  `POST /api/log` (`src/lib/journal/browser.ts`, monté par `JournalReporter` dans la racine de l'admin ; `VisualEditor` signale ses échecs).
  Session admin obligatoire (401), même origine (403), corps de 8 Ko au plus (413), 40 événements par minute et par utilisateur (429).
  L'entrée porte la page, le chemin et la version du CLIENT (un onglet resté ouvert sur une ancienne version se voit).

## Où c'est écrit

- **Table `edit_log` dans une base SQLite à part : `${DATA_DIR}/edit-log.db`** (aucune migration SQL, aucune table dans le schéma du site).
  Raisons : (1) les sauvegardes détectent « il y a eu une modification » par `PRAGMA data_version` sur portfolio.db : une ligne de journal
  (un refus, une erreur du navigateur) ne doit pas déclencher une sauvegarde ; (2) pas de verrou partagé avec les écritures de l'artiste ;
  (3) **le journal n'entre pas dans les archives** (elles prennent portfolio.db, media/ et fonts/) et **une restauration le laisse intact** :
  c'est exactement ce qui permet de comprendre ce qui s'est passé avant et après la restauration.
- **Rétention : 30 jours ou 20 000 lignes** (la plus stricte), purge à l'ouverture, toutes les 500 écritures et toutes les 10 minutes.
  Réglable pour les tests : `EDIT_LOG_MAX_ROWS`, `EDIT_LOG_MAX_DAYS`.
- **stdout** : une ligne JSON courte par écriture, pour `docker logs` :
  `{"t":"edit","at":"…","a":"saveDraftAction","type":"modification","r":"ok","u":"<id interne>","page":2,"rev":"1>2","ms":7.2,"v":"0.31.1","aud":0.17,"bg":1.9,"s":"Bloc « Texte » modifié depuis la page Personnages : brouillon","id":1}`
  (`aud` : ms pris par le journal sur le chemin de la requête, `bg` : ms pris après la réponse). Erreurs du navigateur : `{"t":"client",…}`.
- **Coût** : sur le chemin de la requête, une lecture (le brouillon d'avant, pour `saveDraftAction`) et la mise en file : médiane 0,17 ms ; le résumé, le titre
  de la page et l'écriture SQLite se font APRÈS la réponse (`after` de Next) : médiane 2 ms en différé, que l'artiste n'attend pas. Tout est dans des `try/catch` :
  le journal ne casse jamais une action. Mesures : `lot97-rapport.md`.

## Écran Admin > Journal

Réglages → « Ouvrir le journal » (et sous-entrée du menu, sous Sauvegardes). Liste filtrable (page, type, résultat, dates), plus récente
d'abord, 100 entrées par page ; chaque ligne se déplie (type, page, version de la page, compte, durée, version du site, nom technique,
ce qui change). Code : `src/app/admin/(espace)/journal/page.tsx` (formulaire GET, pas de JavaScript client).

## Tests

`scripts/test-journal97.mjs` (unitaire, dans `npm test`) : masquage, différences, phrases, rétention, enveloppe, événements du navigateur,
inventaire statique. `scripts/e2e-journal97.mjs` (suite `journal97`) : modification de texte, nom du site, publication, abandon, conflit,
erreurs JS, réglage, absence de secret dans la table et sur stdout, lectures sans bruit, `/api/log`, écran et filtres.
