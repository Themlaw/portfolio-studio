-- 0021 (v0.19) : colonne `pages.collection` (collection présentée par la page, unique) puis migration de CONTENU
-- jouée par src/lib/db/upgrade.ts (collectionPages) juste après ce fichier (src/lib/db/bootstrap.ts, DATA_MIGRATIONS),
-- dans la même transaction : réglage de chaque page depuis son « En-tête de collection », « Entrées des collections »
-- en automatique si la liste suit déjà les pages de collection, « En-tête de collection » → « Titre ».
ALTER TABLE `pages` ADD `collection` text;--> statement-breakpoint
CREATE UNIQUE INDEX `pages_collection_unique` ON `pages` (`collection`);