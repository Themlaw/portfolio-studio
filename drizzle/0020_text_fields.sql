-- 0020 (v0.18) : migration de CONTENU seulement (aucune colonne) : dans les blocs Texte, un titre ou une
-- étiquette VIDE (les deux langues) est retiré : un champ n'existe que s'il a été demandé (plus de place
-- réservée sur la toile pour un titre jamais saisi ; le rendu public ne change pas, un champ vide n'y
-- était déjà pas rendu). Jouée par src/lib/db/upgrade.ts (dropEmptyTextFields) juste après ce fichier
-- (src/lib/db/bootstrap.ts, DATA_MIGRATIONS), dans la même transaction.
SELECT 1;
