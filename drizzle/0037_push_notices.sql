CREATE TABLE `post_reminders` (
	`post_id` text PRIMARY KEY NOT NULL,
	`last_reminded_at` integer NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `push_notice_recipients` (
	`notice_id` text NOT NULL,
	`student_id` text NOT NULL,
	`read_at` integer,
	PRIMARY KEY(`notice_id`, `student_id`),
	FOREIGN KEY (`notice_id`) REFERENCES `push_notices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `push_notice_recipients_student_idx` ON `push_notice_recipients` (`student_id`);--> statement-breakpoint
CREATE TABLE `push_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`request_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_reminded_at` integer,
	FOREIGN KEY (`author_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "push_notices_body_check" CHECK(length(trim("push_notices"."body")) BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_notices_request_unique` ON `push_notices` (`request_id`);--> statement-breakpoint
CREATE INDEX `push_notices_created_idx` ON `push_notices` (`created_at`);