CREATE TABLE `external_calendar_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`encrypted_url` text NOT NULL,
	`url_iv` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "external_calendar_subscriptions_provider_check" CHECK("external_calendar_subscriptions"."provider" IN ('GOOGLE', 'ICLOUD')),
	CONSTRAINT "external_calendar_subscriptions_payload_check" CHECK(length("external_calendar_subscriptions"."id") > 0 AND length("external_calendar_subscriptions"."student_id") > 0 AND length("external_calendar_subscriptions"."label") > 0 AND length("external_calendar_subscriptions"."encrypted_url") > 0 AND length("external_calendar_subscriptions"."url_iv") > 0),
	CONSTRAINT "external_calendar_subscriptions_timestamp_check" CHECK("external_calendar_subscriptions"."created_at" <= "external_calendar_subscriptions"."updated_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_calendar_subscriptions_student_unique` ON `external_calendar_subscriptions` (`student_id`);