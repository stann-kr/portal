ALTER TABLE `comments`
ADD COLUMN `time_marker_end_seconds` integer
CONSTRAINT "comments_time_marker_end_check" CHECK(`time_marker_end_seconds` IS NULL OR (typeof(`time_marker_end_seconds`) = 'integer' AND `time_marker_seconds` IS NOT NULL AND `time_marker_end_seconds` > `time_marker_seconds` AND `time_marker_end_seconds` <= 86399));
--> statement-breakpoint
ALTER TABLE `feedbacks`
ADD COLUMN `time_marker_end` integer
CONSTRAINT "feedbacks_time_marker_end_check" CHECK(`time_marker_end` IS NULL OR (typeof(`time_marker_end`) = 'integer' AND `time_marker` IS NOT NULL AND `time_marker_end` > `time_marker`));
