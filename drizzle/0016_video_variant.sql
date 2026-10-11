-- 0016 (intégration) : migration de CONTENU seulement (aucune colonne) : la
-- présentation du bloc Vidéo passe de `look` à `variant` (le lot 2 a donné à
-- `look` les réglages de mise en page de tous les blocs). Jouée par
-- src/lib/db/upgrade.ts (renameVideoLook) juste après ce fichier
-- (src/lib/db/bootstrap.ts, DATA_MIGRATIONS), dans la même transaction.
SELECT 1;
