ALTER TABLE `media` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `pages` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `pages` ADD `trashed_in_menu` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `deleted_at` integer;