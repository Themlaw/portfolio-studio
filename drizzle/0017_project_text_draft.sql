ALTER TABLE `projects` ADD `draft_text` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `draft_text_page_id` integer REFERENCES pages(id) ON DELETE set null;