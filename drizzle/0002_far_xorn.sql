CREATE TABLE `operator_password_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`email` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operator_password_accounts_account_id_unique` ON `operator_password_accounts` (`account_id`);