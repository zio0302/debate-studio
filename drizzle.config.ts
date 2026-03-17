import { defineConfig } from "drizzle-kit";

// Drizzle Kit 설정 - Supabase PostgreSQL 연결
export default defineConfig({
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
