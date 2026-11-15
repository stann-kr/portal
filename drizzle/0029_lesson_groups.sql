CREATE TABLE `lesson_group_members` (
	`student_id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`joined_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `lesson_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lesson_group_members_group_idx` ON `lesson_group_members` (`group_id`);--> statement-breakpoint
CREATE TABLE `lesson_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	CONSTRAINT "lesson_groups_payload_check" CHECK(length("lesson_groups"."id") > 0 AND length(trim("lesson_groups"."name")) BETWEEN 1 AND 60 AND "lesson_groups"."created_at" <= "lesson_groups"."updated_at")
);
--> statement-breakpoint
ALTER TABLE `private_notes` ADD `group_id` text REFERENCES lesson_groups(id) ON UPDATE no action ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `private_notes_group_deleted_created_idx` ON `private_notes` (`group_id`,`deleted_at`,`created_at`);