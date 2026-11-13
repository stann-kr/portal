CREATE INDEX `calendar_events_user_start_idx` ON `calendar_events` (`user_id`,`start_time`);--> statement-breakpoint
CREATE INDEX `curriculums_student_week_idx` ON `curriculums` (`student_id`,`week_num`);--> statement-breakpoint
CREATE INDEX `digging_tracks_user_created_idx` ON `digging_tracks` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `lessons_student_scheduled_idx` ON `lessons` (`student_id`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `qna_replies_thread_created_idx` ON `qna_replies` (`thread_id`,`created_at`);