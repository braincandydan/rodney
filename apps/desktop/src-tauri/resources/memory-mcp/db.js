import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
export function openDb(dbPath) {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    migrate(db);
    return db;
}
export function migrate(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      project_id TEXT,
      mood_start TEXT,
      mood_end TEXT,
      summary TEXT
    );

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 3,
      pinned INTEGER NOT NULL DEFAULT 0,
      access_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_accessed TEXT,
      tags TEXT,
      confidence REAL NOT NULL DEFAULT 1.0,
      session_id INTEGER,
      is_deprecated INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
    CREATE INDEX IF NOT EXISTS idx_memories_deprecated ON memories(is_deprecated);
    CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);

    CREATE TABLE IF NOT EXISTS personality (
      trait TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      locked_by_user INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      observation TEXT NOT NULL,
      context TEXT,
      confidence REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL,
      last_updated TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id INTEGER NOT NULL,
      session_id INTEGER,
      accessed_at TEXT NOT NULL,
      was_useful INTEGER,
      FOREIGN KEY (memory_id) REFERENCES memories(id),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS agent_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      energy TEXT,
      clarity TEXT,
      confidence TEXT,
      notes TEXT,
      updated_at TEXT NOT NULL
    );

    INSERT OR IGNORE INTO agent_state (id, energy, clarity, confidence, notes, updated_at)
    VALUES (1, 'neutral', 'neutral', 'neutral', '', datetime('now'));
  `);
    // Idempotent column migration — ignored if already exists
    try {
        db.exec(`ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'`);
    }
    catch (_) { }
}
