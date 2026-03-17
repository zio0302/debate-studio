// Drizzle DB 클라이언트 - PostgreSQL(Supabase) 버전
// better-sqlite3 → postgres 패키지로 교체
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// DATABASE_URL은 Supabase 프로젝트의 Connection String (Transaction mode)
// 예: postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL 환경변수가 설정되지 않았습니다.");
}

// 개발 환경에서 HMR로 인한 다중 연결 방지
const globalForDb = globalThis as unknown as {
  client: ReturnType<typeof postgres> | undefined;
  db: ReturnType<typeof drizzle> | undefined;
};

const client =
  globalForDb.client ??
  postgres(process.env.DATABASE_URL, {
    max: 1,
    prepare: false, // Supabase Transaction Pooler 필수 설정
  });

export const db =
  globalForDb.db ??
  drizzle(client, { schema });

if (process.env.NODE_ENV !== "production") {
  globalForDb.client = client;
  globalForDb.db = db;
}
