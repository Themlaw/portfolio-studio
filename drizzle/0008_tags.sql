CREATE TABLE `media_tags` (
	`media_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`media_id`, `tag_id`),
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `media_tags_tag_idx` ON `media_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_key_idx` ON `tags` (`key`);--> statement-breakpoint
ALTER TABLE `uploads` ADD `tags` text DEFAULT '[]' NOT NULL;