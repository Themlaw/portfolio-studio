ALTER TABLE `projects` ADD `layout` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `draft_layout` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `draft_layout_page_id` integer REFERENCES pages(id) ON DELETE set null;
