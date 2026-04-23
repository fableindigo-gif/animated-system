import { pgTable, serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── pgvector custom type (768 dims = Vertex AI text-embedding-004) ──────────
const vectorColumn = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() { return `vector(${dimensions})`; },
    toDriver(value: number[]): string { return `[${value.join(",")}]`; },
    fromDriver(value: string | number[]): number[] {
      if (Array.isArray(value)) return value as number[];
      return (value as string).slice(1, -1).split(",").map(Number);
    },
  })(name);

// ─── AI Agents ────────────────────────────────────────────────────────────────
export const aiAgents = pgTable("ai_agents", {
  id:                   serial("id").primaryKey(),
  organizationId:       integer("organization_id").notNull(),
  workspaceId:          integer("workspace_id"),
  name:                 text("name").notNull(),
  toneOfVoice:          text("tone_of_voice").notNull().default("Professional"),
  objective:            text("objective").notNull().default("Customer Support"),
  customObjective:      text("custom_objective"),
  systemPrompt:         text("system_prompt"),
  primaryColor:         text("primary_color").notNull().default("#1a73e8"),
  welcomeMessage:       text("welcome_message").notNull().default("Hi! How can I help you today?"),
  scriptId:             text("script_id").unique(),
  isActive:             boolean("is_active").notNull().default(false),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeCustomerId:     text("stripe_customer_id"),
  totalConversations:   integer("total_conversations").notNull().default(0),
  totalMessages:        integer("total_messages").notNull().default(0),
  createdAt:            timestamp("created_at").notNull().defaultNow(),
  updatedAt:            timestamp("updated_at").notNull().defaultNow(),
});

// ─── Knowledge Base Documents ─────────────────────────────────────────────────
export const kbDocuments = pgTable("kb_documents", {
  id:           serial("id").primaryKey(),
  agentId:      integer("agent_id").notNull(),
  fileName:     text("file_name").notNull(),
  fileType:     text("file_type").notNull(),
  fileSize:     integer("file_size").notNull().default(0),
  status:       text("status").notNull().default("processing"),
  chunkCount:   integer("chunk_count").notNull().default(0),
  errorMessage: text("error_message"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

// ─── Knowledge Base Chunks (vectors) ─────────────────────────────────────────
export const kbChunks = pgTable("kb_chunks", {
  id:         serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  agentId:    integer("agent_id").notNull(),
  content:    text("content").notNull(),
  embedding:  vectorColumn("embedding", 768),
  metadata:   jsonb("metadata").$type<{ page?: number; row?: number; source?: string }>(),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
});

// ─── Insert schemas + types ───────────────────────────────────────────────────
export const insertAiAgentSchema = createInsertSchema(aiAgents).omit({
  id: true, createdAt: true, updatedAt: true, scriptId: true,
  totalConversations: true, totalMessages: true,
});

export const insertKbDocumentSchema = createInsertSchema(kbDocuments).omit({ id: true, createdAt: true });

export type AiAgent    = typeof aiAgents.$inferSelect;
export type KbDocument = typeof kbDocuments.$inferSelect;
export type KbChunk    = typeof kbChunks.$inferSelect;
export type InsertAiAgent    = z.infer<typeof insertAiAgentSchema>;
export type InsertKbDocument = z.infer<typeof insertKbDocumentSchema>;
