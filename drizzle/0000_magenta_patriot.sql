CREATE TABLE `assistant_briefs` (
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_hash` text NOT NULL,
	`source_at` text,
	`generated_at` integer NOT NULL,
	`version` text NOT NULL,
	`report_json` text NOT NULL,
	PRIMARY KEY(`owner_id`, `kind`)
);
