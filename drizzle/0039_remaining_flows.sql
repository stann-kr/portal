CREATE TABLE `guide_page_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`page_version` integer NOT NULL,
	`title` text NOT NULL,
	`content_html` text NOT NULL,
	`reason` text NOT NULL,
	`actor_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `guide_pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "guide_page_revisions_reason_check" CHECK("guide_page_revisions"."reason" IN ('EDIT', 'RESTORE'))
);
--> statement-breakpoint
CREATE INDEX `guide_page_revisions_page_created_idx` ON `guide_page_revisions` (`page_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `qna_reply_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`reply_id` text NOT NULL,
	`edit_number` integer NOT NULL,
	`content_html` text NOT NULL,
	`editor_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`reply_id`) REFERENCES `qna_replies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`editor_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "qna_reply_revisions_number_check" CHECK("qna_reply_revisions"."edit_number" >= 1 AND length("qna_reply_revisions"."content_html") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qna_reply_revisions_reply_number_unique` ON `qna_reply_revisions` (`reply_id`,`edit_number`);--> statement-breakpoint
ALTER TABLE `guide_pages` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `guide_pages` ADD `deleted_by_id` text REFERENCES profiles(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `lesson_groups` ADD `dissolved_at` integer;