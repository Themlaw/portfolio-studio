ALTER TABLE `pages` ADD `draft` text;--> statement-breakpoint
ALTER TABLE `pages` ADD `draft_updated_at` integer;--> statement-breakpoint
ALTER TABLE `slots` ADD `draft_state` text;--> statement-breakpoint
ALTER TABLE `slots` ADD `draft_position` integer;--> statement-breakpoint
ALTER TABLE `slots` ADD `draft_media_id` integer REFERENCES media(id) ON DELETE set null;