-- 0018 (v0.16) : migration de CONTENU seulement (aucune colonne) : le nom du site
-- devient fr / en (réglage `site`, et brouillon du site `siteDraft`). Jouée par
-- src/lib/db/upgrade.ts (siteNameI18n) juste après ce fichier
-- (src/lib/db/bootstrap.ts, DATA_MIGRATIONS), dans la même transaction.
SELECT 1;
