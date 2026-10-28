CREATE TABLE `digging_playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`note` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "digging_playlists_payload_check" CHECK(length("digging_playlists"."url") BETWEEN 1 AND 2048
        AND (
          ("digging_playlists"."provider" = 'beatport' AND "digging_playlists"."url" LIKE 'https://www.beatport.com/playlists/share/%')
          OR ("digging_playlists"."provider" = 'soundcloud' AND "digging_playlists"."url" LIKE 'https://soundcloud.com/%/sets/%')
        )
        AND ("digging_playlists"."title" IS NULL OR length("digging_playlists"."title") BETWEEN 1 AND 200)
        AND ("digging_playlists"."note" IS NULL OR length("digging_playlists"."note") BETWEEN 1 AND 2000)
        AND "digging_playlists"."created_at" <= "digging_playlists"."updated_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `digging_playlists_user_url_unique` ON `digging_playlists` (`user_id`,`url`);