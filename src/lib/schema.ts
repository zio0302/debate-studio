// Drizzle ORM 스키마 - PostgreSQL(Supabase) 버전
// SQLite에서 PostgreSQL로 전환: pgTable 사용
import { pgTable, text, integer, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// 사용자 테이블
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  password: text("password").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 프로젝트 테이블
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  defaultMode: text("default_mode").default("strategy_vs_execution"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at"), // soft delete
});

// 세션 테이블
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  rawInput: text("raw_input").notNull(),
  additionalConstraints: text("additional_constraints"),
  rounds: integer("rounds").default(2),
  outputTone: text("output_tone").default("standard"),
  status: text("status").default("pending"), // pending/running/completed/failed
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 메시지 테이블 (토론 로그, append-only)
export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => sessions.id),
  roleType: text("role_type").notNull(), // user_input/persona_a/persona_b/moderator
  speaker: text("speaker").notNull(),
  roundNo: integer("round_no").default(0),
  content: text("content").notNull(),
  tokenUsageInput: integer("token_usage_input").default(0),
  tokenUsageOutput: integer("token_usage_output").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// 최종 요약 테이블
export const finalSummaries = pgTable("final_summaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().unique().references(() => sessions.id),
  finalBrief: text("final_brief").notNull(),
  keyIssues: text("key_issues").notNull(), // JSON 문자열
  recommendedMvp: text("recommended_mvp").notNull(),
  risks: text("risks").notNull(), // JSON 문자열
  nextActions: text("next_actions").notNull(), // JSON 문자열
  createdAt: timestamp("created_at").defaultNow(),
});

// 타입 추론
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type FinalSummary = typeof finalSummaries.$inferSelect;
