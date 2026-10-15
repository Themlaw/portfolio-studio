-- 0023 (v0.20, lot 27) : migration de CONTENU seulement (aucune colonne) :
--  - « Formulaire de contact » (contact-form) → « Contact » avec l'option formulaire (form: true), mêmes réglages ;
--  - champs facultatifs vides des blocs Grille, Contact, Profil et CV : retirés (un champ n'existe que s'il a été demandé) ;
--  - blocs anciens restés dans un brouillon : migrations 0014, 0021 et 0022 rejouées (idempotentes).
-- Publiée ET brouillons (draft_rev + 1). Jouée par src/lib/db/blocs.ts (mergeBlocks) juste après ce fichier
-- (src/lib/db/bootstrap.ts, DATA_MIGRATIONS), dans la même transaction.
SELECT 1;
