-- 0027 (lot 36 « Lecteur vidéo ») : migration de CONTENU seulement (aucune colonne) : chaque composant Vidéo reçoit
-- explicitement son mode de lecture (« loop » = Boucle, « player » = Lecteur). Jouée par src/lib/db/video-mode.ts
-- (seedVideoModes) juste après ce fichier (src/lib/db/bootstrap.ts, DATA_MIGRATIONS), dans la même transaction.
SELECT 1;
