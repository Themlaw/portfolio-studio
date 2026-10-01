ALTER TABLE `jobs` ADD `run_after` integer;--> statement-breakpoint
ALTER TABLE `media` ADD `sha256` text;--> statement-breakpoint
CREATE UNIQUE INDEX `media_sha256_unique` ON `media` (`sha256`);