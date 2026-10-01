ALTER TABLE `pages` ADD `draft_rev` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `slots` ADD `draft_page_id` integer REFERENCES pages(id) ON DELETE set null;