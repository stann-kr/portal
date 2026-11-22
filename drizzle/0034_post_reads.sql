CREATE TABLE `post_reads` (
	`post_id` text NOT NULL,
	`student_id` text NOT NULL,
	`first_read_at` integer NOT NULL,
	PRIMARY KEY(`post_id`, `student_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_reads_student_idx` ON `post_reads` (`student_id`);