CREATE TABLE `document_server_draft_operations` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`source_key` text NOT NULL,
	`operation_type` text NOT NULL,
	`request_hash` text NOT NULL,
	`request_hash_version` integer NOT NULL,
	`result_version` integer NOT NULL,
	`result_state` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "document_server_draft_operations_type_check" CHECK("document_server_draft_operations"."operation_type" IN ('UPSERT', 'DISCARD')),
	CONSTRAINT "document_server_draft_operations_state_check" CHECK("document_server_draft_operations"."result_state" IN ('PRESENT', 'DISCARDED') AND (("document_server_draft_operations"."operation_type" = 'UPSERT' AND "document_server_draft_operations"."result_state" = 'PRESENT' AND "document_server_draft_operations"."result_version" >= 1) OR ("document_server_draft_operations"."operation_type" = 'DISCARD' AND "document_server_draft_operations"."result_state" = 'DISCARDED' AND "document_server_draft_operations"."result_version" >= 0))),
	CONSTRAINT "document_server_draft_operations_identity_check" CHECK(length("document_server_draft_operations"."owner_id") > 0 AND length("document_server_draft_operations"."operation_id") > 0 AND length("document_server_draft_operations"."source_key") > 0),
	CONSTRAINT "document_server_draft_operations_hash_check" CHECK(length("document_server_draft_operations"."request_hash") = 64 AND "document_server_draft_operations"."request_hash_version" >= 1),
	CONSTRAINT "document_server_draft_operations_timestamp_check" CHECK("document_server_draft_operations"."expires_at" = "document_server_draft_operations"."created_at" + 2592000)
);
--> statement-breakpoint
CREATE INDEX `document_server_draft_operations_source_created_idx` ON `document_server_draft_operations` (`owner_id`,`source_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `document_server_draft_operations_expires_idx` ON `document_server_draft_operations` (`expires_at`);--> statement-breakpoint
CREATE TABLE `document_server_drafts` (
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
	CONSTRAINT "document_server_drafts_kind_check" CHECK("document_server_drafts"."document_kind" IN ('note', 'community-post', 'qna-thread', 'qna-reply')),
	CONSTRAINT "document_server_drafts_identity_check" CHECK(length("document_server_drafts"."owner_id") > 0 AND length("document_server_drafts"."source_key") > 0 AND length("document_server_drafts"."context_id") > 0 AND length("document_server_drafts"."writer_device_id") > 0),
	CONSTRAINT "document_server_drafts_payload_check" CHECK(json_valid("document_server_drafts"."payload_json") AND json_type("document_server_drafts"."payload_json") = 'object' AND length(CAST("document_server_drafts"."payload_json" AS BLOB)) <= 921600 AND length("document_server_drafts"."payload_hash") = 64),
	CONSTRAINT "document_server_drafts_version_check" CHECK("document_server_drafts"."draft_version" >= 1 AND ("document_server_drafts"."base_resource_version" IS NULL OR "document_server_drafts"."base_resource_version" >= 1)),
	CONSTRAINT "document_server_drafts_timestamp_check" CHECK("document_server_drafts"."created_at" <= "document_server_drafts"."updated_at" AND "document_server_drafts"."expires_at" = "document_server_drafts"."updated_at" + 2592000)
);
--> statement-breakpoint
CREATE INDEX `document_server_drafts_owner_updated_idx` ON `document_server_drafts` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `document_server_drafts_expires_idx` ON `document_server_drafts` (`expires_at`);--> statement-breakpoint
CREATE TRIGGER `document_server_draft_operations_before_insert_existing`
BEFORE INSERT ON `document_server_draft_operations`
WHEN EXISTS (
	SELECT 1
	FROM `document_server_draft_operations`
	WHERE `owner_id` = NEW.`owner_id`
		AND `operation_id` = NEW.`operation_id`
)
BEGIN
	SELECT RAISE(ABORT, 'DOCUMENT_SERVER_DRAFT_OPERATION_DUPLICATE');
END;--> statement-breakpoint
CREATE TRIGGER `document_server_draft_operations_immutable_update`
BEFORE UPDATE ON `document_server_draft_operations`
BEGIN
	SELECT RAISE(ABORT, 'DOCUMENT_SERVER_DRAFT_OPERATION_IMMUTABLE');
END;--> statement-breakpoint
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
END;
