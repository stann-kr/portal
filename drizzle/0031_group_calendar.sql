-- 그룹 캘린더(2026-11-16 사용자 결정): calendar_mappings 대상을 학생 또는 레슨 그룹 하나로 넓히고(student_id nullable + group_id),
-- 그룹 캘린더에서 만든 일정의 그룹 원본(calendar_group_events)과 멤버 사본 표시(calendar_events.group_event_id)를 더한다.
-- calendar_mappings를 다시 만들면 DROP이 자식(sync_links·remote_series·push_channels)을 ON DELETE CASCADE로 지운다
-- (D1은 migration 안에서 foreign_keys를 끌 수 없다). 0015처럼 자식 행을 백업했다가 rename 뒤 그대로 되돌린다.
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `calendar_group_events` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`start_time` integer NOT NULL,
	`end_time` integer,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `lesson_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_group_events_payload_check" CHECK(length("calendar_group_events"."id") > 0 AND length("calendar_group_events"."title") > 0 AND ("calendar_group_events"."end_time" IS NULL OR "calendar_group_events"."end_time" > "calendar_group_events"."start_time") AND "calendar_group_events"."created_at" <= "calendar_group_events"."updated_at")
);
--> statement-breakpoint
CREATE INDEX `calendar_group_events_group_start_idx` ON `calendar_group_events` (`group_id`,`start_time`);--> statement-breakpoint
CREATE TABLE `__new_calendar_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`student_id` text,
	`group_id` text,
	`remote_calendar_id` text NOT NULL,
	`remote_calendar_name` text NOT NULL,
	`cursor` text,
	`last_synced_at` integer,
	`last_error` text,
	`sync_lease_until` integer,
	`sync_lease_id` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `calendar_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `lesson_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_mappings_target_check" CHECK(("__new_calendar_mappings"."student_id" IS NULL) <> ("__new_calendar_mappings"."group_id" IS NULL)),
	CONSTRAINT "calendar_mappings_payload_check" CHECK(length("__new_calendar_mappings"."id") > 0 AND length("__new_calendar_mappings"."remote_calendar_id") > 0 AND length("__new_calendar_mappings"."remote_calendar_name") > 0 AND "__new_calendar_mappings"."created_at" <= "__new_calendar_mappings"."updated_at")
);
--> statement-breakpoint
INSERT INTO `__new_calendar_mappings`("id", "connection_id", "student_id", "group_id", "remote_calendar_id", "remote_calendar_name", "cursor", "last_synced_at", "last_error", "sync_lease_until", "sync_lease_id", "created_at", "updated_at") SELECT "id", "connection_id", "student_id", NULL, "remote_calendar_id", "remote_calendar_name", "cursor", "last_synced_at", "last_error", "sync_lease_until", "sync_lease_id", "created_at", "updated_at" FROM `calendar_mappings`;--> statement-breakpoint
CREATE TABLE `__calendar_sync_links_backup` AS SELECT "id", "mapping_id", "local_kind", "local_id", "remote_id", "etag", "local_fingerprint", "last_error", "created_at", "updated_at" FROM `calendar_sync_links`;--> statement-breakpoint
CREATE TABLE `__calendar_remote_series_backup` AS SELECT "mapping_id", "remote_id", "series_key", "etag", "ics_text", "updated_at" FROM `calendar_remote_series`;--> statement-breakpoint
CREATE TABLE `__calendar_push_channels_backup` AS SELECT "mapping_id", "channel_id", "resource_id", "token_hash", "expires_at", "created_at", "updated_at" FROM `calendar_push_channels`;--> statement-breakpoint
DROP TABLE `calendar_mappings`;--> statement-breakpoint
ALTER TABLE `__new_calendar_mappings` RENAME TO `calendar_mappings`;--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_mappings_connection_student_unique` ON `calendar_mappings` (`connection_id`,`student_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_mappings_connection_calendar_unique` ON `calendar_mappings` (`connection_id`,`remote_calendar_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_mappings_connection_group_unique` ON `calendar_mappings` (`connection_id`,`group_id`);--> statement-breakpoint
CREATE INDEX `calendar_mappings_student_idx` ON `calendar_mappings` (`student_id`);--> statement-breakpoint
CREATE INDEX `calendar_mappings_group_idx` ON `calendar_mappings` (`group_id`);--> statement-breakpoint
INSERT INTO `calendar_sync_links`("id", "mapping_id", "local_kind", "local_id", "remote_id", "etag", "local_fingerprint", "last_error", "created_at", "updated_at") SELECT "id", "mapping_id", "local_kind", "local_id", "remote_id", "etag", "local_fingerprint", "last_error", "created_at", "updated_at" FROM `__calendar_sync_links_backup`;--> statement-breakpoint
INSERT INTO `calendar_remote_series`("mapping_id", "remote_id", "series_key", "etag", "ics_text", "updated_at") SELECT "mapping_id", "remote_id", "series_key", "etag", "ics_text", "updated_at" FROM `__calendar_remote_series_backup`;--> statement-breakpoint
INSERT INTO `calendar_push_channels`("mapping_id", "channel_id", "resource_id", "token_hash", "expires_at", "created_at", "updated_at") SELECT "mapping_id", "channel_id", "resource_id", "token_hash", "expires_at", "created_at", "updated_at" FROM `__calendar_push_channels_backup`;--> statement-breakpoint
DROP TABLE `__calendar_sync_links_backup`;--> statement-breakpoint
DROP TABLE `__calendar_remote_series_backup`;--> statement-breakpoint
DROP TABLE `__calendar_push_channels_backup`;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `group_event_id` text REFERENCES calendar_group_events(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `calendar_events_group_event_idx` ON `calendar_events` (`group_event_id`);--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
