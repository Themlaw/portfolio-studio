-- 0014 (v0.13) : migration de CONTENU seulement (aucune colonne) : conteneurs
-- « Projet mis en avant », grilles de vidéos, planches posées une à une, menu
-- en réglage `nav`. Jouée par src/lib/db/upgrade.ts juste après ce fichier
-- (src/lib/db/bootstrap.ts, DATA_MIGRATIONS), dans la même transaction.
SELECT 1;
