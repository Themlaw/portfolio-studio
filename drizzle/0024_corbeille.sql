ALTER TABLE `media` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `pages` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `pages` ADD `trashed_in_menu` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `deleted_at` integer;--> statement-breakpoint
-- Une collection n'a qu'une page DU SITE : l'index unique ignore les pages à la corbeille (elles gardent leur collection).
DROP INDEX `pages_collection_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `pages_collection_unique` ON `pages` (`collection`) WHERE "pages"."deleted_at" is null;
