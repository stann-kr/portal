ALTER TABLE `document_tombstones` ADD `group_id` text;--> statement-breakpoint
-- 계정 삭제 때 다른 사람이 만든 그룹 노트에 이 계정이 올린 본문 이미지는 노트와 함께 남긴다(2026-11-16).
-- ATTACHED 그대로 owner를 그 노트의 주인(student_id)에게 넘기는 전이를 삭제 중(ERASING)인 계정에만 연다.
-- SQLite trigger 발화 순서를 0014와 같게 두려고 media_objects UPDATE trigger 넷을 같은 순서로 다시 만든다(payload·outbox guard는 0014 그대로).
DROP TRIGGER `media_objects_immutable_identity`;--> statement-breakpoint
DROP TRIGGER `media_objects_transition_guard`;--> statement-breakpoint
DROP TRIGGER `media_objects_transition_payload_guard`;--> statement-breakpoint
DROP TRIGGER `media_objects_deletion_outbox_guard`;--> statement-breakpoint
CREATE TRIGGER `media_objects_immutable_identity`
BEFORE UPDATE ON `media_objects`
WHEN NEW.`id` <> OLD.`id`
	OR (
		NEW.`owner_id` IS NOT OLD.`owner_id`
		AND NOT (
			OLD.`owner_id` IS NOT NULL
			AND (
				(NEW.`owner_id` IS NULL AND OLD.`state` IN ('PENDING_DELETE', 'DELETED'))
				OR (
					OLD.`state` = 'ATTACHED'
					AND NEW.`state` = 'ATTACHED'
					AND OLD.`purpose` = 'DOCUMENT_IMAGE'
					AND OLD.`resource_type` = 'PRIVATE_NOTE'
					AND NEW.`owner_id` IS NOT NULL
					AND NEW.`owner_id` IS (
						SELECT kept_note.`student_id` FROM `private_notes` AS kept_note
						WHERE kept_note.`id` = OLD.`resource_id`
							AND kept_note.`group_id` IS NOT NULL
							AND kept_note.`student_id` <> OLD.`owner_id`
							AND kept_note.`author_id` <> OLD.`owner_id`
					)
				)
			)
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
	OR (
		OLD.`state` = 'ATTACHED'
		AND NEW.`state` = 'ATTACHED'
		AND OLD.`owner_id` IS NOT NULL
		AND OLD.`purpose` = 'DOCUMENT_IMAGE'
		AND OLD.`resource_type` = 'PRIVATE_NOTE'
		AND NEW.`owner_id` IS NOT NULL
		AND NEW.`owner_id` IS (
			SELECT kept_note.`student_id` FROM `private_notes` AS kept_note
			WHERE kept_note.`id` = OLD.`resource_id`
				AND kept_note.`group_id` IS NOT NULL
				AND kept_note.`student_id` <> OLD.`owner_id`
				AND kept_note.`author_id` <> OLD.`owner_id`
		)
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
END;
