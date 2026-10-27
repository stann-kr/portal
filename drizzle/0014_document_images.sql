-- 본문 이미지(DOCUMENT_IMAGE)와 노트 귀속(PRIVATE_NOTE)을 허용하도록 media_objects CHECK를 넓힌다.
-- 0012와 같은 방식으로 media_objects를 참조하는 trigger를 내리고 table rebuild 뒤 다시 만든다.
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
DROP TRIGGER `media_deletion_outbox_before_insert_match`;--> statement-breakpoint
DROP TRIGGER `posts_media_guard_insert`;--> statement-breakpoint
DROP TRIGGER `posts_media_guard_update`;--> statement-breakpoint
DROP TRIGGER `post_revisions_media_guard_insert`;--> statement-breakpoint
DROP TRIGGER `qna_replies_media_guard_insert`;--> statement-breakpoint
DROP TRIGGER `posts_before_delete_media_pending`;--> statement-breakpoint
DROP TRIGGER `qna_threads_before_delete_media_pending`;--> statement-breakpoint
DROP TRIGGER `profiles_before_delete_document_history`;--> statement-breakpoint
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
	CONSTRAINT "media_objects_purpose_check" CHECK("__new_media_objects"."purpose" IN ('COMMUNITY_POST_AUDIO', 'QNA_ATTACHMENT', 'DOCUMENT_IMAGE')),
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
      ) OR (
        "__new_media_objects"."purpose" = 'DOCUMENT_IMAGE'
        AND "__new_media_objects"."upload_object_key" = 'media-upload/document-image/' || "__new_media_objects"."id"
        AND length("__new_media_objects"."object_key") = 57
        AND substr("__new_media_objects"."object_key", 1, 21) = 'media/document-image/'
        AND substr("__new_media_objects"."object_key", 30, 1) = '-'
        AND substr("__new_media_objects"."object_key", 35, 1) = '-'
        AND substr("__new_media_objects"."object_key", 40, 1) = '-'
        AND substr("__new_media_objects"."object_key", 45, 1) = '-'
        AND length(replace(substr("__new_media_objects"."object_key", 22), '-', '')) = 32
        AND replace(substr("__new_media_objects"."object_key", 22), '-', '') NOT GLOB '*[^0-9a-f]*'
        AND substr("__new_media_objects"."object_key", 36, 1) = '4'
        AND substr("__new_media_objects"."object_key", 41, 1) GLOB '[89ab]'
        AND "__new_media_objects"."object_key" <> 'media/document-image/' || "__new_media_objects"."id"
      )),
	CONSTRAINT "media_objects_size_check" CHECK("__new_media_objects"."expected_size_bytes" > 0 AND ("__new_media_objects"."actual_size_bytes" IS NULL OR "__new_media_objects"."actual_size_bytes" > 0)),
	CONSTRAINT "media_objects_resource_type_check" CHECK("__new_media_objects"."resource_type" IS NULL OR "__new_media_objects"."resource_type" IN ('COMMUNITY_POST', 'QNA_REPLY', 'PRIVATE_NOTE')),
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
CREATE INDEX `media_objects_resource_idx` ON `media_objects` (`resource_type`,`resource_id`);--> statement-breakpoint

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

CREATE TRIGGER `private_notes_before_delete_media_pending`
BEFORE DELETE ON `private_notes`
WHEN EXISTS (
	SELECT 1 FROM `media_objects`
	WHERE `resource_type` = 'PRIVATE_NOTE'
		AND `resource_id` = OLD.`id`
		AND `state` = 'ATTACHED'
)
BEGIN
	SELECT RAISE(ABORT, 'PRIVATE_NOTE_MEDIA_DELETE_NOT_QUEUED');
END;--> statement-breakpoint

INSERT INTO `document_batch_abort_guard` (`reason`)
SELECT 'DOCUMENT_IMAGE_FOREIGN_KEY_CHECK_FAILED'
FROM pragma_foreign_key_check
LIMIT 1;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
