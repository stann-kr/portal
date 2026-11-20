ALTER TABLE `comments` ADD `parent_id` text;--> statement-breakpoint
CREATE INDEX `comments_parent_idx` ON `comments` (`parent_id`);