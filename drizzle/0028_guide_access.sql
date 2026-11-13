CREATE TABLE `guide_access` (
	`student_id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "guide_access_mode_check" CHECK("guide_access"."mode" IN ('ALL', 'SELECTED'))
);
--> statement-breakpoint
CREATE TABLE `guide_access_pages` (
	`student_id` text NOT NULL,
	`guide_page_id` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	PRIMARY KEY(`student_id`, `guide_page_id`),
	FOREIGN KEY (`student_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`guide_page_id`) REFERENCES `guide_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `guide_access_pages_page_idx` ON `guide_access_pages` (`guide_page_id`);--> statement-breakpoint
-- 이미 가입을 마친 학생은 지금처럼 모든 가이드를 본다(전체). 가입 링크만 받은 계정(`invite:` 표시)과 관리자는 행을 만들지 않는다(닫힘).
INSERT INTO `guide_access` (`student_id`, `mode`)
SELECT `id`, 'ALL' FROM `profiles`
WHERE `role` = 'student' AND `password_hash` IS NOT NULL AND `password_hash` NOT LIKE 'invite:%';
