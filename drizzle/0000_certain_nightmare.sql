CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`member_id` text NOT NULL,
	`type_id` text NOT NULL,
	`date` text NOT NULL,
	`minutes` real,
	`distance` real,
	`note` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`idempotency_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_idempotency` ON `activities` (`course_id`,`member_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `activity_types` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`name` text NOT NULL,
	`group_name` text NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`challenge_id` text
);
--> statement-breakpoint
CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`member_id` text NOT NULL,
	`action` text NOT NULL,
	`details` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `awards` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`member_id` text NOT NULL,
	`rule_key` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`rule_version` integer NOT NULL,
	`earned_at` text NOT NULL,
	`snapshot` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `award_unique` ON `awards` (`course_id`,`member_id`,`rule_key`,`period_start`);--> statement-breakpoint
CREATE TABLE `challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`data` text NOT NULL,
	`status` text NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text NOT NULL,
	`member_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `completions` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`member_id` text NOT NULL,
	`challenge_id` text NOT NULL,
	`date` text NOT NULL,
	`note` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `completion_unique` ON `completions` (`course_id`,`member_id`,`challenge_id`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`user_id` text,
	`email` text NOT NULL,
	`nickname` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`animations` integer DEFAULT 1 NOT NULL,
	`joined_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_email` ON `members` (`course_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `member_identity` ON `members` (`course_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`data` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`sent_at` text
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`member_id` text NOT NULL,
	`kind` text NOT NULL,
	`reference_id` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt` text NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_unique` ON `outbox` (`kind`,`reference_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text NOT NULL,
	`member_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reaction_unique` ON `reactions` (`activity_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `recalculation_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`member_id` text NOT NULL,
	`rule_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`member_id` text NOT NULL,
	`read_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipient_unique` ON `recipients` (`message_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`key` text NOT NULL,
	`version` integer NOT NULL,
	`effective_from` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rule_version` ON `rules` (`course_id`,`key`,`version`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`member_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_endpoint_unique` ON `subscriptions` (`endpoint`);