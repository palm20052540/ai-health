CREATE TABLE `brief_deliveries` (
	`subscription_id` text NOT NULL,
	`source_hash` text NOT NULL,
	`event_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	`status` text NOT NULL,
	`attempted_at` integer NOT NULL,
	PRIMARY KEY(`subscription_id`, `source_hash`)
);
--> statement-breakpoint
CREATE TABLE `brief_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`owner_gate` text NOT NULL,
	`callback_url` text NOT NULL,
	`signing_secret` text NOT NULL,
	`previous_secret` text,
	`rotation_until` integer,
	`verified_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
