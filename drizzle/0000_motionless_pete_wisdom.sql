CREATE TABLE `leaderboard_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`teams_json` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
