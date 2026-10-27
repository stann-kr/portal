CREATE TABLE `calendar_push_channels` (
	`mapping_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`mapping_id`) REFERENCES `calendar_mappings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_push_channels_payload_check" CHECK(length("calendar_push_channels"."mapping_id") > 0 AND length("calendar_push_channels"."channel_id") > 0 AND length("calendar_push_channels"."resource_id") > 0 AND length("calendar_push_channels"."token_hash") = 64 AND "calendar_push_channels"."created_at" <= "calendar_push_channels"."updated_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_push_channels_channel_unique` ON `calendar_push_channels` (`channel_id`);