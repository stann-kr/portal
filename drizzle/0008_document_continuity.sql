PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE `document_batch_abort_guard` (
	`reason` text NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER `document_batch_abort_guard_reject_insert`
BEFORE INSERT ON `document_batch_abort_guard`
BEGIN
	SELECT RAISE(ABORT, 'DOCUMENT_BATCH_ABORT');
END;
--> statement-breakpoint
INSERT INTO `document_batch_abort_guard` (`reason`)
SELECT 'PRIVATE_NOTES_SCHEMA_DRIFT'
WHERE (
	SELECT group_concat(
		`name` || ':' || lower(`type`) || ':' || `notnull` || ':' || `pk`,
		'|'
	)
	FROM pragma_table_info('private_notes')
) <> 'id:text:1:1|student_id:text:1:0|author_id:text:1:0|title:text:1:0|content_html:text:1:0|created_at:integer:0:0|note_date:integer:0:0';
--> statement-breakpoint
INSERT INTO `document_batch_abort_guard` (`reason`)
SELECT 'PRIVATE_NOTES_INBOUND_FOREIGN_KEY'
FROM (
	SELECT `name`
	FROM `sqlite_master`
	WHERE `type` = 'table'
		AND `name` NOT LIKE 'sqlite_%'
		AND lower(`name`) NOT GLOB '_cf_*'
		AND `name` <> 'private_notes'
) AS `m`
JOIN pragma_foreign_key_list(`m`.`name`) AS `fk`
WHERE `fk`.`table` = 'private_notes'
LIMIT 1;
--> statement-breakpoint
CREATE TABLE `document_operation_ledger` (
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
	CONSTRAINT "document_operation_ledger_resource_type_check" CHECK(`resource_type` = 'PRIVATE_NOTE'),
	CONSTRAINT "document_operation_ledger_operation_type_check" CHECK(`operation_type` IN ('CREATE', 'UPDATE', 'TRASH', 'RESTORE_TRASH', 'RESTORE_REVISION', 'PURGE')),
	CONSTRAINT "document_operation_ledger_nonempty_ids_check" CHECK(length(`operation_id`) > 0 AND length(`actor_id`) > 0 AND length(`subject_id`) > 0 AND length(`resource_id`) > 0),
	CONSTRAINT "document_operation_ledger_request_hash_check" CHECK(length(`request_hash`) = 64 AND `request_hash_version` >= 1),
	CONSTRAINT "document_operation_ledger_result_revision_check" CHECK(`result_revision` >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_operation_ledger_actor_operation_unique`
ON `document_operation_ledger` (`actor_id`, `operation_id`);
--> statement-breakpoint
CREATE INDEX `document_operation_ledger_resource_created_idx`
ON `document_operation_ledger` (`resource_type`, `resource_id`, `created_at`);
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
CREATE TABLE `document_tombstones` (
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`source_created_at` integer,
	`source_version` integer NOT NULL,
	`purged_at` integer NOT NULL,
	`purged_by_id` text,
	PRIMARY KEY (`resource_type`, `resource_id`),
	CONSTRAINT "document_tombstones_resource_type_check" CHECK(`resource_type` = 'PRIVATE_NOTE'),
	CONSTRAINT "document_tombstones_nonempty_ids_check" CHECK(length(`resource_id`) > 0 AND length(`subject_id`) > 0 AND length(`owner_id`) > 0),
	CONSTRAINT "document_tombstones_source_version_check" CHECK(`source_version` >= 1)
);
--> statement-breakpoint
CREATE INDEX `document_tombstones_subject_purged_idx`
ON `document_tombstones` (`resource_type`, `subject_id`, `purged_at`);
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
CREATE TABLE `__new_private_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`author_id` text NOT NULL,
	`title` text NOT NULL,
	`content_html` text NOT NULL,
	`note_date` integer,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	`deleted_by_id` text,
	FOREIGN KEY (`student_id`) REFERENCES `profiles` (`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`author_id`) REFERENCES `profiles` (`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`deleted_by_id`) REFERENCES `profiles` (`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "private_notes_version_check" CHECK(`version` >= 1),
	CONSTRAINT "private_notes_deleted_actor_check" CHECK(`deleted_at` IS NOT NULL OR `deleted_by_id` IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_private_notes` (
	`id`,
	`student_id`,
	`author_id`,
	`title`,
	`content_html`,
	`note_date`,
	`created_at`,
	`updated_at`,
	`version`,
	`deleted_at`,
	`deleted_by_id`
)
SELECT
	`id`,
	`student_id`,
	`author_id`,
	`title`,
	`content_html`,
	`note_date`,
	COALESCE(`created_at`, strftime('%s', 'now')),
	COALESCE(`created_at`, strftime('%s', 'now')),
	1,
	NULL,
	NULL
FROM `private_notes`;
--> statement-breakpoint
DROP TABLE `private_notes`;
--> statement-breakpoint
ALTER TABLE `__new_private_notes` RENAME TO `private_notes`;
--> statement-breakpoint
CREATE INDEX `private_notes_student_deleted_created_idx`
ON `private_notes` (`student_id`, `deleted_at`, `created_at`);
--> statement-breakpoint
CREATE INDEX `private_notes_deleted_at_idx`
ON `private_notes` (`deleted_at`);
--> statement-breakpoint
CREATE TABLE `private_note_revisions` (
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
	FOREIGN KEY (`operation_record_id`) REFERENCES `document_operation_ledger` (`id`) ON UPDATE no action ON DELETE restrict,
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
CREATE UNIQUE INDEX `private_note_revisions_note_number_unique`
ON `private_note_revisions` (`note_id`, `revision_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `private_note_revisions_operation_unique`
ON `private_note_revisions` (`operation_record_id`);
--> statement-breakpoint
CREATE INDEX `private_note_revisions_note_created_idx`
ON `private_note_revisions` (`note_id`, `created_at`);
--> statement-breakpoint
INSERT INTO `private_note_revisions` (
	`id`,
	`note_id`,
	`revision_number`,
	`change_type`,
	`title`,
	`content_html`,
	`note_date`,
	`deleted_at`,
	`snapshot_hash`,
	`snapshot_hash_version`,
	`actor_id`,
	`restored_from_revision`,
	`operation_record_id`,
	`created_at`
)
SELECT
	'baseline:' || `id`,
	`id`,
	1,
	'BASELINE',
	`title`,
	`content_html`,
	`note_date`,
	NULL,
	NULL,
	NULL,
	NULL,
	NULL,
	NULL,
	`updated_at`
FROM `private_notes`;
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
		OR (
			NEW.`operation_record_id` IS NOT NULL
			AND `operation_record_id` = NEW.`operation_record_id`
		)
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
		JOIN `private_notes` AS `note`
			ON `note`.`id` = NEW.`note_id`
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
		`resource_type`,
		`resource_id`,
		`subject_id`,
		`owner_id`,
		`source_created_at`,
		`source_version`,
		`purged_at`,
		`purged_by_id`
	)
	SELECT
		'PRIVATE_NOTE',
		OLD.`id`,
		OLD.`student_id`,
		OLD.`author_id`,
		OLD.`created_at`,
		OLD.`version`,
		strftime('%s', 'now'),
		NULL
	WHERE NOT EXISTS (
		SELECT 1
		FROM `document_tombstones`
		WHERE `resource_type` = 'PRIVATE_NOTE'
			AND `resource_id` = OLD.`id`
	);
END;
--> statement-breakpoint
INSERT INTO `document_batch_abort_guard` (`reason`)
SELECT 'FOREIGN_KEY_CHECK_FAILED'
FROM pragma_foreign_key_check
LIMIT 1;
--> statement-breakpoint
INSERT INTO `document_batch_abort_guard` (`reason`)
SELECT 'PRIVATE_NOTE_REVISION_INVARIANT_FAILED'
WHERE EXISTS (
	SELECT 1
	FROM `private_notes` AS `note`
	LEFT JOIN `private_note_revisions` AS `revision`
		ON `revision`.`note_id` = `note`.`id`
	GROUP BY `note`.`id`, `note`.`version`
	HAVING count(`revision`.`id`) <> 1
		OR max(`revision`.`revision_number`) <> `note`.`version`
);
--> statement-breakpoint
PRAGMA defer_foreign_keys = OFF;
