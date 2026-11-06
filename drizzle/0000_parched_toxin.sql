CREATE TABLE `snapshots` (
	`revision` integer PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`action` text NOT NULL,
	`data` text NOT NULL
);
