-- 관리자 출제 과제(assignment_tasks)와 정기 과제 규칙(assignment_recurrences)을 추가한다.
-- 글 제출을 위해 assignments.media_url, 글 피드백을 위해 feedbacks.time_marker를 nullable로 바꾼다(table rebuild).
-- feedbacks는 FK가 없는 임시 table로 먼저 옮긴다. 옛 assignments를 지울 때 ON DELETE CASCADE가 피드백을 지우지 않게 하기 위해서다.
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
DROP TRIGGER `profiles_before_delete_document_history`;--> statement-breakpoint
CREATE TABLE `assignment_recurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`title` text NOT NULL,
	`description_html` text DEFAULT '' NOT NULL,
	`submission_format` text NOT NULL,
	`start_date` text NOT NULL,
	`interval_weeks` integer DEFAULT 1 NOT NULL,
	`weekdays` integer NOT NULL,
	`due_time` text NOT NULL,
	`end_date` text,
	`max_occurrences` integer,
	`paused_at` integer,
	`created_by_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "assignment_recurrences_format_check" CHECK("assignment_recurrences"."submission_format" IN ('MIX', 'TEXT', 'BOTH')),
	CONSTRAINT "assignment_recurrences_schedule_check" CHECK(length("assignment_recurrences"."title") > 0 AND length("assignment_recurrences"."start_date") = 10 AND length("assignment_recurrences"."due_time") = 5 AND "assignment_recurrences"."interval_weeks" BETWEEN 1 AND 12 AND "assignment_recurrences"."weekdays" BETWEEN 1 AND 127 AND ("assignment_recurrences"."end_date" IS NULL OR (length("assignment_recurrences"."end_date") = 10 AND "assignment_recurrences"."end_date" >= "assignment_recurrences"."start_date")) AND ("assignment_recurrences"."max_occurrences" IS NULL OR "assignment_recurrences"."max_occurrences" BETWEEN 1 AND 520) AND "assignment_recurrences"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `assignment_recurrences_student_idx` ON `assignment_recurrences` (`student_id`);--> statement-breakpoint
CREATE TABLE `assignment_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`recurrence_id` text,
	`occurrence_date` text,
	`title` text NOT NULL,
	`description_html` text DEFAULT '' NOT NULL,
	`submission_format` text NOT NULL,
	`due_at` integer,
	`created_by_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recurrence_id`) REFERENCES `assignment_recurrences`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "assignment_tasks_format_check" CHECK("assignment_tasks"."submission_format" IN ('MIX', 'TEXT', 'BOTH')),
	CONSTRAINT "assignment_tasks_payload_check" CHECK(length("assignment_tasks"."title") > 0 AND "assignment_tasks"."version" >= 1 AND ("assignment_tasks"."occurrence_date" IS NULL OR length("assignment_tasks"."occurrence_date") = 10))
);
--> statement-breakpoint
CREATE INDEX `assignment_tasks_student_due_idx` ON `assignment_tasks` (`student_id`,`due_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_tasks_occurrence_unique` ON `assignment_tasks` (`recurrence_id`,`occurrence_date`);--> statement-breakpoint
CREATE TABLE `__new_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`task_id` text,
	`media_url` text,
	`text_html` text,
	`submitted_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer,
	FOREIGN KEY (`student_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `assignment_tasks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "assignments_content_check" CHECK(("__new_assignments"."media_url" IS NOT NULL AND length("__new_assignments"."media_url") > 0) OR ("__new_assignments"."text_html" IS NOT NULL AND length("__new_assignments"."text_html") > 0))
);
--> statement-breakpoint
INSERT INTO `__new_assignments`("id", "student_id", "task_id", "media_url", "text_html", "submitted_at", "updated_at") SELECT "id", "student_id", NULL, "media_url", NULL, "submitted_at", NULL FROM `assignments`;--> statement-breakpoint
CREATE TABLE `__feedbacks_backup` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`time_marker` integer,
	`content` text NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
INSERT INTO `__feedbacks_backup`("id", "assignment_id", "time_marker", "content", "created_at") SELECT "id", "assignment_id", "time_marker", "content", "created_at" FROM `feedbacks`;--> statement-breakpoint
DROP TABLE `feedbacks`;--> statement-breakpoint
DROP TABLE `assignments`;--> statement-breakpoint
ALTER TABLE `__new_assignments` RENAME TO `assignments`;--> statement-breakpoint
CREATE UNIQUE INDEX `assignments_task_unique` ON `assignments` (`task_id`);--> statement-breakpoint
CREATE INDEX `assignments_student_submitted_idx` ON `assignments` (`student_id`,`submitted_at`);--> statement-breakpoint
CREATE TABLE `feedbacks` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`time_marker` integer,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "feedbacks_time_marker_check" CHECK("feedbacks"."time_marker" IS NULL OR "feedbacks"."time_marker" >= 0)
);
--> statement-breakpoint
INSERT INTO `feedbacks`("id", "assignment_id", "time_marker", "content", "created_at") SELECT "id", "assignment_id", "time_marker", "content", "created_at" FROM `__feedbacks_backup`;--> statement-breakpoint
DROP TABLE `__feedbacks_backup`;--> statement-breakpoint
CREATE INDEX `feedbacks_assignment_idx` ON `feedbacks` (`assignment_id`);--> statement-breakpoint

CREATE TRIGGER `profiles_before_delete_document_history`
BEFORE DELETE ON `profiles`
WHEN NOT EXISTS (
		SELECT 1 FROM pragma_foreign_keys WHERE foreign_keys = 1
	)
	OR OLD.`role` <> 'student'
	OR NOT EXISTS (
		SELECT 1 FROM `account_deletion_jobs`
		WHERE `subject_id` = OLD.`id` AND `status` = 'ERASING'
	)
	OR EXISTS (
		SELECT 1 FROM `account_deletion_jobs` AS deletion
		WHERE deletion.`subject_id` = OLD.`id`
			AND deletion.`status` = 'ERASING'
			AND deletion.`initiating_token_mode` = 'PERSISTENT'
			AND NOT EXISTS (
				SELECT 1 FROM `account_cleanup_tokens` AS token
				WHERE token.`token_digest` = deletion.`initiating_token_digest`
					AND token.`subject_id` = OLD.`id`
					AND token.`deletion_job_id` = deletion.`id`
					AND token.`status` = 'BOUND'
			)
	)
	OR EXISTS (
		SELECT 1 FROM `account_cleanup_tokens` AS token
		WHERE token.`subject_id` = OLD.`id`
			AND NOT EXISTS (
				SELECT 1 FROM `account_deletion_jobs` AS deletion
				WHERE deletion.`id` = token.`deletion_job_id`
					AND deletion.`subject_id` = OLD.`id`
					AND deletion.`status` = 'ERASING'
					AND token.`status` = 'BOUND'
			)
	)
	OR EXISTS (SELECT 1 FROM `document_server_drafts` WHERE `owner_id` = OLD.`id`)
	OR EXISTS (SELECT 1 FROM `document_server_draft_operations` WHERE `owner_id` = OLD.`id`)
	OR EXISTS (SELECT 1 FROM `private_notes` WHERE `student_id` = OLD.`id` OR `author_id` = OLD.`id`)
	OR EXISTS (SELECT 1 FROM `posts` WHERE `author_id` = OLD.`id`)
	OR EXISTS (SELECT 1 FROM `comments` WHERE `author_id` = OLD.`id`)
	OR EXISTS (SELECT 1 FROM `qna_threads` WHERE `student_id` = OLD.`id`)
	OR EXISTS (SELECT 1 FROM `qna_replies` WHERE `author_id` = OLD.`id`)
	OR EXISTS (SELECT 1 FROM `curriculums` WHERE `student_id` = OLD.`id`)
	OR EXISTS (SELECT 1 FROM `lessons` WHERE `student_id` = OLD.`id`)
	OR EXISTS (SELECT 1 FROM `assignments` WHERE `student_id` = OLD.`id`)
	OR EXISTS (SELECT 1 FROM `assignment_tasks` WHERE `student_id` = OLD.`id`)
	OR EXISTS (SELECT 1 FROM `assignment_recurrences` WHERE `student_id` = OLD.`id`)
	OR EXISTS (SELECT 1 FROM `digging_columns` WHERE `user_id` = OLD.`id`)
	OR EXISTS (SELECT 1 FROM `digging_tracks` WHERE `user_id` = OLD.`id`)
	OR EXISTS (SELECT 1 FROM `calendar_events` WHERE `user_id` = OLD.`id`)
	OR EXISTS (
		SELECT 1 FROM `media_objects`
		WHERE `owner_id` = OLD.`id` AND `state` NOT IN ('PENDING_DELETE', 'DELETED')
	)
BEGIN
	SELECT RAISE(ABORT, 'DOCUMENT_HISTORY_ACCOUNT_DELETE_RESTRICTED');
END;--> statement-breakpoint

INSERT INTO `document_batch_abort_guard` (`reason`)
SELECT 'ASSIGNMENT_TASKS_FOREIGN_KEY_CHECK_FAILED'
FROM pragma_foreign_key_check
LIMIT 1;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;