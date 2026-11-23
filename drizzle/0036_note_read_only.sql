ALTER TABLE `private_note_revisions` ADD `contributor_ids` text;--> statement-breakpoint
ALTER TABLE `private_notes` ADD `student_read_only` integer DEFAULT false NOT NULL;