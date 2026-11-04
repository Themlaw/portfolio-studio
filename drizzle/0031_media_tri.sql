-- 0031 (lot 112 « Tri des médias ») : trois colonnes NULLABLES sur media, AJOUT seulement (rien n une ligne existante n est réécrit).
--  last_import_at : date (ms) du dernier envoi du contenu (un envoi d un contenu déjà présent le remonte en tête de « Ajouté récemment ») ;
--                   null = jamais renvoyé : la date d ajout (created_at) fait foi.
--  taken_at       : date de création du fichier (EXIF DateTimeOriginal / CreateDate, PNG, création vidéo), ms UTC ; null = inconnue.
--  taken_checked  : 1 quand l original a été lu pour cette date (lecture paresseuse des anciens médias) ; null = pas encore lu.
ALTER TABLE media ADD COLUMN last_import_at integer;--> statement-breakpoint
ALTER TABLE media ADD COLUMN taken_at integer;--> statement-breakpoint
ALTER TABLE media ADD COLUMN taken_checked integer;
