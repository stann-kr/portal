CREATE TABLE `calendar_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`provider` text NOT NULL,
	`account_label` text NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`credentials_iv` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_connections_provider_check" CHECK("calendar_connections"."provider" IN ('GOOGLE', 'ICLOUD')),
	CONSTRAINT "calendar_connections_status_check" CHECK("calendar_connections"."status" IN ('ACTIVE', 'NEEDS_REAUTH')),
	CONSTRAINT "calendar_connections_payload_check" CHECK(length("calendar_connections"."id") > 0 AND length("calendar_connections"."account_label") > 0 AND length("calendar_connections"."encrypted_credentials") > 0 AND length("calendar_connections"."credentials_iv") > 0 AND "calendar_connections"."created_at" <= "calendar_connections"."updated_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_connections_owner_provider_unique` ON `calendar_connections` (`owner_id`,`provider`);--> statement-breakpoint
CREATE TABLE `calendar_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`student_id` text NOT NULL,
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
	CONSTRAINT "calendar_mappings_payload_check" CHECK(length("calendar_mappings"."id") > 0 AND length("calendar_mappings"."remote_calendar_id") > 0 AND length("calendar_mappings"."remote_calendar_name") > 0 AND "calendar_mappings"."created_at" <= "calendar_mappings"."updated_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_mappings_connection_student_unique` ON `calendar_mappings` (`connection_id`,`student_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_mappings_connection_calendar_unique` ON `calendar_mappings` (`connection_id`,`remote_calendar_id`);--> statement-breakpoint
CREATE INDEX `calendar_mappings_student_idx` ON `calendar_mappings` (`student_id`);--> statement-breakpoint
CREATE TABLE `calendar_remote_series` (
	`mapping_id` text NOT NULL,
	`remote_id` text NOT NULL,
	`series_key` text NOT NULL,
	`etag` text,
	`ics_text` text NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	PRIMARY KEY(`mapping_id`, `remote_id`),
	FOREIGN KEY (`mapping_id`) REFERENCES `calendar_mappings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_remote_series_payload_check" CHECK(length("calendar_remote_series"."remote_id") > 0 AND length("calendar_remote_series"."series_key") > 0 AND length("calendar_remote_series"."ics_text") BETWEEN 1 AND 262144)
);
--> statement-breakpoint
CREATE INDEX `calendar_remote_series_series_idx` ON `calendar_remote_series` (`mapping_id`,`series_key`);--> statement-breakpoint
CREATE TABLE `calendar_sync_links` (
	`id` text PRIMARY KEY NOT NULL,
	`mapping_id` text NOT NULL,
	`local_kind` text NOT NULL,
	`local_id` text NOT NULL,
	`remote_id` text,
	`etag` text,
	`local_fingerprint` text NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`mapping_id`) REFERENCES `calendar_mappings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_sync_links_kind_check" CHECK("calendar_sync_links"."local_kind" IN ('LESSON', 'EVENT')),
	CONSTRAINT "calendar_sync_links_payload_check" CHECK(length("calendar_sync_links"."local_id") > 0 AND length("calendar_sync_links"."local_fingerprint") > 0 AND ("calendar_sync_links"."remote_id" IS NULL OR length("calendar_sync_links"."remote_id") > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_sync_links_local_unique` ON `calendar_sync_links` (`mapping_id`,`local_kind`,`local_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_sync_links_remote_unique` ON `calendar_sync_links` (`mapping_id`,`remote_id`);