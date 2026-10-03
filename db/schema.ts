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

// Callback/signing secrets arrive only through the native approved subscription
// flow. They never appear in tool results, browser responses, logs or source.
export const briefSubscriptions = sqliteTable("brief_subscriptions", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  ownerGate: text("owner_gate").notNull(),
  callbackUrl: text("callback_url").notNull(),
  signingSecret: text("signing_secret").notNull(),
  previousSecret: text("previous_secret"),
  rotationUntil: integer("rotation_until"),
  verifiedAt: integer("verified_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const briefDeliveries = sqliteTable("brief_deliveries", {
  subscriptionId: text("subscription_id").notNull(),
  sourceHash: text("source_hash").notNull(),
  eventId: text("event_id").notNull(),
  occurredAt: text("occurred_at").notNull(),
  status: text("status").notNull(),
  attemptedAt: integer("attempted_at").notNull(),
}, (table) => [primaryKey({ columns: [table.subscriptionId, table.sourceHash] })]);
