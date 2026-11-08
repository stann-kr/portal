CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`last_success_at` integer,
	`failure_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "push_subscriptions_payload_check" CHECK(substr("push_subscriptions"."endpoint", 1, 8) = 'https://'
        AND length("push_subscriptions"."endpoint") <= 2048
        AND length("push_subscriptions"."p256dh") BETWEEN 80 AND 100
        AND length("push_subscriptions"."auth") BETWEEN 16 AND 32
        AND "push_subscriptions"."failure_count" >= 0
        AND "push_subscriptions"."created_at" <= "push_subscriptions"."updated_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_profile_idx` ON `push_subscriptions` (`profile_id`);