CREATE TABLE `push_muted_categories` (
	`profile_id` text NOT NULL,
	`category` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	PRIMARY KEY(`profile_id`, `category`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "push_muted_categories_category_check" CHECK("push_muted_categories"."category" IN ('feedback', 'assignment', 'lesson', 'qna', 'announcement', 'community_post', 'community_comment'))
);
