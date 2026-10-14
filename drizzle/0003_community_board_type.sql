-- Phase 3: 커뮤니티 게시판 boardType 분리 (ANNOUNCEMENT / GENERAL / FEEDBACK)
-- 기존 posts 데이터는 모두 GENERAL로 마이그레이션
ALTER TABLE `posts` ADD `board_type` text DEFAULT 'GENERAL' NOT NULL;
--> statement-breakpoint
ALTER TABLE `posts` ADD `is_pinned` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `posts` ADD `media_url` text;
