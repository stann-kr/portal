PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint
INSERT INTO `document_batch_abort_guard` (`reason`)
SELECT 'DOCUMENT_LEDGER_INBOUND_FOREIGN_KEY'
FROM (
	SELECT `name`
	FROM `sqlite_master`
	WHERE `type` = 'table'
		AND `name` NOT LIKE 'sqlite_%'
		AND lower(`name`) NOT GLOB '_cf_*'
		AND `name` <> 'private_note_revisions'
) AS `m`
JOIN pragma_foreign_key_list(`m`.`name`) AS `fk`
WHERE `fk`.`table` = 'document_operation_ledger'
LIMIT 1;
--> statement-breakpoint
DROP TRIGGER `document_operation_ledger_before_insert_existing`;
--> statement-breakpoint
DROP TRIGGER `document_operation_ledger_immutable_delete`;
--> statement-breakpoint
DROP TRIGGER `document_operation_ledger_immutable_update`;
--> statement-breakpoint
DROP TRIGGER `document_tombstones_before_insert_existing`;
--> statement-breakpoint
DROP TRIGGER `document_tombstones_immutable_delete`;
--> statement-breakpoint
DROP TRIGGER `document_tombstones_immutable_update`;
--> statement-breakpoint
DROP TRIGGER `private_note_revisions_before_insert_baseline`;
--> statement-breakpoint
DROP TRIGGER `private_note_revisions_before_insert_existing`;
--> statement-breakpoint
DROP TRIGGER `private_note_revisions_before_insert_receipt_match`;
--> statement-breakpoint
DROP TRIGGER `private_note_revisions_guard_delete`;
--> statement-breakpoint
DROP TRIGGER `private_note_revisions_immutable_update`;
--> statement-breakpoint
DROP TRIGGER `private_notes_before_delete_tombstone`;
--> statement-breakpoint
DROP TRIGGER `private_notes_before_insert_tombstone`;
--> statement-breakpoint
CREATE TABLE `__new_document_operation_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`operation_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`request_hash_version` integer NOT NULL,
	`result_revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "document_operation_ledger_resource_type_check" CHECK(`resource_type` IN ('PRIVATE_NOTE', 'COMMUNITY_POST', 'QNA_THREAD')),
	CONSTRAINT "document_operation_ledger_operation_type_check" CHECK(`operation_type` IN ('CREATE', 'UPDATE', 'SET_PIN', 'APPEND_REPLY', 'SET_STATUS', 'TRASH', 'RESTORE_TRASH', 'RESTORE_REVISION', 'PURGE')),
	CONSTRAINT "document_operation_ledger_resource_operation_check" CHECK((
		`resource_type` = 'PRIVATE_NOTE'
		AND `operation_type` IN ('CREATE', 'UPDATE', 'TRASH', 'RESTORE_TRASH', 'RESTORE_REVISION', 'PURGE')
	) OR (
		`resource_type` = 'COMMUNITY_POST'
		AND `operation_type` IN ('CREATE', 'UPDATE', 'SET_PIN', 'TRASH', 'RESTORE_TRASH', 'RESTORE_REVISION', 'PURGE')
	) OR (
		`resource_type` = 'QNA_THREAD'
		AND `operation_type` IN ('CREATE', 'APPEND_REPLY', 'SET_STATUS', 'TRASH', 'RESTORE_TRASH', 'PURGE')
	)),
	CONSTRAINT "document_operation_ledger_nonempty_ids_check" CHECK(length(`operation_id`) > 0 AND length(`actor_id`) > 0 AND length(`subject_id`) > 0 AND length(`resource_id`) > 0),
	CONSTRAINT "document_operation_ledger_request_hash_check" CHECK(length(`request_hash`) = 64 AND `request_hash_version` >= 1),
	CONSTRAINT "document_operation_ledger_result_revision_check" CHECK(`result_revision` >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_document_operation_ledger` (
	`id`, `operation_id`, `actor_id`, `subject_id`, `resource_type`,
	`operation_type`, `resource_id`, `request_hash`, `request_hash_version`,
	`result_revision`, `created_at`
)
SELECT
	`id`, `operation_id`, `actor_id`, `subject_id`, `resource_type`,
	`operation_type`, `resource_id`, `request_hash`, `request_hash_version`,
	`result_revision`, `created_at`
FROM `document_operation_ledger`;
--> statement-breakpoint
CREATE TABLE `__new_document_tombstones` (
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`source_created_at` integer,
	`source_version` integer NOT NULL,
	`purged_at` integer NOT NULL,
	`purged_by_id` text,
	PRIMARY KEY (`resource_type`, `resource_id`),
	CONSTRAINT "document_tombstones_resource_type_check" CHECK(`resource_type` IN ('PRIVATE_NOTE', 'COMMUNITY_POST', 'QNA_THREAD')),
	CONSTRAINT "document_tombstones_nonempty_ids_check" CHECK(length(`resource_id`) > 0 AND length(`subject_id`) > 0 AND length(`owner_id`) > 0),
	CONSTRAINT "document_tombstones_source_version_check" CHECK(`source_version` >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_document_tombstones` (
	`resource_type`, `resource_id`, `subject_id`, `owner_id`,
	`source_created_at`, `source_version`, `purged_at`, `purged_by_id`
)
SELECT
	`resource_type`, `resource_id`, `subject_id`, `owner_id`,
	`source_created_at`, `source_version`, `purged_at`, `purged_by_id`
FROM `document_tombstones`;
--> statement-breakpoint
CREATE TABLE `__new_private_note_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`change_type` text NOT NULL,
	`title` text NOT NULL,
	`content_html` text NOT NULL,
	`note_date` integer,
	`deleted_at` integer,
	`snapshot_hash` text,
	`snapshot_hash_version` integer,
	`actor_id` text,
	`restored_from_revision` integer,
	`operation_record_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `private_notes` (`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operation_record_id`) REFERENCES `__new_document_operation_ledger` (`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "private_note_revisions_number_check" CHECK(`revision_number` >= 1),
	CONSTRAINT "private_note_revisions_change_type_check" CHECK(`change_type` IN ('BASELINE', 'CREATE', 'UPDATE', 'RESTORE_REVISION', 'TRASH', 'RESTORE_TRASH')),
	CONSTRAINT "private_note_revisions_identity_check" CHECK((
		`change_type` = 'BASELINE'
		AND `revision_number` = 1
		AND `actor_id` IS NULL
		AND `snapshot_hash` IS NULL
		AND `snapshot_hash_version` IS NULL
		AND `operation_record_id` IS NULL
	) OR (
		`change_type` <> 'BASELINE'
		AND `actor_id` IS NOT NULL
		AND length(`actor_id`) > 0
		AND `snapshot_hash` IS NOT NULL
		AND length(`snapshot_hash`) = 64
		AND `snapshot_hash_version` IS NOT NULL
		AND `snapshot_hash_version` >= 1
		AND `operation_record_id` IS NOT NULL
	)),
	CONSTRAINT "private_note_revisions_initial_number_check" CHECK((
		`change_type` IN ('CREATE', 'BASELINE')
		AND `revision_number` = 1
	) OR (
		`change_type` NOT IN ('CREATE', 'BASELINE')
		AND `revision_number` > 1
	)),
	CONSTRAINT "private_note_revisions_deleted_state_check" CHECK((
		`change_type` = 'TRASH'
		AND `deleted_at` IS NOT NULL
	) OR (
		`change_type` <> 'TRASH'
		AND `deleted_at` IS NULL
	)),
	CONSTRAINT "private_note_revisions_restore_source_check" CHECK((
		`change_type` = 'RESTORE_REVISION'
		AND `restored_from_revision` IS NOT NULL
		AND `restored_from_revision` >= 1
	) OR (
		`change_type` <> 'RESTORE_REVISION'
		AND `restored_from_revision` IS NULL
	))
);
--> statement-breakpoint
INSERT INTO `__new_private_note_revisions` (
	`id`, `note_id`, `revision_number`, `change_type`, `title`,
	`content_html`, `note_date`, `deleted_at`, `snapshot_hash`,
	`snapshot_hash_version`, `actor_id`, `restored_from_revision`,
	`operation_record_id`, `created_at`
)
SELECT
	`id`, `note_id`, `revision_number`, `change_type`, `title`,
	`content_html`, `note_date`, `deleted_at`, `snapshot_hash`,
	`snapshot_hash_version`, `actor_id`, `restored_from_revision`,
	`operation_record_id`, `created_at`
FROM `private_note_revisions`;
--> statement-breakpoint
DROP TABLE `private_note_revisions`;
--> statement-breakpoint
DROP TABLE `document_operation_ledger`;
--> statement-breakpoint
DROP TABLE `document_tombstones`;
--> statement-breakpoint
ALTER TABLE `__new_document_operation_ledger` RENAME TO `document_operation_ledger`;
--> statement-breakpoint
ALTER TABLE `__new_document_tombstones` RENAME TO `document_tombstones`;
--> statement-breakpoint
ALTER TABLE `__new_private_note_revisions` RENAME TO `private_note_revisions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `document_operation_ledger_actor_operation_unique`
ON `document_operation_ledger` (`actor_id`, `operation_id`);
--> statement-breakpoint
CREATE INDEX `document_operation_ledger_resource_created_idx`
ON `document_operation_ledger` (`resource_type`, `resource_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `document_tombstones_subject_purged_idx`
ON `document_tombstones` (`resource_type`, `subject_id`, `purged_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `private_note_revisions_note_number_unique`
ON `private_note_revisions` (`note_id`, `revision_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `private_note_revisions_operation_unique`
ON `private_note_revisions` (`operation_record_id`);
--> statement-breakpoint
CREATE INDEX `private_note_revisions_note_created_idx`
ON `private_note_revisions` (`note_id`, `created_at`);
--> statement-breakpoint
CREATE TRIGGER `document_operation_ledger_immutable_update`
BEFORE UPDATE ON `document_operation_ledger`
BEGIN
	SELECT RAISE(ABORT, 'DOCUMENT_LEDGER_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `document_operation_ledger_immutable_delete`
BEFORE DELETE ON `document_operation_ledger`
BEGIN
	SELECT RAISE(ABORT, 'DOCUMENT_LEDGER_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `document_operation_ledger_before_insert_existing`
BEFORE INSERT ON `document_operation_ledger`
WHEN EXISTS (
	SELECT 1
	FROM `document_operation_ledger`
	WHERE `id` = NEW.`id`
		OR (`actor_id` = NEW.`actor_id` AND `operation_id` = NEW.`operation_id`)
)
BEGIN
	SELECT RAISE(ABORT, 'DOCUMENT_LEDGER_DUPLICATE');
END;
--> statement-breakpoint
CREATE TRIGGER `document_tombstones_immutable_update`
BEFORE UPDATE ON `document_tombstones`
BEGIN
	SELECT RAISE(ABORT, 'DOCUMENT_TOMBSTONE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `document_tombstones_immutable_delete`
BEFORE DELETE ON `document_tombstones`
BEGIN
	SELECT RAISE(ABORT, 'DOCUMENT_TOMBSTONE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `document_tombstones_before_insert_existing`
BEFORE INSERT ON `document_tombstones`
WHEN EXISTS (
	SELECT 1
	FROM `document_tombstones`
	WHERE `resource_type` = NEW.`resource_type`
		AND `resource_id` = NEW.`resource_id`
)
BEGIN
	SELECT RAISE(ABORT, 'DOCUMENT_TOMBSTONE_DUPLICATE');
END;
--> statement-breakpoint
CREATE TRIGGER `private_note_revisions_immutable_update`
BEFORE UPDATE ON `private_note_revisions`
BEGIN
	SELECT RAISE(ABORT, 'PRIVATE_NOTE_REVISION_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `private_note_revisions_guard_delete`
BEFORE DELETE ON `private_note_revisions`
WHEN EXISTS (
	SELECT 1 FROM `private_notes` WHERE `id` = OLD.`note_id`
) OR NOT EXISTS (
	SELECT 1
	FROM `document_tombstones`
	WHERE `resource_type` = 'PRIVATE_NOTE'
		AND `resource_id` = OLD.`note_id`
)
BEGIN
	SELECT RAISE(ABORT, 'PRIVATE_NOTE_REVISION_DELETE_GUARD');
END;
--> statement-breakpoint
CREATE TRIGGER `private_note_revisions_before_insert_existing`
BEFORE INSERT ON `private_note_revisions`
WHEN EXISTS (
	SELECT 1
	FROM `private_note_revisions`
	WHERE `id` = NEW.`id`
		OR (`note_id` = NEW.`note_id` AND `revision_number` = NEW.`revision_number`)
		OR (NEW.`operation_record_id` IS NOT NULL AND `operation_record_id` = NEW.`operation_record_id`)
)
BEGIN
	SELECT RAISE(ABORT, 'PRIVATE_NOTE_REVISION_DUPLICATE');
END;
--> statement-breakpoint
CREATE TRIGGER `private_note_revisions_before_insert_receipt_match`
BEFORE INSERT ON `private_note_revisions`
WHEN NEW.`change_type` <> 'BASELINE'
	AND NOT EXISTS (
		SELECT 1
		FROM `document_operation_ledger` AS `ledger`
		JOIN `private_notes` AS `note` ON `note`.`id` = NEW.`note_id`
		WHERE `ledger`.`id` = NEW.`operation_record_id`
			AND `ledger`.`resource_type` = 'PRIVATE_NOTE'
			AND `ledger`.`resource_id` = NEW.`note_id`
			AND `ledger`.`result_revision` = NEW.`revision_number`
			AND `ledger`.`actor_id` = NEW.`actor_id`
			AND `ledger`.`subject_id` = `note`.`student_id`
			AND `ledger`.`operation_type` = NEW.`change_type`
	)
BEGIN
	SELECT RAISE(ABORT, 'PRIVATE_NOTE_REVISION_RECEIPT_MISMATCH');
END;
--> statement-breakpoint
CREATE TRIGGER `private_note_revisions_before_insert_baseline`
BEFORE INSERT ON `private_note_revisions`
WHEN NEW.`change_type` = 'BASELINE'
BEGIN
	SELECT RAISE(ABORT, 'PRIVATE_NOTE_BASELINE_CLOSED');
END;
--> statement-breakpoint
CREATE TRIGGER `private_notes_before_insert_tombstone`
BEFORE INSERT ON `private_notes`
WHEN EXISTS (
	SELECT 1
	FROM `document_tombstones`
	WHERE `resource_type` = 'PRIVATE_NOTE'
		AND `resource_id` = NEW.`id`
)
BEGIN
	SELECT RAISE(ABORT, 'PRIVATE_NOTE_RESURRECTION_BLOCKED');
END;
--> statement-breakpoint
CREATE TRIGGER `private_notes_before_delete_tombstone`
BEFORE DELETE ON `private_notes`
BEGIN
	INSERT INTO `document_tombstones` (
		`resource_type`, `resource_id`, `subject_id`, `owner_id`,
		`source_created_at`, `source_version`, `purged_at`, `purged_by_id`
	)
	SELECT
		'PRIVATE_NOTE', OLD.`id`, OLD.`student_id`, OLD.`author_id`,
		OLD.`created_at`, OLD.`version`, strftime('%s', 'now'), NULL
	WHERE NOT EXISTS (
		SELECT 1
		FROM `document_tombstones`
		WHERE `resource_type` = 'PRIVATE_NOTE'
			AND `resource_id` = OLD.`id`
	);
END;
--> statement-breakpoint
ALTER TABLE `posts`
ADD COLUMN `updated_at` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `posts`
ADD COLUMN `version` integer DEFAULT 1 NOT NULL
CONSTRAINT "posts_version_check" CHECK(`version` >= 1);
--> statement-breakpoint
ALTER TABLE `posts`
ADD COLUMN `deleted_at` integer;
--> statement-breakpoint
ALTER TABLE `posts`
ADD COLUMN `deleted_by_id` text REFERENCES `profiles` (`id`) ON DELETE set null;
--> statement-breakpoint
UPDATE `posts`
SET `updated_at` = COALESCE(`created_at`, strftime('%s', 'now'))
WHERE `updated_at` = 0;
--> statement-breakpoint
CREATE INDEX `posts_board_deleted_pinned_created_idx`
ON `posts` (`board_type`, `deleted_at`, `is_pinned`, `created_at`);
--> statement-breakpoint
CREATE INDEX `posts_author_deleted_created_idx`
ON `posts` (`author_id`, `deleted_at`, `created_at`);
--> statement-breakpoint
CREATE INDEX `posts_deleted_at_idx`
ON `posts` (`deleted_at`);
--> statement-breakpoint
CREATE TABLE `post_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`change_type` text NOT NULL,
	`category` text NOT NULL,
	`board_type` text NOT NULL,
	`is_pinned` integer NOT NULL,
	`media_url` text,
	`title` text NOT NULL,
	`content_html` text NOT NULL,
	`deleted_at` integer,
	`snapshot_hash` text,
	`snapshot_hash_version` integer,
	`actor_id` text,
	`restored_from_revision` integer,
	`operation_record_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operation_record_id`) REFERENCES `document_operation_ledger` (`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "post_revisions_number_check" CHECK(`revision_number` >= 1),
	CONSTRAINT "post_revisions_change_type_check" CHECK(`change_type` IN ('BASELINE', 'CREATE', 'UPDATE', 'SET_PIN', 'RESTORE_REVISION', 'TRASH', 'RESTORE_TRASH')),
	CONSTRAINT "post_revisions_identity_check" CHECK((
		`change_type` = 'BASELINE'
		AND `revision_number` = 1
		AND `actor_id` IS NULL
		AND `snapshot_hash` IS NULL
		AND `snapshot_hash_version` IS NULL
		AND `operation_record_id` IS NULL
	) OR (
		`change_type` <> 'BASELINE'
		AND `actor_id` IS NOT NULL
		AND length(`actor_id`) > 0
		AND `snapshot_hash` IS NOT NULL
		AND length(`snapshot_hash`) = 64
		AND `snapshot_hash_version` IS NOT NULL
		AND `snapshot_hash_version` >= 1
		AND `operation_record_id` IS NOT NULL
	)),
	CONSTRAINT "post_revisions_initial_number_check" CHECK((
		`change_type` IN ('CREATE', 'BASELINE') AND `revision_number` = 1
	) OR (
		`change_type` NOT IN ('CREATE', 'BASELINE') AND `revision_number` > 1
	)),
	CONSTRAINT "post_revisions_deleted_state_check" CHECK((
		`change_type` = 'TRASH' AND `deleted_at` IS NOT NULL
	) OR (
		`change_type` <> 'TRASH' AND `deleted_at` IS NULL
	)),
	CONSTRAINT "post_revisions_restore_source_check" CHECK((
		`change_type` = 'RESTORE_REVISION'
		AND `restored_from_revision` IS NOT NULL
		AND `restored_from_revision` >= 1
	) OR (
		`change_type` <> 'RESTORE_REVISION'
		AND `restored_from_revision` IS NULL
	))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_revisions_post_number_unique`
ON `post_revisions` (`post_id`, `revision_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_revisions_operation_unique`
ON `post_revisions` (`operation_record_id`);
--> statement-breakpoint
CREATE INDEX `post_revisions_post_created_idx`
ON `post_revisions` (`post_id`, `created_at`);
--> statement-breakpoint
INSERT INTO `post_revisions` (
	`id`, `post_id`, `revision_number`, `change_type`, `category`,
	`board_type`, `is_pinned`, `media_url`, `title`, `content_html`,
	`deleted_at`, `snapshot_hash`, `snapshot_hash_version`, `actor_id`,
	`restored_from_revision`, `operation_record_id`, `created_at`
)
SELECT
	'baseline:' || `id`, `id`, 1, 'BASELINE', `category`,
	`board_type`, `is_pinned`, `media_url`, `title`, `content_html`,
	NULL, NULL, NULL, NULL, NULL, NULL, `updated_at`
FROM `posts`;
--> statement-breakpoint
CREATE TRIGGER `post_revisions_immutable_update`
BEFORE UPDATE ON `post_revisions`
BEGIN
	SELECT RAISE(ABORT, 'POST_REVISION_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `post_revisions_guard_delete`
BEFORE DELETE ON `post_revisions`
WHEN EXISTS (
	SELECT 1 FROM `posts` WHERE `id` = OLD.`post_id`
) OR NOT EXISTS (
	SELECT 1 FROM `document_tombstones`
	WHERE `resource_type` = 'COMMUNITY_POST' AND `resource_id` = OLD.`post_id`
)
BEGIN
	SELECT RAISE(ABORT, 'POST_REVISION_DELETE_GUARD');
END;
--> statement-breakpoint
CREATE TRIGGER `post_revisions_before_insert_existing`
BEFORE INSERT ON `post_revisions`
WHEN EXISTS (
	SELECT 1 FROM `post_revisions`
	WHERE `id` = NEW.`id`
		OR (`post_id` = NEW.`post_id` AND `revision_number` = NEW.`revision_number`)
		OR (NEW.`operation_record_id` IS NOT NULL AND `operation_record_id` = NEW.`operation_record_id`)
)
BEGIN
	SELECT RAISE(ABORT, 'POST_REVISION_DUPLICATE');
END;
--> statement-breakpoint
CREATE TRIGGER `post_revisions_before_insert_receipt_match`
BEFORE INSERT ON `post_revisions`
WHEN NEW.`change_type` <> 'BASELINE'
	AND NOT EXISTS (
		SELECT 1
		FROM `document_operation_ledger` AS `ledger`
		JOIN `posts` AS `post` ON `post`.`id` = NEW.`post_id`
		WHERE `ledger`.`id` = NEW.`operation_record_id`
			AND `ledger`.`resource_type` = 'COMMUNITY_POST'
			AND `ledger`.`resource_id` = NEW.`post_id`
			AND `ledger`.`result_revision` = NEW.`revision_number`
			AND `ledger`.`actor_id` = NEW.`actor_id`
			AND `ledger`.`subject_id` = `post`.`author_id`
			AND `ledger`.`operation_type` = NEW.`change_type`
	)
BEGIN
	SELECT RAISE(ABORT, 'POST_REVISION_RECEIPT_MISMATCH');
END;
--> statement-breakpoint
CREATE TRIGGER `post_revisions_before_insert_baseline`
BEFORE INSERT ON `post_revisions`
WHEN NEW.`change_type` = 'BASELINE'
BEGIN
	SELECT RAISE(ABORT, 'POST_BASELINE_CLOSED');
END;
--> statement-breakpoint
CREATE TRIGGER `posts_deleted_actor_guard_insert`
BEFORE INSERT ON `posts`
WHEN NEW.`deleted_at` IS NULL AND NEW.`deleted_by_id` IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'POST_DELETED_ACTOR_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `posts_deleted_actor_guard_update`
BEFORE UPDATE ON `posts`
WHEN NEW.`deleted_at` IS NULL AND NEW.`deleted_by_id` IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'POST_DELETED_ACTOR_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `posts_before_insert_tombstone`
BEFORE INSERT ON `posts`
WHEN EXISTS (
	SELECT 1 FROM `document_tombstones`
	WHERE `resource_type` = 'COMMUNITY_POST' AND `resource_id` = NEW.`id`
)
BEGIN
	SELECT RAISE(ABORT, 'POST_RESURRECTION_BLOCKED');
END;
--> statement-breakpoint
CREATE TRIGGER `posts_before_delete_tombstone`
BEFORE DELETE ON `posts`
BEGIN
	INSERT INTO `document_tombstones` (
		`resource_type`, `resource_id`, `subject_id`, `owner_id`,
		`source_created_at`, `source_version`, `purged_at`, `purged_by_id`
	)
	SELECT
		'COMMUNITY_POST', OLD.`id`, OLD.`author_id`, OLD.`author_id`,
		OLD.`created_at`, OLD.`version`, strftime('%s', 'now'), NULL
	WHERE NOT EXISTS (
		SELECT 1 FROM `document_tombstones`
		WHERE `resource_type` = 'COMMUNITY_POST' AND `resource_id` = OLD.`id`
	);
END;
--> statement-breakpoint
ALTER TABLE `qna_threads`
ADD COLUMN `version` integer DEFAULT 1 NOT NULL
CONSTRAINT "qna_threads_version_check" CHECK(`version` >= 1);
--> statement-breakpoint
ALTER TABLE `qna_threads`
ADD COLUMN `deleted_at` integer;
--> statement-breakpoint
ALTER TABLE `qna_threads`
ADD COLUMN `deleted_by_id` text REFERENCES `profiles` (`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `qna_threads_student_deleted_updated_idx`
ON `qna_threads` (`student_id`, `deleted_at`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `qna_threads_deleted_at_idx`
ON `qna_threads` (`deleted_at`);
--> statement-breakpoint
CREATE TABLE `qna_thread_events` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`event_number` integer NOT NULL,
	`event_type` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`reply_id` text,
	`deleted_at` integer,
	`event_hash` text,
	`event_hash_version` integer,
	`actor_id` text,
	`operation_record_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `qna_threads` (`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operation_record_id`) REFERENCES `document_operation_ledger` (`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "qna_thread_events_number_check" CHECK(`event_number` >= 1),
	CONSTRAINT "qna_thread_events_type_check" CHECK(`event_type` IN ('BASELINE', 'CREATE', 'APPEND_REPLY', 'SET_STATUS', 'TRASH', 'RESTORE_TRASH')),
	CONSTRAINT "qna_thread_events_status_check" CHECK(`status` IN ('OPEN', 'ANSWERED', 'CLOSED')),
	CONSTRAINT "qna_thread_events_identity_check" CHECK((
		`event_type` = 'BASELINE'
		AND `event_number` = 1
		AND `actor_id` IS NULL
		AND `event_hash` IS NULL
		AND `event_hash_version` IS NULL
		AND `operation_record_id` IS NULL
	) OR (
		`event_type` <> 'BASELINE'
		AND `actor_id` IS NOT NULL
		AND length(`actor_id`) > 0
		AND `event_hash` IS NOT NULL
		AND length(`event_hash`) = 64
		AND `event_hash_version` IS NOT NULL
		AND `event_hash_version` >= 1
		AND `operation_record_id` IS NOT NULL
	)),
	CONSTRAINT "qna_thread_events_initial_number_check" CHECK((
		`event_type` IN ('CREATE', 'BASELINE') AND `event_number` = 1
	) OR (
		`event_type` NOT IN ('CREATE', 'BASELINE') AND `event_number` > 1
	)),
	CONSTRAINT "qna_thread_events_deleted_state_check" CHECK((
		`event_type` = 'TRASH' AND `deleted_at` IS NOT NULL
	) OR (
		`event_type` <> 'TRASH' AND `deleted_at` IS NULL
	)),
	CONSTRAINT "qna_thread_events_reply_check" CHECK((
		`event_type` IN ('CREATE', 'APPEND_REPLY')
		AND `reply_id` IS NOT NULL
		AND length(`reply_id`) > 0
	) OR (
		`event_type` NOT IN ('CREATE', 'APPEND_REPLY')
		AND `reply_id` IS NULL
	))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qna_thread_events_thread_number_unique`
ON `qna_thread_events` (`thread_id`, `event_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `qna_thread_events_operation_unique`
ON `qna_thread_events` (`operation_record_id`);
--> statement-breakpoint
CREATE INDEX `qna_thread_events_thread_created_idx`
ON `qna_thread_events` (`thread_id`, `created_at`);
--> statement-breakpoint
INSERT INTO `qna_thread_events` (
	`id`, `thread_id`, `event_number`, `event_type`, `title`, `status`,
	`reply_id`, `deleted_at`, `event_hash`, `event_hash_version`,
	`actor_id`, `operation_record_id`, `created_at`
)
SELECT
	'baseline:' || `id`, `id`, 1, 'BASELINE', `title`, `status`,
	NULL, NULL, NULL, NULL, NULL, NULL,
	COALESCE(`updated_at`, `created_at`, strftime('%s', 'now'))
FROM `qna_threads`;
--> statement-breakpoint
CREATE TRIGGER `qna_thread_events_immutable_update`
BEFORE UPDATE ON `qna_thread_events`
BEGIN
	SELECT RAISE(ABORT, 'QNA_THREAD_EVENT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `qna_thread_events_guard_delete`
BEFORE DELETE ON `qna_thread_events`
WHEN EXISTS (
	SELECT 1 FROM `qna_threads` WHERE `id` = OLD.`thread_id`
) OR NOT EXISTS (
	SELECT 1 FROM `document_tombstones`
	WHERE `resource_type` = 'QNA_THREAD' AND `resource_id` = OLD.`thread_id`
)
BEGIN
	SELECT RAISE(ABORT, 'QNA_THREAD_EVENT_DELETE_GUARD');
END;
--> statement-breakpoint
CREATE TRIGGER `qna_thread_events_before_insert_existing`
BEFORE INSERT ON `qna_thread_events`
WHEN EXISTS (
	SELECT 1 FROM `qna_thread_events`
	WHERE `id` = NEW.`id`
		OR (`thread_id` = NEW.`thread_id` AND `event_number` = NEW.`event_number`)
		OR (NEW.`operation_record_id` IS NOT NULL AND `operation_record_id` = NEW.`operation_record_id`)
)
BEGIN
	SELECT RAISE(ABORT, 'QNA_THREAD_EVENT_DUPLICATE');
END;
--> statement-breakpoint
CREATE TRIGGER `qna_thread_events_before_insert_receipt_match`
BEFORE INSERT ON `qna_thread_events`
WHEN NEW.`event_type` <> 'BASELINE'
	AND NOT EXISTS (
		SELECT 1
		FROM `document_operation_ledger` AS `ledger`
		JOIN `qna_threads` AS `thread` ON `thread`.`id` = NEW.`thread_id`
		WHERE `ledger`.`id` = NEW.`operation_record_id`
			AND `ledger`.`resource_type` = 'QNA_THREAD'
			AND `ledger`.`resource_id` = NEW.`thread_id`
			AND `ledger`.`result_revision` = NEW.`event_number`
			AND `ledger`.`actor_id` = NEW.`actor_id`
			AND `ledger`.`subject_id` = `thread`.`student_id`
			AND `ledger`.`operation_type` = NEW.`event_type`
	)
BEGIN
	SELECT RAISE(ABORT, 'QNA_THREAD_EVENT_RECEIPT_MISMATCH');
END;
--> statement-breakpoint
CREATE TRIGGER `qna_thread_events_before_insert_baseline`
BEFORE INSERT ON `qna_thread_events`
WHEN NEW.`event_type` = 'BASELINE'
BEGIN
	SELECT RAISE(ABORT, 'QNA_THREAD_BASELINE_CLOSED');
END;
--> statement-breakpoint
CREATE TRIGGER `qna_replies_immutable_update`
BEFORE UPDATE ON `qna_replies`
BEGIN
	SELECT RAISE(ABORT, 'QNA_REPLY_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `qna_replies_before_insert_existing`
BEFORE INSERT ON `qna_replies`
WHEN EXISTS (SELECT 1 FROM `qna_replies` WHERE `id` = NEW.`id`)
BEGIN
	SELECT RAISE(ABORT, 'QNA_REPLY_DUPLICATE');
END;
--> statement-breakpoint
CREATE TRIGGER `qna_replies_before_insert_receipt_match`
BEFORE INSERT ON `qna_replies`
WHEN NOT EXISTS (
	SELECT 1
	FROM `qna_threads` AS `thread`
	JOIN `document_operation_ledger` AS `ledger`
		ON `ledger`.`resource_type` = 'QNA_THREAD'
		AND `ledger`.`resource_id` = `thread`.`id`
		AND `ledger`.`actor_id` = NEW.`author_id`
		AND `ledger`.`subject_id` = `thread`.`student_id`
		AND `ledger`.`result_revision` = `thread`.`version`
		AND `ledger`.`operation_type` IN ('CREATE', 'APPEND_REPLY')
	WHERE `thread`.`id` = NEW.`thread_id`
		AND `thread`.`deleted_at` IS NULL
		AND `thread`.`status` <> 'CLOSED'
		AND NOT EXISTS (
			SELECT 1 FROM `qna_thread_events` AS `event`
			WHERE `event`.`operation_record_id` = `ledger`.`id`
		)
)
BEGIN
	SELECT RAISE(ABORT, 'QNA_REPLY_RECEIPT_MISMATCH');
END;
--> statement-breakpoint
CREATE TRIGGER `qna_replies_guard_delete`
BEFORE DELETE ON `qna_replies`
WHEN EXISTS (
	SELECT 1 FROM `qna_threads` WHERE `id` = OLD.`thread_id`
) OR NOT EXISTS (
	SELECT 1 FROM `document_tombstones`
	WHERE `resource_type` = 'QNA_THREAD' AND `resource_id` = OLD.`thread_id`
)
BEGIN
	SELECT RAISE(ABORT, 'QNA_REPLY_DELETE_GUARD');
END;
--> statement-breakpoint
CREATE TRIGGER `qna_threads_deleted_actor_guard_insert`
BEFORE INSERT ON `qna_threads`
WHEN (NEW.`deleted_at` IS NULL AND NEW.`deleted_by_id` IS NOT NULL)
	OR NEW.`status` NOT IN ('OPEN', 'ANSWERED', 'CLOSED')
BEGIN
	SELECT RAISE(ABORT, 'QNA_THREAD_STATE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `qna_threads_deleted_actor_guard_update`
BEFORE UPDATE ON `qna_threads`
WHEN (NEW.`deleted_at` IS NULL AND NEW.`deleted_by_id` IS NOT NULL)
	OR NEW.`status` NOT IN ('OPEN', 'ANSWERED', 'CLOSED')
BEGIN
	SELECT RAISE(ABORT, 'QNA_THREAD_STATE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `qna_threads_before_insert_tombstone`
BEFORE INSERT ON `qna_threads`
WHEN EXISTS (
	SELECT 1 FROM `document_tombstones`
	WHERE `resource_type` = 'QNA_THREAD' AND `resource_id` = NEW.`id`
)
BEGIN
	SELECT RAISE(ABORT, 'QNA_THREAD_RESURRECTION_BLOCKED');
END;
--> statement-breakpoint
CREATE TRIGGER `qna_threads_before_delete_tombstone`
BEFORE DELETE ON `qna_threads`
BEGIN
	INSERT INTO `document_tombstones` (
		`resource_type`, `resource_id`, `subject_id`, `owner_id`,
		`source_created_at`, `source_version`, `purged_at`, `purged_by_id`
	)
	SELECT
		'QNA_THREAD', OLD.`id`, OLD.`student_id`, OLD.`student_id`,
		OLD.`created_at`, OLD.`version`, strftime('%s', 'now'), NULL
	WHERE NOT EXISTS (
		SELECT 1 FROM `document_tombstones`
		WHERE `resource_type` = 'QNA_THREAD' AND `resource_id` = OLD.`id`
	);
END;
--> statement-breakpoint
CREATE TRIGGER `comments_before_insert_active_post`
BEFORE INSERT ON `comments`
WHEN NOT EXISTS (
	SELECT 1 FROM `posts`
	WHERE `id` = NEW.`post_id` AND `deleted_at` IS NULL
)
BEGIN
	SELECT RAISE(ABORT, 'COMMENT_ACTIVE_POST_REQUIRED');
END;
--> statement-breakpoint
CREATE TRIGGER `comments_before_update_trashed_post`
BEFORE UPDATE ON `comments`
WHEN EXISTS (
	SELECT 1 FROM `posts`
	WHERE `id` = OLD.`post_id` AND `deleted_at` IS NOT NULL
)
BEGIN
	SELECT RAISE(ABORT, 'COMMENT_TRASHED_POST_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `comments_before_delete_trashed_post`
BEFORE DELETE ON `comments`
WHEN EXISTS (
	SELECT 1 FROM `posts`
	WHERE `id` = OLD.`post_id` AND `deleted_at` IS NOT NULL
)
BEGIN
	SELECT RAISE(ABORT, 'COMMENT_TRASHED_POST_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `profiles_before_delete_document_history`
BEFORE DELETE ON `profiles`
WHEN EXISTS (SELECT 1 FROM `posts` WHERE `author_id` = OLD.`id`)
	OR EXISTS (SELECT 1 FROM `comments` WHERE `author_id` = OLD.`id`)
	OR EXISTS (SELECT 1 FROM `qna_threads` WHERE `student_id` = OLD.`id`)
	OR EXISTS (SELECT 1 FROM `qna_replies` WHERE `author_id` = OLD.`id`)
BEGIN
	SELECT RAISE(ABORT, 'DOCUMENT_HISTORY_ACCOUNT_DELETE_RESTRICTED');
END;
--> statement-breakpoint
INSERT INTO `document_batch_abort_guard` (`reason`)
SELECT 'FOREIGN_KEY_CHECK_FAILED'
FROM pragma_foreign_key_check
LIMIT 1;
--> statement-breakpoint
INSERT INTO `document_batch_abort_guard` (`reason`)
SELECT 'POST_REVISION_INVARIANT_FAILED'
WHERE EXISTS (
	SELECT 1
	FROM `posts` AS `post`
	LEFT JOIN `post_revisions` AS `revision` ON `revision`.`post_id` = `post`.`id`
	GROUP BY `post`.`id`, `post`.`version`
	HAVING count(`revision`.`id`) <> 1
		OR max(`revision`.`revision_number`) <> `post`.`version`
);
--> statement-breakpoint
INSERT INTO `document_batch_abort_guard` (`reason`)
SELECT 'QNA_EVENT_INVARIANT_FAILED'
WHERE EXISTS (
	SELECT 1
	FROM `qna_threads` AS `thread`
	LEFT JOIN `qna_thread_events` AS `event` ON `event`.`thread_id` = `thread`.`id`
	GROUP BY `thread`.`id`, `thread`.`version`
	HAVING count(`event`.`id`) <> 1
		OR max(`event`.`event_number`) <> `thread`.`version`
);
--> statement-breakpoint
PRAGMA defer_foreign_keys = OFF;
