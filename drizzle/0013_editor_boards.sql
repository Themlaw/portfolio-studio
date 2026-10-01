ALTER TABLE `projects` ADD `draft_page_id` integer REFERENCES pages(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `slots` ADD `draft_title` text;--> statement-breakpoint
ALTER TABLE `slots` ADD `draft_description` text;--> statement-breakpoint
ALTER TABLE `slots` ADD `draft_key` text;