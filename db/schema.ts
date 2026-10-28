import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const settings = sqliteTable('leaderboard_settings', {
  id: integer('id').primaryKey(),
  teamsJson: text('teams_json').notNull(),
  revision: integer('revision').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});
