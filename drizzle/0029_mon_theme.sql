ALTER TABLE `themes` ADD `mine` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `themes` ADD `based_on` text;--> statement-breakpoint
ALTER TABLE `themes` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `themes` ADD `published_version` integer;--> statement-breakpoint
ALTER TABLE `themes` ADD `live_data` text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `theme_versions` (
	`theme_id` text NOT NULL,
	`n` integer NOT NULL,
	`data` text NOT NULL,
	`source` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`sealed` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`theme_id`, `n`)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `themes_one_mine` ON `themes` (`mine`) WHERE `mine` = 1;
