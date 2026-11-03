CREATE TABLE `instructor_memo_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`memo_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`content_html` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`memo_id`) REFERENCES `instructor_memos`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "instructor_memo_revisions_payload_check" CHECK("instructor_memo_revisions"."revision_number" >= 1
        AND length("instructor_memo_revisions"."content_html") <= 200000
        AND "instructor_memo_revisions"."created_at" <= "instructor_memo_revisions"."updated_at")
);
--> statement-breakpoint
CREATE INDEX `instructor_memo_revisions_memo_created_idx` ON `instructor_memo_revisions` (`memo_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `instructor_memos` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`note_id` text,
	`content_html` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by_id` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`note_id`) REFERENCES `private_notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "instructor_memos_payload_check" CHECK("instructor_memos"."version" >= 1
        AND length("instructor_memos"."content_html") <= 200000
        AND "instructor_memos"."created_at" <= "instructor_memos"."updated_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instructor_memos_note_unique` ON `instructor_memos` (`note_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `instructor_memos_student_unique` ON `instructor_memos` (`student_id`) WHERE "instructor_memos"."note_id" IS NULL;