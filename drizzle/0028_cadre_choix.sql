-- 0028 (lot 62 « Cadres des photos et des vidéos ») : migration de CONTENU seulement (aucune colonne) : le cadre d une photo passe de
-- l ancienne forme { size, color } à UN choix { kind: none | theme | band | custom, color?, width? } (« Sans cadre » -> Aucun, une épaisseur
-- -> Bande de couleur de la même épaisseur et couleur). Jouée par src/lib/db/frame-choice.ts (seedFrameChoices) juste après ce fichier
-- (src/lib/db/bootstrap.ts, DATA_MIGRATIONS), dans la même transaction. Le numéro 0028 est laissé à un autre lot.
SELECT 1;
