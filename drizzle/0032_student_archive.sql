ALTER TABLE `profiles` ADD `account_status` text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `archived_at` integer;