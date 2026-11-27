ALTER TABLE `assignment_recurrences`
ADD COLUMN `has_due` integer DEFAULT true NOT NULL
CONSTRAINT "assignment_recurrences_has_due_check" CHECK(`has_due` IN (0, 1) AND (`has_due` = 1 OR `due_time` = '23:59'));
