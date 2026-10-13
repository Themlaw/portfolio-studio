-- 0019 (v0.17) : migration de CONTENU seulement (aucune colonne) : les blocs Image pleine
-- largeur à format imposé déjà présents gardent « cover » (le défaut des blocs neufs devient
-- « contain »). Jouée par src/lib/db/upgrade.ts (pinImageFit) juste après ce fichier
-- (src/lib/db/bootstrap.ts, DATA_MIGRATIONS), dans la même transaction.
SELECT 1;
