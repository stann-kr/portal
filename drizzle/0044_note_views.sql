CREATE TABLE `note_views` (
	`note_id` text NOT NULL,
	`student_id` text NOT NULL,
	`last_viewed_at` integer NOT NULL,
	PRIMARY KEY(`note_id`, `student_id`),
	FOREIGN KEY (`note_id`) REFERENCES `private_notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `note_views_student_idx` ON `note_views` (`student_id`);