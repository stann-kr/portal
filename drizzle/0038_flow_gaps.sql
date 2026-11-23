CREATE TABLE `assignment_occurrence_skips` (
	`recurrence_id` text NOT NULL,
	`occurrence_date` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	PRIMARY KEY(`recurrence_id`, `occurrence_date`),
	FOREIGN KEY (`recurrence_id`) REFERENCES `assignment_recurrences`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "assignment_occurrence_skips_date_check" CHECK(length("assignment_occurrence_skips"."occurrence_date") = 10)
);
--> statement-breakpoint
CREATE TABLE `digging_feedbacks` (
	`student_id` text NOT NULL,
	`dug_on` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	PRIMARY KEY(`student_id`, `dug_on`),
	FOREIGN KEY (`student_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "digging_feedbacks_payload_check" CHECK(length("digging_feedbacks"."dug_on") = 10 AND length(trim("digging_feedbacks"."body")) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
ALTER TABLE `assignment_tasks` ADD `closed_at` integer;--> statement-breakpoint
ALTER TABLE `feedbacks` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `comments` ADD `updated_at` integer;--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_digging_playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`note` text,
	`dug_on` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "digging_playlists_payload_check" CHECK(length("__new_digging_playlists"."url") BETWEEN 1 AND 2048
        AND (
          ("__new_digging_playlists"."provider" = 'beatport' AND "__new_digging_playlists"."url" LIKE 'https://www.beatport.com/playlists/share/%')
          OR ("__new_digging_playlists"."provider" = 'soundcloud' AND "__new_digging_playlists"."url" LIKE 'https://soundcloud.com/%/sets/%')
        )
        AND ("__new_digging_playlists"."title" IS NULL OR length("__new_digging_playlists"."title") BETWEEN 1 AND 200)
        AND ("__new_digging_playlists"."note" IS NULL OR length("__new_digging_playlists"."note") BETWEEN 1 AND 2000)
        AND "__new_digging_playlists"."created_at" <= "__new_digging_playlists"."updated_at"),
	CONSTRAINT "digging_playlists_dug_on_check" CHECK(length("__new_digging_playlists"."dug_on") = 10)
);
--> statement-breakpoint
INSERT INTO `__new_digging_playlists`("id", "user_id", "provider", "url", "title", "note", "dug_on", "created_at", "updated_at") SELECT "id", "user_id", "provider", "url", "title", "note", strftime('%Y-%m-%d', "created_at", 'unixepoch', '+9 hours'), "created_at", "updated_at" FROM `digging_playlists`;--> statement-breakpoint
DROP TABLE `digging_playlists`;--> statement-breakpoint
ALTER TABLE `__new_digging_playlists` RENAME TO `digging_playlists`;--> statement-breakpoint
CREATE UNIQUE INDEX `digging_playlists_user_url_unique` ON `digging_playlists` (`user_id`,`url`);--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;