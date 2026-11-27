ALTER TABLE `instructor_memos`
ADD COLUMN `memo_date` text
CONSTRAINT "instructor_memos_memo_date_check" CHECK(`memo_date` IS NULL OR (length(`memo_date`) = 10 AND `note_id` IS NULL));
--> statement-breakpoint
DROP INDEX `instructor_memos_student_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `instructor_memos_student_unique` ON `instructor_memos` (`student_id`) WHERE "instructor_memos"."note_id" IS NULL AND "instructor_memos"."memo_date" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `instructor_memos_student_date_unique` ON `instructor_memos` (`student_id`,`memo_date`) WHERE "instructor_memos"."memo_date" IS NOT NULL;
