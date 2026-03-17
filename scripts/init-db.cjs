// Node.js CJS 방식으로 실행 가능한 DB 초기화 스크립트
// npx node --require ./scripts/init-db.cjs 대신
// node scripts/init-db.cjs 로 직접 실행
const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(process.cwd(), "prisma", "dev.db");
const sqlite = new Database(dbPath);

sqlite.pragma("journal_mode = WAL");

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    password TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    description TEXT,
    default_mode TEXT DEFAULT 'strategy_vs_execution',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    raw_input TEXT NOT NULL,
    additional_constraints TEXT,
    rounds INTEGER DEFAULT 2,
    output_tone TEXT DEFAULT 'standard',
    status TEXT DEFAULT 'pending',
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role_type TEXT NOT NULL,
    speaker TEXT NOT NULL,
    round_no INTEGER DEFAULT 0,
    content TEXT NOT NULL,
    token_usage_input INTEGER DEFAULT 0,
    token_usage_output INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS final_summaries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id),
    final_brief TEXT NOT NULL,
    key_issues TEXT NOT NULL,
    recommended_mvp TEXT NOT NULL,
    risks TEXT NOT NULL,
    next_actions TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log("✅ DB 초기화 완료:", dbPath);
sqlite.close();
