CREATE TABLE `account_cleanup_tokens` (
	`token_digest` text PRIMARY KEY NOT NULL,
	`subject_id` text,
	`deletion_job_id` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`bound_at` integer,
	`erased_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`deletion_job_id`) REFERENCES `account_deletion_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "account_cleanup_tokens_digest_check" CHECK(length("account_cleanup_tokens"."token_digest") = 64 AND "account_cleanup_tokens"."token_digest" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "account_cleanup_tokens_state_check" CHECK((
        "account_cleanup_tokens"."status" = 'ACTIVE'
        AND "account_cleanup_tokens"."subject_id" IS NOT NULL
        AND length("account_cleanup_tokens"."subject_id") > 0
        AND "account_cleanup_tokens"."deletion_job_id" IS NULL
        AND "account_cleanup_tokens"."bound_at" IS NULL
        AND "account_cleanup_tokens"."erased_at" IS NULL
        AND "account_cleanup_tokens"."updated_at" = "account_cleanup_tokens"."created_at"
      ) OR (
        "account_cleanup_tokens"."status" = 'BOUND'
        AND "account_cleanup_tokens"."subject_id" IS NOT NULL
        AND length("account_cleanup_tokens"."subject_id") > 0
        AND "account_cleanup_tokens"."deletion_job_id" IS NOT NULL
        AND "account_cleanup_tokens"."bound_at" IS NOT NULL
        AND "account_cleanup_tokens"."bound_at" >= "account_cleanup_tokens"."created_at"
        AND "account_cleanup_tokens"."erased_at" IS NULL
        AND "account_cleanup_tokens"."updated_at" = "account_cleanup_tokens"."bound_at"
      ) OR (
        "account_cleanup_tokens"."status" = 'ERASED'
        AND "account_cleanup_tokens"."subject_id" IS NULL
        AND "account_cleanup_tokens"."deletion_job_id" IS NOT NULL
        AND "account_cleanup_tokens"."bound_at" IS NOT NULL
        AND "account_cleanup_tokens"."erased_at" IS NOT NULL
        AND "account_cleanup_tokens"."erased_at" >= "account_cleanup_tokens"."bound_at"
        AND "account_cleanup_tokens"."updated_at" = "account_cleanup_tokens"."erased_at"
      ))
);
--> statement-breakpoint
CREATE INDEX `account_cleanup_tokens_subject_status_idx` ON `account_cleanup_tokens` (`subject_id`,`status`);--> statement-breakpoint
CREATE INDEX `account_cleanup_tokens_job_idx` ON `account_cleanup_tokens` (`deletion_job_id`);--> statement-breakpoint
CREATE TABLE `account_deletion_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`subject_id` text,
	`erasure_alias` text NOT NULL,
	`initiating_token_digest` text NOT NULL,
	`initiating_token_mode` text NOT NULL,
	`request_hash` text NOT NULL,
	`request_hash_version` integer NOT NULL,
	`status` text NOT NULL,
	`requested_at` integer NOT NULL,
	`erased_at` integer,
	`alias_after` integer NOT NULL,
	`aliased_at` integer,
	`updated_at` integer NOT NULL,
	CONSTRAINT "account_deletion_jobs_identity_check" CHECK(length("account_deletion_jobs"."id") > 0 AND length("account_deletion_jobs"."operation_id") > 0 AND length("account_deletion_jobs"."erasure_alias") = 43 AND substr("account_deletion_jobs"."erasure_alias", 1, 7) = 'erased:' AND substr("account_deletion_jobs"."erasure_alias", 16, 1) = '-' AND substr("account_deletion_jobs"."erasure_alias", 21, 1) = '-' AND substr("account_deletion_jobs"."erasure_alias", 26, 1) = '-' AND substr("account_deletion_jobs"."erasure_alias", 31, 1) = '-' AND length(replace(substr("account_deletion_jobs"."erasure_alias", 8), '-', '')) = 32 AND replace(substr("account_deletion_jobs"."erasure_alias", 8), '-', '') NOT GLOB '*[^0-9a-f]*' AND substr("account_deletion_jobs"."erasure_alias", 22, 1) = '4' AND substr("account_deletion_jobs"."erasure_alias", 27, 1) GLOB '[89ab]'),
	CONSTRAINT "account_deletion_jobs_hash_check" CHECK(length("account_deletion_jobs"."request_hash") = 64 AND "account_deletion_jobs"."request_hash" NOT GLOB '*[^0-9a-f]*' AND "account_deletion_jobs"."request_hash_version" = 1),
	CONSTRAINT "account_deletion_jobs_initiator_check" CHECK(length("account_deletion_jobs"."initiating_token_digest") = 64 AND "account_deletion_jobs"."initiating_token_digest" NOT GLOB '*[^0-9a-f]*' AND "account_deletion_jobs"."initiating_token_mode" IN ('PERSISTENT', 'EPHEMERAL')),
	CONSTRAINT "account_deletion_jobs_timestamp_check" CHECK("account_deletion_jobs"."alias_after" = "account_deletion_jobs"."requested_at" + 2592000 AND "account_deletion_jobs"."requested_at" <= "account_deletion_jobs"."updated_at"),
	CONSTRAINT "account_deletion_jobs_state_check" CHECK((
        "account_deletion_jobs"."status" = 'ERASING'
        AND "account_deletion_jobs"."subject_id" IS NOT NULL
        AND length("account_deletion_jobs"."subject_id") > 0
        AND "account_deletion_jobs"."erased_at" IS NULL
        AND "account_deletion_jobs"."aliased_at" IS NULL
        AND "account_deletion_jobs"."updated_at" = "account_deletion_jobs"."requested_at"
      ) OR (
        "account_deletion_jobs"."status" = 'ERASED'
        AND "account_deletion_jobs"."subject_id" IS NOT NULL
        AND length("account_deletion_jobs"."subject_id") > 0
        AND "account_deletion_jobs"."erased_at" IS NOT NULL
        AND "account_deletion_jobs"."erased_at" >= "account_deletion_jobs"."requested_at"
        AND "account_deletion_jobs"."aliased_at" IS NULL
        AND "account_deletion_jobs"."updated_at" = "account_deletion_jobs"."erased_at"
      ) OR (
        "account_deletion_jobs"."status" = 'ALIASED'
        AND "account_deletion_jobs"."subject_id" IS NULL
        AND "account_deletion_jobs"."erased_at" IS NOT NULL
        AND "account_deletion_jobs"."aliased_at" IS NOT NULL
        AND "account_deletion_jobs"."aliased_at" >= "account_deletion_jobs"."alias_after"
        AND "account_deletion_jobs"."updated_at" = "account_deletion_jobs"."aliased_at"
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_deletion_jobs_operation_unique` ON `account_deletion_jobs` (`operation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_deletion_jobs_subject_unique` ON `account_deletion_jobs` (`subject_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_deletion_jobs_alias_unique` ON `account_deletion_jobs` (`erasure_alias`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_deletion_jobs_initiating_token_unique` ON `account_deletion_jobs` (`initiating_token_digest`);--> statement-breakpoint
CREATE INDEX `account_deletion_jobs_due_idx` ON `account_deletion_jobs` (`status`,`alias_after`);--> statement-breakpoint
CREATE TABLE `calendar_feed_tokens` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`token_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_feed_tokens_digest_check" CHECK(length("calendar_feed_tokens"."token_digest") = 64 AND "calendar_feed_tokens"."token_digest" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "calendar_feed_tokens_timestamp_check" CHECK("calendar_feed_tokens"."created_at" <= "calendar_feed_tokens"."updated_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feed_tokens_token_digest_unique` ON `calendar_feed_tokens` (`token_digest`);--> statement-breakpoint

CREATE TRIGGER `account_deletion_jobs_before_insert_guard`
BEFORE INSERT ON `account_deletion_jobs`
WHEN NEW.`status` <> 'ERASING'
	OR NOT EXISTS (
		SELECT 1 FROM `profiles`
		WHERE `id` = NEW.`subject_id` AND `role` = 'student'
	)
	OR NOT (
		(
			NEW.`initiating_token_mode` = 'PERSISTENT'
			AND EXISTS (
				SELECT 1 FROM `account_cleanup_tokens`
				WHERE `token_digest` = NEW.`initiating_token_digest`
					AND `subject_id` = NEW.`subject_id`
					AND `status` = 'ACTIVE'
					AND `deletion_job_id` IS NULL
			)
		) OR (
			NEW.`initiating_token_mode` = 'EPHEMERAL'
			AND NOT EXISTS (
				SELECT 1 FROM `account_cleanup_tokens`
				WHERE `token_digest` = NEW.`initiating_token_digest`
			)
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'ACCOUNT_DELETION_INITIAL_STATE_INVALID');
END;--> statement-breakpoint

CREATE TRIGGER `account_deletion_jobs_before_insert_existing`
BEFORE INSERT ON `account_deletion_jobs`
WHEN EXISTS (
	SELECT 1 FROM `account_deletion_jobs`
	WHERE `id` = NEW.`id`
		OR `operation_id` = NEW.`operation_id`
		OR (`subject_id` IS NOT NULL AND `subject_id` = NEW.`subject_id`)
		OR `erasure_alias` = NEW.`erasure_alias`
		OR `initiating_token_digest` = NEW.`initiating_token_digest`
)
BEGIN
	SELECT RAISE(ABORT, 'ACCOUNT_DELETION_JOB_DUPLICATE');
END;--> statement-breakpoint

CREATE TRIGGER `account_deletion_jobs_transition_guard`
BEFORE UPDATE ON `account_deletion_jobs`
WHEN NEW.`id` <> OLD.`id`
	OR NEW.`operation_id` <> OLD.`operation_id`
	OR NEW.`erasure_alias` <> OLD.`erasure_alias`
	OR NEW.`initiating_token_digest` <> OLD.`initiating_token_digest`
	OR NEW.`initiating_token_mode` <> OLD.`initiating_token_mode`
	OR NEW.`request_hash` <> OLD.`request_hash`
	OR NEW.`request_hash_version` <> OLD.`request_hash_version`
	OR NEW.`requested_at` <> OLD.`requested_at`
	OR NEW.`alias_after` <> OLD.`alias_after`
	OR NOT (
		(
			OLD.`status` = 'ERASING'
			AND NEW.`status` = 'ERASED'
			AND NEW.`subject_id` = OLD.`subject_id`
			AND OLD.`erased_at` IS NULL
			AND NEW.`erased_at` IS NOT NULL
			AND NEW.`aliased_at` IS NULL
			AND NEW.`updated_at` = NEW.`erased_at`
			AND NOT EXISTS (
				SELECT 1 FROM `profiles` WHERE `id` = OLD.`subject_id`
			)
		) OR (
			OLD.`status` = 'ERASED'
			AND NEW.`status` = 'ALIASED'
			AND OLD.`subject_id` IS NOT NULL
			AND NEW.`subject_id` IS NULL
			AND NEW.`erased_at` = OLD.`erased_at`
			AND OLD.`aliased_at` IS NULL
			AND NEW.`aliased_at` IS NOT NULL
			AND NEW.`aliased_at` >= OLD.`alias_after`
			AND NEW.`updated_at` = NEW.`aliased_at`
			AND OLD.`alias_after` <= strftime('%s', 'now')
			AND NOT EXISTS (
				SELECT 1 FROM `account_cleanup_tokens`
				WHERE `deletion_job_id` = OLD.`id` AND `subject_id` IS NOT NULL
			)
			AND NOT EXISTS (
				SELECT 1 FROM `document_operation_ledger`
				WHERE `actor_id` = OLD.`subject_id` OR `subject_id` = OLD.`subject_id`
			)
			AND NOT EXISTS (
				SELECT 1 FROM `document_tombstones`
				WHERE `subject_id` = OLD.`subject_id`
					OR `owner_id` = OLD.`subject_id`
					OR `purged_by_id` = OLD.`subject_id`
			)
			AND NOT EXISTS (
				SELECT 1 FROM `private_note_revisions` WHERE `actor_id` = OLD.`subject_id`
			)
			AND NOT EXISTS (
				SELECT 1 FROM `post_revisions` WHERE `actor_id` = OLD.`subject_id`
			)
			AND NOT EXISTS (
				SELECT 1 FROM `qna_thread_events` WHERE `actor_id` = OLD.`subject_id`
			)
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'ACCOUNT_DELETION_JOB_TRANSITION_INVALID');
END;--> statement-breakpoint

CREATE TRIGGER `account_deletion_jobs_guard_delete`
BEFORE DELETE ON `account_deletion_jobs`
BEGIN
	SELECT RAISE(ABORT, 'ACCOUNT_DELETION_JOB_DELETE_GUARD');
END;--> statement-breakpoint

CREATE TRIGGER `account_cleanup_tokens_before_insert_guard`
BEFORE INSERT ON `account_cleanup_tokens`
WHEN NEW.`status` <> 'ACTIVE'
	OR NOT EXISTS (
		SELECT 1 FROM `profiles`
		WHERE `id` = NEW.`subject_id` AND `role` = 'student'
	)
	OR (
		SELECT count(*) FROM `account_cleanup_tokens`
		WHERE `subject_id` = NEW.`subject_id` AND `status` = 'ACTIVE'
	) >= 64
BEGIN
	SELECT RAISE(ABORT, 'ACCOUNT_CLEANUP_TOKEN_INITIAL_STATE_INVALID');
END;--> statement-breakpoint

CREATE TRIGGER `account_cleanup_tokens_before_insert_existing`
BEFORE INSERT ON `account_cleanup_tokens`
WHEN EXISTS (
	SELECT 1 FROM `account_cleanup_tokens`
	WHERE `token_digest` = NEW.`token_digest`
	UNION ALL
	SELECT 1 FROM `account_deletion_jobs`
	WHERE `initiating_token_digest` = NEW.`token_digest`
)
BEGIN
	SELECT RAISE(ABORT, 'ACCOUNT_CLEANUP_TOKEN_DUPLICATE');
END;--> statement-breakpoint

CREATE TRIGGER `account_cleanup_tokens_transition_guard`
BEFORE UPDATE ON `account_cleanup_tokens`
WHEN NEW.`token_digest` <> OLD.`token_digest`
	OR NEW.`created_at` <> OLD.`created_at`
	OR NOT (
		(
			OLD.`status` = 'ACTIVE'
			AND NEW.`status` = 'BOUND'
			AND NEW.`subject_id` = OLD.`subject_id`
			AND OLD.`deletion_job_id` IS NULL
			AND NEW.`deletion_job_id` IS NOT NULL
			AND NEW.`bound_at` IS NOT NULL
			AND NEW.`erased_at` IS NULL
			AND NEW.`updated_at` = NEW.`bound_at`
			AND EXISTS (
				SELECT 1 FROM `account_deletion_jobs` AS deletion
				WHERE deletion.`id` = NEW.`deletion_job_id`
					AND deletion.`subject_id` = OLD.`subject_id`
					AND deletion.`status` = 'ERASING'
			)
		) OR (
			OLD.`status` = 'BOUND'
			AND NEW.`status` = 'ERASED'
			AND OLD.`subject_id` IS NOT NULL
			AND NEW.`subject_id` IS NULL
			AND NEW.`deletion_job_id` = OLD.`deletion_job_id`
			AND NEW.`bound_at` = OLD.`bound_at`
			AND OLD.`erased_at` IS NULL
			AND NEW.`erased_at` IS NOT NULL
			AND NEW.`updated_at` = NEW.`erased_at`
			AND EXISTS (
				SELECT 1 FROM `account_deletion_jobs` AS deletion
				WHERE deletion.`id` = OLD.`deletion_job_id`
					AND deletion.`subject_id` = OLD.`subject_id`
					AND deletion.`status` = 'ERASED'
					AND deletion.`alias_after` <= strftime('%s', 'now')
			)
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'ACCOUNT_CLEANUP_TOKEN_TRANSITION_INVALID');
END;--> statement-breakpoint

CREATE TRIGGER `account_cleanup_tokens_guard_delete`
BEFORE DELETE ON `account_cleanup_tokens`
BEGIN
	SELECT RAISE(ABORT, 'ACCOUNT_CLEANUP_TOKEN_DELETE_GUARD');
END;--> statement-breakpoint

CREATE TRIGGER `calendar_feed_tokens_before_insert_guard`
BEFORE INSERT ON `calendar_feed_tokens`
WHEN NOT EXISTS (
	SELECT 1 FROM `profiles`
	WHERE `id` = NEW.`owner_id` AND `role` = 'student'
)
BEGIN
	SELECT RAISE(ABORT, 'CALENDAR_FEED_TOKEN_STUDENT_REQUIRED');
END;--> statement-breakpoint

CREATE TRIGGER `calendar_feed_tokens_before_insert_existing`
BEFORE INSERT ON `calendar_feed_tokens`
WHEN EXISTS (
	SELECT 1 FROM `calendar_feed_tokens`
	WHERE `owner_id` = NEW.`owner_id` OR `token_digest` = NEW.`token_digest`
)
BEGIN
	SELECT RAISE(ABORT, 'CALENDAR_FEED_TOKEN_DUPLICATE');
END;--> statement-breakpoint

CREATE TRIGGER `calendar_feed_tokens_rotation_guard`
BEFORE UPDATE ON `calendar_feed_tokens`
WHEN NEW.`owner_id` <> OLD.`owner_id`
	OR NEW.`created_at` <> OLD.`created_at`
	OR NEW.`token_digest` = OLD.`token_digest`
	OR NEW.`updated_at` <= OLD.`updated_at`
	OR EXISTS (
		SELECT 1 FROM `calendar_feed_tokens` AS existing
		WHERE existing.`owner_id` <> OLD.`owner_id`
			AND existing.`token_digest` = NEW.`token_digest`
	)
BEGIN
	SELECT RAISE(ABORT, 'CALENDAR_FEED_TOKEN_ROTATION_INVALID');
END;--> statement-breakpoint

PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
DROP TRIGGER `media_deletion_outbox_before_insert_match`;--> statement-breakpoint
DROP TRIGGER `posts_media_guard_insert`;--> statement-breakpoint
DROP TRIGGER `posts_media_guard_update`;--> statement-breakpoint
DROP TRIGGER `post_revisions_media_guard_insert`;--> statement-breakpoint
DROP TRIGGER `qna_replies_media_guard_insert`;--> statement-breakpoint
DROP TRIGGER `posts_before_delete_media_pending`;--> statement-breakpoint
DROP TRIGGER `qna_threads_before_delete_media_pending`;--> statement-breakpoint
CREATE TABLE `__new_media_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`purpose` text NOT NULL,
	`object_key` text NOT NULL,
	`upload_object_key` text NOT NULL,
	`state` text NOT NULL,
	`seal_lease_id` text,
	`seal_lease_expires_at` integer,
	`expected_content_type` text NOT NULL,
	`expected_size_bytes` integer NOT NULL,
	`actual_size_bytes` integer,
	`etag` text,
	`draft_operation_id` text NOT NULL,
	`resource_type` text,
	`resource_id` text,
	`upload_expires_at` integer NOT NULL,
	`ready_at` integer,
	`attached_at` integer,
	`delete_requested_at` integer,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "media_objects_purpose_check" CHECK("__new_media_objects"."purpose" IN ('COMMUNITY_POST_AUDIO', 'QNA_ATTACHMENT')),
	CONSTRAINT "media_objects_state_check" CHECK("__new_media_objects"."state" IN ('PENDING_UPLOAD', 'SEALING', 'READY', 'ATTACHED', 'PENDING_DELETE', 'DELETED')),
	CONSTRAINT "media_objects_identity_check" CHECK(length("__new_media_objects"."id") > 0 AND length("__new_media_objects"."object_key") > 0 AND length("__new_media_objects"."upload_object_key") > 0 AND length("__new_media_objects"."draft_operation_id") > 0),
	CONSTRAINT "media_objects_key_check" CHECK((
        "__new_media_objects"."purpose" = 'COMMUNITY_POST_AUDIO'
        AND "__new_media_objects"."upload_object_key" = 'media-upload/community-post-audio/' || "__new_media_objects"."id"
        AND length("__new_media_objects"."object_key") = 63
        AND substr("__new_media_objects"."object_key", 1, 27) = 'media/community-post-audio/'
        AND substr("__new_media_objects"."object_key", 36, 1) = '-'
        AND substr("__new_media_objects"."object_key", 41, 1) = '-'
        AND substr("__new_media_objects"."object_key", 46, 1) = '-'
        AND substr("__new_media_objects"."object_key", 51, 1) = '-'
        AND length(replace(substr("__new_media_objects"."object_key", 28), '-', '')) = 32
        AND replace(substr("__new_media_objects"."object_key", 28), '-', '') NOT GLOB '*[^0-9a-f]*'
        AND substr("__new_media_objects"."object_key", 42, 1) = '4'
        AND substr("__new_media_objects"."object_key", 47, 1) GLOB '[89ab]'
        AND "__new_media_objects"."object_key" <> 'media/community-post-audio/' || "__new_media_objects"."id"
      ) OR (
        "__new_media_objects"."purpose" = 'QNA_ATTACHMENT'
        AND "__new_media_objects"."upload_object_key" = 'media-upload/qna-attachment/' || "__new_media_objects"."id"
        AND length("__new_media_objects"."object_key") = 57
        AND substr("__new_media_objects"."object_key", 1, 21) = 'media/qna-attachment/'
        AND substr("__new_media_objects"."object_key", 30, 1) = '-'
        AND substr("__new_media_objects"."object_key", 35, 1) = '-'
        AND substr("__new_media_objects"."object_key", 40, 1) = '-'
        AND substr("__new_media_objects"."object_key", 45, 1) = '-'
        AND length(replace(substr("__new_media_objects"."object_key", 22), '-', '')) = 32
        AND replace(substr("__new_media_objects"."object_key", 22), '-', '') NOT GLOB '*[^0-9a-f]*'
        AND substr("__new_media_objects"."object_key", 36, 1) = '4'
        AND substr("__new_media_objects"."object_key", 41, 1) GLOB '[89ab]'
        AND "__new_media_objects"."object_key" <> 'media/qna-attachment/' || "__new_media_objects"."id"
      )),
	CONSTRAINT "media_objects_size_check" CHECK("__new_media_objects"."expected_size_bytes" > 0 AND ("__new_media_objects"."actual_size_bytes" IS NULL OR "__new_media_objects"."actual_size_bytes" > 0)),
	CONSTRAINT "media_objects_resource_type_check" CHECK("__new_media_objects"."resource_type" IS NULL OR "__new_media_objects"."resource_type" IN ('COMMUNITY_POST', 'QNA_REPLY')),
	CONSTRAINT "media_objects_resource_pair_check" CHECK(("__new_media_objects"."resource_type" IS NULL AND "__new_media_objects"."resource_id" IS NULL) OR ("__new_media_objects"."resource_type" IS NOT NULL AND "__new_media_objects"."resource_id" IS NOT NULL AND length("__new_media_objects"."resource_id") > 0)),
	CONSTRAINT "media_objects_state_payload_check" CHECK((
        "__new_media_objects"."state" = 'PENDING_UPLOAD'
        AND "__new_media_objects"."owner_id" IS NOT NULL
        AND "__new_media_objects"."seal_lease_id" IS NULL
        AND "__new_media_objects"."seal_lease_expires_at" IS NULL
        AND "__new_media_objects"."actual_size_bytes" IS NULL
        AND "__new_media_objects"."ready_at" IS NULL
        AND "__new_media_objects"."resource_type" IS NULL
        AND "__new_media_objects"."attached_at" IS NULL
        AND "__new_media_objects"."delete_requested_at" IS NULL
        AND "__new_media_objects"."deleted_at" IS NULL
      ) OR (
        "__new_media_objects"."state" = 'SEALING'
        AND "__new_media_objects"."owner_id" IS NOT NULL
        AND "__new_media_objects"."seal_lease_id" IS NOT NULL
        AND length("__new_media_objects"."seal_lease_id") > 0
        AND "__new_media_objects"."seal_lease_expires_at" IS NOT NULL
        AND "__new_media_objects"."seal_lease_expires_at" > "__new_media_objects"."updated_at"
        AND "__new_media_objects"."actual_size_bytes" IS NULL
        AND "__new_media_objects"."ready_at" IS NULL
        AND "__new_media_objects"."resource_type" IS NULL
        AND "__new_media_objects"."attached_at" IS NULL
        AND "__new_media_objects"."delete_requested_at" IS NULL
        AND "__new_media_objects"."deleted_at" IS NULL
      ) OR (
        "__new_media_objects"."state" = 'READY'
        AND "__new_media_objects"."owner_id" IS NOT NULL
        AND "__new_media_objects"."seal_lease_id" IS NULL
        AND "__new_media_objects"."seal_lease_expires_at" IS NULL
        AND "__new_media_objects"."actual_size_bytes" IS NOT NULL
        AND "__new_media_objects"."ready_at" IS NOT NULL
        AND "__new_media_objects"."resource_type" IS NULL
        AND "__new_media_objects"."attached_at" IS NULL
        AND "__new_media_objects"."delete_requested_at" IS NULL
        AND "__new_media_objects"."deleted_at" IS NULL
      ) OR (
        "__new_media_objects"."state" = 'ATTACHED'
        AND "__new_media_objects"."owner_id" IS NOT NULL
        AND "__new_media_objects"."seal_lease_id" IS NULL
        AND "__new_media_objects"."seal_lease_expires_at" IS NULL
        AND "__new_media_objects"."actual_size_bytes" IS NOT NULL
        AND "__new_media_objects"."ready_at" IS NOT NULL
        AND "__new_media_objects"."resource_type" IS NOT NULL
        AND "__new_media_objects"."attached_at" IS NOT NULL
        AND "__new_media_objects"."delete_requested_at" IS NULL
        AND "__new_media_objects"."deleted_at" IS NULL
      ) OR (
        "__new_media_objects"."state" = 'PENDING_DELETE'
        AND "__new_media_objects"."seal_lease_id" IS NULL
        AND "__new_media_objects"."seal_lease_expires_at" IS NULL
        AND "__new_media_objects"."delete_requested_at" IS NOT NULL
        AND "__new_media_objects"."deleted_at" IS NULL
      ) OR (
        "__new_media_objects"."state" = 'DELETED'
        AND "__new_media_objects"."seal_lease_id" IS NULL
        AND "__new_media_objects"."seal_lease_expires_at" IS NULL
        AND "__new_media_objects"."delete_requested_at" IS NOT NULL
        AND "__new_media_objects"."deleted_at" IS NOT NULL
      )),
	CONSTRAINT "media_objects_timestamp_check" CHECK("__new_media_objects"."created_at" <= "__new_media_objects"."updated_at" AND "__new_media_objects"."created_at" < "__new_media_objects"."upload_expires_at")
);
--> statement-breakpoint
INSERT INTO `__new_media_objects`("id", "owner_id", "purpose", "object_key", "upload_object_key", "state", "seal_lease_id", "seal_lease_expires_at", "expected_content_type", "expected_size_bytes", "actual_size_bytes", "etag", "draft_operation_id", "resource_type", "resource_id", "upload_expires_at", "ready_at", "attached_at", "delete_requested_at", "deleted_at", "created_at", "updated_at") SELECT "id", "owner_id", "purpose", "object_key", "upload_object_key", "state", "seal_lease_id", "seal_lease_expires_at", "expected_content_type", "expected_size_bytes", "actual_size_bytes", "etag", "draft_operation_id", "resource_type", "resource_id", "upload_expires_at", "ready_at", "attached_at", "delete_requested_at", "deleted_at", "created_at", "updated_at" FROM `media_objects`;--> statement-breakpoint
DROP TABLE `media_objects`;--> statement-breakpoint
ALTER TABLE `__new_media_objects` RENAME TO `media_objects`;--> statement-breakpoint
CREATE UNIQUE INDEX `media_objects_object_key_unique` ON `media_objects` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_objects_upload_object_key_unique` ON `media_objects` (`upload_object_key`);--> statement-breakpoint
CREATE INDEX `media_objects_owner_state_updated_idx` ON `media_objects` (`owner_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE INDEX `media_objects_state_upload_expiry_idx` ON `media_objects` (`state`,`upload_expires_at`);--> statement-breakpoint
CREATE INDEX `media_objects_resource_idx` ON `media_objects` (`resource_type`,`resource_id`);
CREATE TRIGGER `media_objects_before_insert_guard`
BEFORE INSERT ON `media_objects`
WHEN NEW.`state` <> 'PENDING_UPLOAD'
BEGIN
	SELECT RAISE(ABORT, 'MEDIA_OBJECT_INITIAL_STATE_INVALID');
END;--> statement-breakpoint

CREATE TRIGGER `media_objects_before_insert_existing`
BEFORE INSERT ON `media_objects`
WHEN EXISTS (
	SELECT 1
	FROM `media_objects`
	WHERE `id` = NEW.`id`
		OR `object_key` = NEW.`object_key`
		OR `upload_object_key` = NEW.`upload_object_key`
)
BEGIN
	SELECT RAISE(ABORT, 'MEDIA_OBJECT_DUPLICATE');
END;--> statement-breakpoint

CREATE TRIGGER `media_objects_immutable_identity`
BEFORE UPDATE ON `media_objects`
WHEN NEW.`id` <> OLD.`id`
	OR (
		NEW.`owner_id` IS NOT OLD.`owner_id`
		AND NOT (
			OLD.`owner_id` IS NOT NULL
			AND NEW.`owner_id` IS NULL
			AND OLD.`state` IN ('PENDING_DELETE', 'DELETED')
			AND EXISTS (
				SELECT 1 FROM `account_deletion_jobs` AS deletion
				WHERE deletion.`subject_id` = OLD.`owner_id`
					AND deletion.`status` = 'ERASING'
			)
		)
	)
	OR NEW.`purpose` <> OLD.`purpose`
	OR NEW.`object_key` <> OLD.`object_key`
	OR NEW.`upload_object_key` <> OLD.`upload_object_key`
	OR NEW.`expected_content_type` <> OLD.`expected_content_type`
	OR NEW.`expected_size_bytes` <> OLD.`expected_size_bytes`
	OR NEW.`draft_operation_id` <> OLD.`draft_operation_id`
	OR NEW.`upload_expires_at` <> OLD.`upload_expires_at`
	OR NEW.`created_at` <> OLD.`created_at`
BEGIN
	SELECT RAISE(ABORT, 'MEDIA_OBJECT_IDENTITY_IMMUTABLE');
END;--> statement-breakpoint

CREATE TRIGGER `media_objects_transition_guard`
BEFORE UPDATE ON `media_objects`
WHEN NOT (
	(OLD.`state` = 'PENDING_UPLOAD' AND NEW.`state` IN ('SEALING', 'PENDING_DELETE'))
	OR (OLD.`state` = 'SEALING' AND NEW.`state` IN ('READY', 'PENDING_UPLOAD'))
	OR (
		OLD.`state` = 'SEALING'
		AND NEW.`state` = 'SEALING'
		AND NEW.`seal_lease_id` = OLD.`seal_lease_id`
		AND NEW.`seal_lease_expires_at` > OLD.`seal_lease_expires_at`
	)
	OR (
		OLD.`state` = 'SEALING'
		AND NEW.`state` = 'PENDING_DELETE'
		AND OLD.`seal_lease_expires_at` <= NEW.`updated_at`
	)
	OR (OLD.`state` = 'READY' AND NEW.`state` IN ('ATTACHED', 'PENDING_DELETE'))
	OR (OLD.`state` = 'ATTACHED' AND NEW.`state` = 'PENDING_DELETE')
	OR (OLD.`state` = 'PENDING_DELETE' AND NEW.`state` = 'DELETED')
	OR (
		OLD.`state` IN ('PENDING_DELETE', 'DELETED')
		AND NEW.`state` = OLD.`state`
		AND OLD.`owner_id` IS NOT NULL
		AND NEW.`owner_id` IS NULL
		AND EXISTS (
			SELECT 1 FROM `account_deletion_jobs` AS deletion
			WHERE deletion.`subject_id` = OLD.`owner_id`
				AND deletion.`status` = 'ERASING'
		)
	)
)
BEGIN
	SELECT RAISE(ABORT, 'MEDIA_OBJECT_STATE_TRANSITION_INVALID');
END;--> statement-breakpoint

CREATE TRIGGER `media_objects_transition_payload_guard`
BEFORE UPDATE ON `media_objects`
WHEN NEW.`updated_at` < OLD.`updated_at`
	OR (
		NOT (OLD.`state` = 'SEALING' AND NEW.`state` = 'READY')
		AND (
			NEW.`actual_size_bytes` IS NOT OLD.`actual_size_bytes`
			OR NEW.`etag` IS NOT OLD.`etag`
			OR NEW.`ready_at` IS NOT OLD.`ready_at`
		)
	)
	OR (
		NOT (OLD.`state` = 'READY' AND NEW.`state` = 'ATTACHED')
		AND (
			NEW.`resource_type` IS NOT OLD.`resource_type`
			OR NEW.`resource_id` IS NOT OLD.`resource_id`
			OR NEW.`attached_at` IS NOT OLD.`attached_at`
		)
	)
	OR (
		NOT (
			OLD.`state` IN ('PENDING_UPLOAD', 'SEALING', 'READY', 'ATTACHED')
			AND NEW.`state` = 'PENDING_DELETE'
		)
		AND NEW.`delete_requested_at` IS NOT OLD.`delete_requested_at`
	)
	OR (
		NOT (OLD.`state` = 'PENDING_DELETE' AND NEW.`state` = 'DELETED')
		AND NEW.`deleted_at` IS NOT OLD.`deleted_at`
	)
	OR (
		NOT (
			(OLD.`state` = 'PENDING_UPLOAD' AND NEW.`state` = 'SEALING')
			OR (
				OLD.`state` = 'SEALING'
				AND NEW.`state` = 'SEALING'
				AND NEW.`seal_lease_id` = OLD.`seal_lease_id`
				AND NEW.`seal_lease_expires_at` > OLD.`seal_lease_expires_at`
			)
			OR (
				OLD.`state` = 'SEALING'
				AND NEW.`state` IN ('PENDING_UPLOAD', 'READY', 'PENDING_DELETE')
			)
		)
		AND (
			NEW.`seal_lease_id` IS NOT OLD.`seal_lease_id`
			OR NEW.`seal_lease_expires_at` IS NOT OLD.`seal_lease_expires_at`
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'MEDIA_OBJECT_TRANSITION_PAYLOAD_INVALID');
END;--> statement-breakpoint

CREATE TRIGGER `media_objects_deletion_outbox_guard`
BEFORE UPDATE ON `media_objects`
WHEN (
	NEW.`state` = 'READY'
	AND NOT EXISTS (
		SELECT 1 FROM `media_deletion_outbox` AS deletion
		WHERE deletion.`media_object_id` = OLD.`id`
			AND deletion.`object_key` = OLD.`upload_object_key`
			AND deletion.`reason` = 'UPLOAD_STAGING_EXPIRED'
			AND deletion.`completed_at` IS NULL
	)
) OR (
	NEW.`state` = 'PENDING_DELETE'
	AND (
		NOT EXISTS (
			SELECT 1 FROM `media_deletion_outbox` AS deletion
			WHERE deletion.`media_object_id` = OLD.`id`
				AND deletion.`object_key` = OLD.`object_key`
				AND deletion.`completed_at` IS NULL
		) OR NOT EXISTS (
			SELECT 1 FROM `media_deletion_outbox` AS deletion
			WHERE deletion.`media_object_id` = OLD.`id`
				AND deletion.`object_key` = OLD.`upload_object_key`
		)
	)
) OR (
	NEW.`state` = 'DELETED'
	AND (
		NOT EXISTS (
			SELECT 1 FROM `media_deletion_outbox` AS deletion
			WHERE deletion.`media_object_id` = OLD.`id`
				AND deletion.`object_key` = OLD.`object_key`
				AND deletion.`completed_at` IS NOT NULL
		) OR EXISTS (
			SELECT 1 FROM `media_deletion_outbox` AS deletion
			WHERE deletion.`media_object_id` = OLD.`id`
				AND deletion.`completed_at` IS NULL
		)
	)
)
BEGIN
	SELECT RAISE(ABORT, 'MEDIA_OBJECT_DELETION_OUTBOX_REQUIRED');
END;--> statement-breakpoint

CREATE TRIGGER `media_objects_guard_delete`
BEFORE DELETE ON `media_objects`
BEGIN
	SELECT RAISE(ABORT, 'MEDIA_OBJECT_DELETE_GUARD');
END;--> statement-breakpoint

CREATE TRIGGER `media_deletion_outbox_before_insert_match`
BEFORE INSERT ON `media_deletion_outbox`
WHEN NEW.`attempt_count` <> 0
	OR NEW.`lease_id` IS NOT NULL
	OR NEW.`lease_expires_at` IS NOT NULL
	OR NEW.`last_error_code` IS NOT NULL
	OR NEW.`completed_at` IS NOT NULL
	OR NEW.`not_before` <> NEW.`next_attempt_at`
	OR NEW.`created_at` <> NEW.`updated_at`
	OR NOT EXISTS (
		SELECT 1 FROM `media_objects` AS media
		WHERE media.`id` = NEW.`media_object_id`
			AND media.`state` IN ('PENDING_UPLOAD', 'SEALING', 'READY', 'ATTACHED')
			AND (
				media.`state` <> 'SEALING'
				OR (
					NEW.`not_before` >= media.`seal_lease_expires_at`
					AND (
						NEW.`object_key` = media.`upload_object_key`
						OR NEW.`created_at` >= media.`seal_lease_expires_at`
					)
				)
			)
			AND (
				(
					NEW.`object_key` = media.`object_key`
					AND NEW.`reason` <> 'UPLOAD_STAGING_EXPIRED'
				) OR (
					NEW.`object_key` = media.`upload_object_key`
					AND NEW.`reason` = 'UPLOAD_STAGING_EXPIRED'
				)
			)
	)
BEGIN
	SELECT RAISE(ABORT, 'MEDIA_DELETION_OUTBOX_INVALID');
END;--> statement-breakpoint
CREATE TRIGGER `posts_media_guard_insert`
BEFORE INSERT ON `posts`
WHEN (
	NEW.`media_object_id` IS NULL
	AND NEW.`media_url` GLOB '/api/media/*'
) OR (
	NEW.`media_object_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1 FROM `media_objects` AS media
		WHERE media.`id` = NEW.`media_object_id`
			AND media.`owner_id` = NEW.`author_id`
			AND media.`purpose` = 'COMMUNITY_POST_AUDIO'
			AND media.`state` = 'ATTACHED'
			AND media.`resource_type` = 'COMMUNITY_POST'
			AND media.`resource_id` = NEW.`id`
			AND NEW.`media_url` = '/api/media/' || media.`id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'POST_MEDIA_REFERENCE_INVALID');
END;--> statement-breakpoint

CREATE TRIGGER `posts_media_guard_update`
BEFORE UPDATE ON `posts`
WHEN (
	OLD.`media_object_id` IS NOT NULL
	AND NEW.`media_object_id` IS NOT OLD.`media_object_id`
) OR (
	NEW.`media_object_id` IS NULL
	AND NEW.`media_url` GLOB '/api/media/*'
) OR (
	NEW.`media_object_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1 FROM `media_objects` AS media
		WHERE media.`id` = NEW.`media_object_id`
			AND media.`owner_id` = NEW.`author_id`
			AND media.`purpose` = 'COMMUNITY_POST_AUDIO'
			AND media.`state` = 'ATTACHED'
			AND media.`resource_type` = 'COMMUNITY_POST'
			AND media.`resource_id` = NEW.`id`
			AND NEW.`media_url` = '/api/media/' || media.`id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'POST_MEDIA_REFERENCE_INVALID');
END;--> statement-breakpoint

CREATE TRIGGER `post_revisions_media_guard_insert`
BEFORE INSERT ON `post_revisions`
WHEN (
	NEW.`media_object_id` IS NULL
	AND NEW.`media_url` GLOB '/api/media/*'
) OR (
	NEW.`media_object_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM `media_objects` AS media
		JOIN `posts` AS post ON post.`id` = NEW.`post_id`
		WHERE media.`id` = NEW.`media_object_id`
			AND media.`owner_id` = post.`author_id`
			AND media.`purpose` = 'COMMUNITY_POST_AUDIO'
			AND media.`state` = 'ATTACHED'
			AND media.`resource_type` = 'COMMUNITY_POST'
			AND media.`resource_id` = NEW.`post_id`
			AND NEW.`media_url` = '/api/media/' || media.`id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'POST_REVISION_MEDIA_REFERENCE_INVALID');
END;--> statement-breakpoint

CREATE TRIGGER `qna_replies_media_guard_insert`
BEFORE INSERT ON `qna_replies`
WHEN (
	NEW.`attachment_object_id` IS NULL
	AND NEW.`attachment_url` GLOB '/api/media/*'
) OR (
	NEW.`attachment_object_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1 FROM `media_objects` AS media
		WHERE media.`id` = NEW.`attachment_object_id`
			AND media.`owner_id` = NEW.`author_id`
			AND media.`purpose` = 'QNA_ATTACHMENT'
			AND media.`state` = 'ATTACHED'
			AND media.`resource_type` = 'QNA_REPLY'
			AND media.`resource_id` = NEW.`id`
			AND NEW.`attachment_url` = '/api/media/' || media.`id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'QNA_REPLY_MEDIA_REFERENCE_INVALID');
END;--> statement-breakpoint

CREATE TRIGGER `posts_before_delete_media_pending`
BEFORE DELETE ON `posts`
WHEN EXISTS (
	SELECT 1 FROM `media_objects`
	WHERE `resource_type` = 'COMMUNITY_POST'
		AND `resource_id` = OLD.`id`
		AND `state` = 'ATTACHED'
)
BEGIN
	SELECT RAISE(ABORT, 'POST_MEDIA_DELETE_NOT_QUEUED');
END;--> statement-breakpoint

CREATE TRIGGER `qna_threads_before_delete_media_pending`
BEFORE DELETE ON `qna_threads`
WHEN EXISTS (
	SELECT 1
	FROM `media_objects` AS media
	JOIN `qna_replies` AS reply ON reply.`id` = media.`resource_id`
	WHERE media.`resource_type` = 'QNA_REPLY'
		AND reply.`thread_id` = OLD.`id`
		AND media.`state` = 'ATTACHED'
)
BEGIN
	SELECT RAISE(ABORT, 'QNA_MEDIA_DELETE_NOT_QUEUED');
END;
--> statement-breakpoint

DROP TRIGGER `document_operation_ledger_immutable_update`;--> statement-breakpoint
DROP TRIGGER `document_tombstones_immutable_update`;--> statement-breakpoint
DROP TRIGGER `private_note_revisions_immutable_update`;--> statement-breakpoint
DROP TRIGGER `post_revisions_immutable_update`;--> statement-breakpoint
DROP TRIGGER `qna_thread_events_immutable_update`;--> statement-breakpoint
DROP TRIGGER `comments_before_delete_trashed_post`;--> statement-breakpoint
DROP TRIGGER `qna_replies_guard_delete`;--> statement-breakpoint
DROP TRIGGER `profiles_before_delete_document_history`;--> statement-breakpoint

CREATE TRIGGER `document_operation_ledger_immutable_update`
BEFORE UPDATE ON `document_operation_ledger`
WHEN NOT (
	NEW.`id` = OLD.`id`
	AND NEW.`operation_id` = OLD.`operation_id`
	AND NEW.`resource_type` = OLD.`resource_type`
	AND NEW.`operation_type` = OLD.`operation_type`
	AND NEW.`resource_id` = OLD.`resource_id`
	AND NEW.`request_hash` = OLD.`request_hash`
	AND NEW.`request_hash_version` = OLD.`request_hash_version`
	AND NEW.`result_revision` = OLD.`result_revision`
	AND NEW.`created_at` = OLD.`created_at`
	AND (
		NEW.`actor_id` = OLD.`actor_id`
		OR EXISTS (
			SELECT 1 FROM `account_deletion_jobs` AS deletion
			WHERE deletion.`status` = 'ERASED'
				AND deletion.`subject_id` = OLD.`actor_id`
				AND deletion.`erasure_alias` = NEW.`actor_id`
				AND deletion.`alias_after` <= strftime('%s', 'now')
		)
	)
	AND (
		NEW.`subject_id` = OLD.`subject_id`
		OR EXISTS (
			SELECT 1 FROM `account_deletion_jobs` AS deletion
			WHERE deletion.`status` = 'ERASED'
				AND deletion.`subject_id` = OLD.`subject_id`
				AND deletion.`erasure_alias` = NEW.`subject_id`
				AND deletion.`alias_after` <= strftime('%s', 'now')
		)
	)
	AND (NEW.`actor_id` <> OLD.`actor_id` OR NEW.`subject_id` <> OLD.`subject_id`)
)
BEGIN
	SELECT RAISE(ABORT, 'DOCUMENT_LEDGER_IMMUTABLE');
END;--> statement-breakpoint

CREATE TRIGGER `document_tombstones_immutable_update`
BEFORE UPDATE ON `document_tombstones`
WHEN NOT (
	NEW.`resource_type` = OLD.`resource_type`
	AND NEW.`resource_id` = OLD.`resource_id`
	AND NEW.`source_created_at` IS OLD.`source_created_at`
	AND NEW.`source_version` = OLD.`source_version`
	AND NEW.`purged_at` = OLD.`purged_at`
	AND (
		NEW.`subject_id` = OLD.`subject_id`
		OR EXISTS (
			SELECT 1 FROM `account_deletion_jobs` AS deletion
			WHERE deletion.`status` = 'ERASED'
				AND deletion.`subject_id` = OLD.`subject_id`
				AND deletion.`erasure_alias` = NEW.`subject_id`
				AND deletion.`alias_after` <= strftime('%s', 'now')
		)
	)
	AND (
		NEW.`owner_id` = OLD.`owner_id`
		OR EXISTS (
			SELECT 1 FROM `account_deletion_jobs` AS deletion
			WHERE deletion.`status` = 'ERASED'
				AND deletion.`subject_id` = OLD.`owner_id`
				AND deletion.`erasure_alias` = NEW.`owner_id`
				AND deletion.`alias_after` <= strftime('%s', 'now')
		)
	)
	AND (
		NEW.`purged_by_id` IS OLD.`purged_by_id`
		OR EXISTS (
			SELECT 1 FROM `account_deletion_jobs` AS deletion
			WHERE OLD.`purged_by_id` IS NOT NULL
				AND deletion.`status` = 'ERASED'
				AND deletion.`subject_id` = OLD.`purged_by_id`
				AND deletion.`erasure_alias` = NEW.`purged_by_id`
				AND deletion.`alias_after` <= strftime('%s', 'now')
		)
	)
	AND (
		NEW.`subject_id` <> OLD.`subject_id`
		OR NEW.`owner_id` <> OLD.`owner_id`
		OR NEW.`purged_by_id` IS NOT OLD.`purged_by_id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'DOCUMENT_TOMBSTONE_IMMUTABLE');
END;--> statement-breakpoint

CREATE TRIGGER `private_note_revisions_immutable_update`
BEFORE UPDATE ON `private_note_revisions`
WHEN NOT (
	NEW.`id` = OLD.`id`
	AND NEW.`note_id` = OLD.`note_id`
	AND NEW.`revision_number` = OLD.`revision_number`
	AND NEW.`change_type` = OLD.`change_type`
	AND NEW.`title` = OLD.`title`
	AND NEW.`content_html` = OLD.`content_html`
	AND NEW.`note_date` IS OLD.`note_date`
	AND NEW.`deleted_at` IS OLD.`deleted_at`
	AND NEW.`snapshot_hash` IS OLD.`snapshot_hash`
	AND NEW.`snapshot_hash_version` IS OLD.`snapshot_hash_version`
	AND NEW.`restored_from_revision` IS OLD.`restored_from_revision`
	AND NEW.`operation_record_id` IS OLD.`operation_record_id`
	AND NEW.`created_at` = OLD.`created_at`
	AND OLD.`actor_id` IS NOT NULL
	AND EXISTS (
		SELECT 1 FROM `account_deletion_jobs` AS deletion
		WHERE deletion.`status` = 'ERASED'
			AND deletion.`subject_id` = OLD.`actor_id`
			AND deletion.`erasure_alias` = NEW.`actor_id`
			AND deletion.`alias_after` <= strftime('%s', 'now')
	)
)
BEGIN
	SELECT RAISE(ABORT, 'PRIVATE_NOTE_REVISION_IMMUTABLE');
END;--> statement-breakpoint

CREATE TRIGGER `post_revisions_immutable_update`
BEFORE UPDATE ON `post_revisions`
WHEN NOT (
	NEW.`id` = OLD.`id`
	AND NEW.`post_id` = OLD.`post_id`
	AND NEW.`revision_number` = OLD.`revision_number`
	AND NEW.`change_type` = OLD.`change_type`
	AND NEW.`category` = OLD.`category`
	AND NEW.`board_type` = OLD.`board_type`
	AND NEW.`is_pinned` = OLD.`is_pinned`
	AND NEW.`media_url` IS OLD.`media_url`
	AND NEW.`media_object_id` IS OLD.`media_object_id`
	AND NEW.`title` = OLD.`title`
	AND NEW.`content_html` = OLD.`content_html`
	AND NEW.`deleted_at` IS OLD.`deleted_at`
	AND NEW.`snapshot_hash` IS OLD.`snapshot_hash`
	AND NEW.`snapshot_hash_version` IS OLD.`snapshot_hash_version`
	AND NEW.`restored_from_revision` IS OLD.`restored_from_revision`
	AND NEW.`operation_record_id` IS OLD.`operation_record_id`
	AND NEW.`created_at` = OLD.`created_at`
	AND OLD.`actor_id` IS NOT NULL
	AND EXISTS (
		SELECT 1 FROM `account_deletion_jobs` AS deletion
		WHERE deletion.`status` = 'ERASED'
			AND deletion.`subject_id` = OLD.`actor_id`
			AND deletion.`erasure_alias` = NEW.`actor_id`
			AND deletion.`alias_after` <= strftime('%s', 'now')
	)
)
BEGIN
	SELECT RAISE(ABORT, 'POST_REVISION_IMMUTABLE');
END;--> statement-breakpoint

CREATE TRIGGER `qna_thread_events_immutable_update`
BEFORE UPDATE ON `qna_thread_events`
WHEN NOT (
	NEW.`id` = OLD.`id`
	AND NEW.`thread_id` = OLD.`thread_id`
	AND NEW.`event_number` = OLD.`event_number`
	AND NEW.`event_type` = OLD.`event_type`
	AND NEW.`title` = OLD.`title`
	AND NEW.`status` = OLD.`status`
	AND NEW.`reply_id` IS OLD.`reply_id`
	AND NEW.`deleted_at` IS OLD.`deleted_at`
	AND NEW.`event_hash` IS OLD.`event_hash`
	AND NEW.`event_hash_version` IS OLD.`event_hash_version`
	AND NEW.`operation_record_id` IS OLD.`operation_record_id`
	AND NEW.`created_at` = OLD.`created_at`
	AND OLD.`actor_id` IS NOT NULL
	AND EXISTS (
		SELECT 1 FROM `account_deletion_jobs` AS deletion
		WHERE deletion.`status` = 'ERASED'
			AND deletion.`subject_id` = OLD.`actor_id`
			AND deletion.`erasure_alias` = NEW.`actor_id`
			AND deletion.`alias_after` <= strftime('%s', 'now')
	)
)
BEGIN
	SELECT RAISE(ABORT, 'QNA_THREAD_EVENT_IMMUTABLE');
END;--> statement-breakpoint

CREATE TRIGGER `comments_before_delete_trashed_post`
BEFORE DELETE ON `comments`
WHEN EXISTS (
	SELECT 1 FROM `posts`
	WHERE `id` = OLD.`post_id` AND `deleted_at` IS NOT NULL
)
	AND NOT EXISTS (
		SELECT 1 FROM `account_deletion_jobs`
		WHERE `subject_id` = OLD.`author_id` AND `status` = 'ERASING'
	)
BEGIN
	SELECT RAISE(ABORT, 'COMMENT_TRASHED_POST_IMMUTABLE');
END;--> statement-breakpoint

CREATE TRIGGER `qna_replies_guard_delete`
BEFORE DELETE ON `qna_replies`
WHEN (
	EXISTS (SELECT 1 FROM `qna_threads` WHERE `id` = OLD.`thread_id`)
	OR NOT EXISTS (
		SELECT 1 FROM `document_tombstones`
		WHERE `resource_type` = 'QNA_THREAD' AND `resource_id` = OLD.`thread_id`
	)
)
	AND NOT EXISTS (
		SELECT 1 FROM `account_deletion_jobs`
		WHERE `subject_id` = OLD.`author_id` AND `status` = 'ERASING'
	)
BEGIN
	SELECT RAISE(ABORT, 'QNA_REPLY_DELETE_GUARD');
END;--> statement-breakpoint

CREATE TRIGGER `profiles_before_insert_erased_identity`
BEFORE INSERT ON `profiles`
WHEN EXISTS (
	SELECT 1 FROM `account_deletion_jobs`
	WHERE `subject_id` = NEW.`id` AND `status` IN ('ERASING', 'ERASED')
)
BEGIN
	SELECT RAISE(ABORT, 'PROFILE_ERASED_ID_REUSE_BLOCKED');
END;--> statement-breakpoint

CREATE TRIGGER `profiles_before_insert_existing`
BEFORE INSERT ON `profiles`
WHEN EXISTS (
	SELECT 1 FROM `profiles`
	WHERE `id` = NEW.`id` OR `email` = NEW.`email`
)
BEGIN
	SELECT RAISE(ABORT, 'PROFILE_DUPLICATE');
END;--> statement-breakpoint

CREATE TRIGGER `profiles_update_identity_guard`
BEFORE UPDATE ON `profiles`
WHEN NEW.`id` <> OLD.`id`
	OR EXISTS (
		SELECT 1 FROM `profiles` AS existing
		WHERE existing.`id` <> OLD.`id`
			AND (
				existing.`id` = NEW.`id`
				OR existing.`email` = NEW.`email`
			)
	)
BEGIN
	SELECT RAISE(ABORT, 'PROFILE_IDENTITY_UPDATE_INVALID');
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
SELECT 'ACCOUNT_PRIVACY_FOREIGN_KEY_CHECK_FAILED'
FROM pragma_foreign_key_check
LIMIT 1;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
