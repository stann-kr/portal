ALTER TABLE `comments`
ADD COLUMN `time_marker_seconds` integer
CONSTRAINT "comments_time_marker_check" CHECK(`time_marker_seconds` IS NULL OR (`time_marker_seconds` >= 0 AND `time_marker_seconds` <= 86399));
--> statement-breakpoint
CREATE INDEX `comments_post_created_idx`
ON `comments` (`post_id`, `created_at`);
