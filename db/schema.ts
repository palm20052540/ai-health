import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Private generated summaries only. Source records and credentials are not stored.
export const assistantBriefs = sqliteTable("assistant_briefs", {
  ownerId: text("owner_id").notNull(),
  kind: text("kind").notNull(),
  sourceHash: text("source_hash").notNull(),
  sourceAt: text("source_at"),
  generatedAt: integer("generated_at").notNull(),
  version: text("version").notNull(),
  reportJson: text("report_json").notNull(),
}, (table) => [primaryKey({ columns: [table.ownerId, table.kind] })]);
