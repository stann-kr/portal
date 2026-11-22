CREATE TABLE `assignment_drafts` (
	`owner_id` text NOT NULL,
	`draft_key` text NOT NULL,
	`task_id` text,
	`payload_json` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `draft_key`),
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `assignment_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assignment_drafts_owner_task_idx` ON `assignment_drafts` (`owner_id`,`task_id`);