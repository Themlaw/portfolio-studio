CREATE TABLE `auth_throttle` (
	`email` text PRIMARY KEY NOT NULL,
	`failures` integer NOT NULL,
	`first_at` integer NOT NULL,
	`last_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oidc_identity` (
	`sub` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`email` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`groups` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL
);
