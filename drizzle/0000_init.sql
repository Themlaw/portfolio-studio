CREATE TABLE `blocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`page_id` integer NOT NULL,
	`position` integer NOT NULL,
	`type` text NOT NULL,
	`props` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blocks_page_idx` ON `blocks` (`page_id`,`position`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`mime` text NOT NULL,
	`original_name` text,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`duration` real,
	`variants` text,
	`dominant_color` text,
	`alt` text,
	`status` text DEFAULT 'ready' NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_key_unique` ON `media` (`key`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`meta` text,
	`nav_order` integer,
	`published` integer DEFAULT true NOT NULL,
	`theme_overrides` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`context` text NOT NULL,
	`description` text NOT NULL,
	`year` text NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`position` integer NOT NULL,
	`media_id` integer,
	`slug` text NOT NULL,
	`collection` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`year` integer NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`duration` text,
	`video_id` text,
	`reel` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `slots_project_idx` ON `slots` (`project_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `slots_slug_idx` ON `slots` (`slug`);--> statement-breakpoint
CREATE TABLE `themes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`preset` integer DEFAULT false NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
