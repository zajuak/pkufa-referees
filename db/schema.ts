import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const snapshots = sqliteTable('snapshots', {
  revision: integer('revision').primaryKey(),
  at: text('at').notNull(),
  action: text('action').notNull(),
  data: text('data').notNull(),
});
export const refereeCredentials = sqliteTable('referee_credentials', {
  refereeId: text('referee_id').primaryKey(),
  passwordHash: text('password_hash').notNull(),
  version: integer('version').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
});
export const loginAttempts = sqliteTable('login_attempts', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull(),
  resetAt: integer('reset_at').notNull(),
});
