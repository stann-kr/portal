ALTER TABLE `assignment_recurrences`
ADD COLUMN `analysis_form` integer DEFAULT false NOT NULL
CONSTRAINT "assignment_recurrences_analysis_form_check" CHECK(`analysis_form` IN (0, 1) AND (`analysis_form` = 0 OR `submission_format` = 'MIX'));
--> statement-breakpoint
ALTER TABLE `assignment_tasks`
ADD COLUMN `analysis_form` integer DEFAULT false NOT NULL
CONSTRAINT "assignment_tasks_analysis_form_check" CHECK(`analysis_form` IN (0, 1) AND (`analysis_form` = 0 OR `submission_format` = 'MIX'));
--> statement-breakpoint
ALTER TABLE `assignments`
ADD COLUMN `analysis_json` text
CONSTRAINT "assignments_analysis_json_check" CHECK(`analysis_json` IS NULL OR (json_valid(`analysis_json`) AND length(`analysis_json`) <= 100000));
