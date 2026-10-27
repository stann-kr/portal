-- 공용 가이드(guide_pages·guide_assets)와 가이드 구간 질문 위치(qna_guide_anchors)를 추가한다.
-- 가이드 편집 서버 초안을 위해 document_server_drafts.document_kind에 guide-page를 더한다(table rebuild, 의존 trigger 재생성).
CREATE TABLE `guide_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`guide_page_id` text,
	`uploaded_by_id` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`guide_page_id`) REFERENCES `guide_pages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`uploaded_by_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "guide_assets_payload_check" CHECK("guide_assets"."content_type" IN ('image/gif', 'image/jpeg', 'image/png', 'image/webp') AND "guide_assets"."object_key" = 'guide/' || "guide_assets"."id" AND "guide_assets"."size_bytes" BETWEEN 1 AND 10485760)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guide_assets_object_key_unique` ON `guide_assets` (`object_key`);--> statement-breakpoint
CREATE INDEX `guide_assets_page_idx` ON `guide_assets` (`guide_page_id`);--> statement-breakpoint
CREATE TABLE `guide_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`content_html` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by_id` text,
	`updated_by_id` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "guide_pages_payload_check" CHECK(length("guide_pages"."id") > 0 AND length("guide_pages"."title") > 0 AND "guide_pages"."version" >= 1 AND "guide_pages"."created_at" <= "guide_pages"."updated_at")
);
--> statement-breakpoint
CREATE INDEX `guide_pages_sort_idx` ON `guide_pages` (`sort_order`);--> statement-breakpoint
CREATE TABLE `qna_guide_anchors` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`guide_page_id` text,
	`page_title` text NOT NULL,
	`anchor_block_id` text,
	`anchor_quote` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `qna_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`guide_page_id`) REFERENCES `guide_pages`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "qna_guide_anchors_payload_check" CHECK(length("qna_guide_anchors"."page_title") > 0 AND length("qna_guide_anchors"."anchor_quote") BETWEEN 1 AND 500 AND ("qna_guide_anchors"."anchor_block_id" IS NULL OR length("qna_guide_anchors"."anchor_block_id") BETWEEN 1 AND 64))
);
--> statement-breakpoint
CREATE INDEX `qna_guide_anchors_page_idx` ON `qna_guide_anchors` (`guide_page_id`);--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
DROP TRIGGER `document_server_drafts_before_insert_existing`;--> statement-breakpoint
DROP TRIGGER `document_server_drafts_cas_update_guard`;--> statement-breakpoint
DROP TRIGGER `profiles_before_delete_document_history`;--> statement-breakpoint
CREATE TABLE `__new_document_server_drafts` (
	`owner_id` text NOT NULL,
	`source_key` text NOT NULL,
	`document_kind` text NOT NULL,
	`context_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`payload_hash` text NOT NULL,
	`draft_version` integer NOT NULL,
	`base_resource_version` integer,
	`writer_device_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `source_key`),
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "document_server_drafts_kind_check" CHECK("__new_document_server_drafts"."document_kind" IN ('note', 'community-post', 'qna-thread', 'qna-reply', 'guide-page')),
	CONSTRAINT "document_server_drafts_identity_check" CHECK(length("__new_document_server_drafts"."owner_id") > 0 AND length("__new_document_server_drafts"."source_key") > 0 AND length("__new_document_server_drafts"."context_id") > 0 AND length("__new_document_server_drafts"."writer_device_id") > 0),
	CONSTRAINT "document_server_drafts_payload_check" CHECK(json_valid("__new_document_server_drafts"."payload_json") AND json_type("__new_document_server_drafts"."payload_json") = 'object' AND length(CAST("__new_document_server_drafts"."payload_json" AS BLOB)) <= 921600 AND length("__new_document_server_drafts"."payload_hash") = 64),
	CONSTRAINT "document_server_drafts_version_check" CHECK("__new_document_server_drafts"."draft_version" >= 1 AND ("__new_document_server_drafts"."base_resource_version" IS NULL OR "__new_document_server_drafts"."base_resource_version" >= 1)),
	CONSTRAINT "document_server_drafts_timestamp_check" CHECK("__new_document_server_drafts"."created_at" <= "__new_document_server_drafts"."updated_at" AND "__new_document_server_drafts"."expires_at" = "__new_document_server_drafts"."updated_at" + 2592000)
);
--> statement-breakpoint
INSERT INTO `__new_document_server_drafts`("owner_id", "source_key", "document_kind", "context_id", "payload_json", "payload_hash", "draft_version", "base_resource_version", "writer_device_id", "created_at", "updated_at", "expires_at") SELECT "owner_id", "source_key", "document_kind", "context_id", "payload_json", "payload_hash", "draft_version", "base_resource_version", "writer_device_id", "created_at", "updated_at", "expires_at" FROM `document_server_drafts`;--> statement-breakpoint
DROP TABLE `document_server_drafts`;--> statement-breakpoint
ALTER TABLE `__new_document_server_drafts` RENAME TO `document_server_drafts`;--> statement-breakpoint
CREATE INDEX `document_server_drafts_owner_updated_idx` ON `document_server_drafts` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `document_server_drafts_expires_idx` ON `document_server_drafts` (`expires_at`);--> statement-breakpoint
CREATE TRIGGER `document_server_drafts_before_insert_existing`
BEFORE INSERT ON `document_server_drafts`
WHEN EXISTS (
	SELECT 1
	FROM `document_server_drafts`
	WHERE `owner_id` = NEW.`owner_id`
		AND `source_key` = NEW.`source_key`
)
BEGIN
	SELECT RAISE(ABORT, 'DOCUMENT_SERVER_DRAFT_DUPLICATE');
END;--> statement-breakpoint
CREATE TRIGGER `document_server_drafts_cas_update_guard`
BEFORE UPDATE ON `document_server_drafts`
WHEN NEW.`owner_id` <> OLD.`owner_id`
	OR NEW.`source_key` <> OLD.`source_key`
	OR NEW.`document_kind` <> OLD.`document_kind`
	OR NEW.`context_id` <> OLD.`context_id`
	OR NEW.`created_at` <> OLD.`created_at`
	OR NEW.`draft_version` <> OLD.`draft_version` + 1
	OR NEW.`updated_at` < OLD.`updated_at`
	OR NEW.`expires_at` <> NEW.`updated_at` + 2592000
BEGIN
	SELECT RAISE(ABORT, 'DOCUMENT_SERVER_DRAFT_CAS_GUARD');
END;--> statement-breakpoint
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
SELECT 'GUIDE_PAGES_FOREIGN_KEY_CHECK_FAILED'
FROM pragma_foreign_key_check
LIMIT 1;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;